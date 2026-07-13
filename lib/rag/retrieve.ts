// ============================================================================
// 混合检索：关键词检索 + 向量检索
// ============================================================================

import type { Chunk, KnowledgeRoleId, RetrievedChunk } from "@/lib/types";
import { cosineSimilarity, getEmbeddingProvider } from "@/lib/ai/embedding";
import { listSearchableChunksByAccess } from "@/lib/db/chunks";
import { rerank } from "./rerank";
import { BM25Index, tokenize } from "./bm25";
import { expandHit } from "./expand";
import { exactSearchChunks } from "./retrieval/exactIndex.ts";
import { analyzeQuery, topKForQuerySignals } from "./retrieval/searchSignals.ts";
import { expandServiceScaleSiblingRows } from "./retrieval/serviceScaleSiblings.ts";

const MAX_CONTEXT_CHARS = 12000;

/** 从用户问题中提取关键词：用地代码、指标名称、数值、条款号、专业术语。 */
export function extractQueryKeywords(question: string): string[] {
  const keywords = new Set<string>();
  const q = question;

  for (const m of q.matchAll(/[A-Za-z]\d{1,2}/g)) keywords.add(m[0].toUpperCase());
  for (const m of q.matchAll(/\d+(?:\.\d+)?\s*(?:%|％|平方米|米|个|户)?/g)) {
    const v = m[0].replace(/\s+/g, "");
    if (v.length > 0 && /\d/.test(v)) keywords.add(v);
  }
  for (const m of q.matchAll(/第[一二三四五六七八九十百零0-9]+条/g)) keywords.add(m[0]);

  const TERMS = [
    "容积率", "建筑密度", "绿地率", "建筑高度", "限高", "停车", "配建",
    "居住用地", "二类居住用地", "一类居住用地", "商业用地", "商务金融用地",
    "公共服务设施", "用地分类", "日照", "间距", "定义", "区别", "标准",
    "办公建筑", "商业建筑", "住宅", "旧区改建", "集中绿地",
    // 道路 / 市政
    "道路红线", "红线宽度", "道路宽度", "退线", "建筑退线", "退距",
    // 指标类型
    "引导性指标", "控制性指标", "强制性指标", "主导功能", "主导用地",
    // 设施
    "幼儿园", "小学", "中学", "社区卫生", "服务半径", "配置指标",
    "林木覆盖率", "覆盖率", "绿化覆盖",
    // 用地代码
    "H9", "H类", "A类", "B类", "R类",
    // 其他高频
    "划分", "设置", "规定", "要求", "不应", "不得", "宜", "应当",
  ];
  for (const term of TERMS) if (q.includes(term)) keywords.add(term);

  // 兜底 2-gram
  const han = q.match(/[一-龥]+/g) ?? [];
  for (const seg of han) {
    for (let i = 0; i < seg.length - 1; i++) keywords.add(seg.slice(i, i + 2));
  }

  return [...keywords];
}

/**
 * BM25 关键词检索（替代原 IDF 重叠）。
 * 查询 token = 问题分词 + 抽取关键词（代码/表号/条款号/设施名称作为精确整词）。
 * 归一化得分到 [0,1]（除以本次查询最高分），便于与向量得分线性融合。
 */
export function keywordSearch(
  index: BM25Index,
  question: string,
  queryKeywords: string[]
): RetrievedChunk[] {
  // 去掉单字中文 token（"用""地""服""务"等纯噪声，匹配满篇皆是）。
  // 保留 2-gram、代码、数字、英文整词，召回不受影响而噪声大减。
  const queryTokens = [...tokenize(question), ...queryKeywords].filter(
    (t) => !(t.length === 1 && /[一-龥]/.test(t))
  );
  const raw = index.search(queryTokens);
  const max = raw[0]?.score ?? 1;
  return raw.map((r) => ({
    chunk: r.chunk,
    keywordScore: max > 0 ? r.score / max : 0,
    vectorScore: 0,
    rerankScore: 0,
    source: "keyword" as const,
    matchedKeywords: r.matched.filter((m) => queryKeywords.includes(m)),
  }));
}

/** 向量检索：对问题做 embedding，与各 chunk 计算余弦相似度。 */
export async function vectorSearch(
  chunks: Chunk[],
  question: string
): Promise<RetrievedChunk[]> {
  const embedder = getEmbeddingProvider();
  const qVec = await embedder.embed(question);

  const results: RetrievedChunk[] = [];
  let dimMismatch = 0;
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    // 维度不一致 = 库内向量来自其它 embedding 提供方，cosine 会静默归零。
    // 跳过并告警，避免"向量通道全灭却无人知晓"。
    if (chunk.embedding.length !== qVec.length) {
      dimMismatch++;
      continue;
    }
    const sim = cosineSimilarity(qVec, chunk.embedding);
    results.push({
      chunk,
      keywordScore: 0,
      vectorScore: sim,
      rerankScore: 0,
      source: "vector",
      matchedKeywords: [],
    });
  }
  if (dimMismatch > 0) {
    console.warn(
      `[retrieve] ${dimMismatch} 个 chunk 的 embedding 维度与当前提供方（${embedder.signature}）不一致，` +
        "已跳过向量打分。请重新解析对应文档以重建向量。"
    );
  }
  return results.sort((a, b) => b.vectorScore - a.vectorScore);
}

export interface RetrieveResult {
  extractedKeywords: string[];
  exactResults: RetrievedChunk[];
  keywordResults: RetrievedChunk[];
  vectorResults: RetrievedChunk[];
  mergedTop: RetrievedChunk[];
  deniedTop: RetrievedChunk[];
}

/**
 * 完整混合检索流程：
 * 提取关键词 → 关键词检索 → 向量检索 → 合并 → 重排序 → Top K。
 */
export async function retrieve(
  question: string,
  city?: string,
  userId?: string,
  userRole?: KnowledgeRoleId
): Promise<RetrieveResult> {
  const { accessible: chunks, denied } = await listSearchableChunksByAccess(
    city,
    userId,
    userRole
  );
  const extractedKeywords = extractQueryKeywords(question);
  const topK = topKForQuerySignals(analyzeQuery(question));
  const accessibleResults = await searchChunkSet(
    chunks,
    question,
    extractedKeywords
  );

  const reranked = rerank(accessibleResults.merged, {
    question,
    keywords: extractedKeywords,
    city,
  });

  // 命中扩展：table_row/code 补表头+表名；clause 补父标题/章节路径。
  // 在 chunk 全集上查父块（table_full / 同序列），浅拷贝注入 content。
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const topSeed = expandServiceScaleSiblingRows(
    reranked.slice(0, topK),
    chunks,
    question
  );
  const topExpanded = limitContextBudget(
    topSeed.map((r) => expandHit(r, byId)),
    MAX_CONTEXT_CHARS
  );

  const deniedResults = denied.length
    ? await searchChunkSet(denied, question, extractedKeywords)
    : { exactResults: [], keywordResults: [], vectorResults: [], merged: [] };
  const deniedTop = rerank(deniedResults.merged, {
    question,
    keywords: extractedKeywords,
    city,
  }).slice(0, topK);

  return {
    extractedKeywords,
    exactResults: accessibleResults.exactResults.slice(0, topK * 2),
    keywordResults: accessibleResults.keywordResults.slice(0, topK * 2),
    vectorResults: accessibleResults.vectorResults.slice(0, topK * 2),
    mergedTop: topExpanded,
    deniedTop,
  };
}

async function searchChunkSet(
  chunks: Chunk[],
  question: string,
  extractedKeywords: string[]
): Promise<{
  exactResults: RetrievedChunk[];
  keywordResults: RetrievedChunk[];
  vectorResults: RetrievedChunk[];
  merged: RetrievedChunk[];
}> {
  const exactResults = exactSearchChunks(chunks, question);
  const bm25 = new BM25Index(chunks);
  const keywordResults = keywordSearch(bm25, question, extractedKeywords);
  // 向量检索依赖外部 embedding 接口；一旦其不可用（额度耗尽/限流/断网），
  // 不应让整条查询崩溃，而是降级为「精确 + BM25」关键词检索继续作答。
  let vectorResults: RetrievedChunk[] = [];
  try {
    vectorResults = await vectorSearch(chunks, question);
  } catch (e) {
    console.warn(
      "[retrieve] 向量检索不可用，已降级为关键词检索：",
      String(e instanceof Error ? e.message : e).slice(0, 160)
    );
  }

  const merged = new Map<string, RetrievedChunk>();
  for (const r of exactResults) merged.set(r.chunk.id, { ...r });
  for (const r of keywordResults) {
    const existing = merged.get(r.chunk.id);
    if (existing) {
      existing.keywordScore = Math.max(existing.keywordScore, r.keywordScore);
      existing.source = "hybrid";
      existing.matchedKeywords = [
        ...new Set([...existing.matchedKeywords, ...r.matchedKeywords]),
      ];
    } else {
      merged.set(r.chunk.id, { ...r });
    }
  }
  for (const r of vectorResults) {
    const existing = merged.get(r.chunk.id);
    if (existing) {
      existing.vectorScore = r.vectorScore;
      existing.source = "hybrid";
    } else {
      merged.set(r.chunk.id, { ...r });
    }
  }

  return {
    exactResults,
    keywordResults,
    vectorResults,
    merged: [...merged.values()],
  };
}

function limitContextBudget(results: RetrievedChunk[], maxChars: number): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  let used = 0;
  for (const result of results) {
    const len = result.chunk.content.length;
    if (kept.length >= 5 && used + len > maxChars) continue;
    kept.push(result);
    used += len;
  }
  return kept;
}

export { topKForQuerySignals } from "./retrieval/searchSignals.ts";
