// ============================================================================
// 重排序
// ----------------------------------------------------------------------------
// 综合多个因素对合并后的检索结果重排序：
//  - 是否命中问题关键词
//  - 语义相似度（向量得分）
//  - 是否属于当前城市
//  - 是否包含明确数值
//  - 是否包含用户询问的用地类型
//  - 是否包含章节 / 条款 / 页码
// ============================================================================

import type { RetrievedChunk } from "@/lib/types";
import { normalizeCity } from "../city.ts";
import { containsNumeric, LAND_USE_RE, queryPhrases } from "./patterns.ts";
import { analyzeQuery } from "./retrieval/searchSignals.ts";

export interface RerankContext {
  question: string;
  keywords: string[];
  city?: string;
}

const WEIGHTS = {
  // keyword 下调：BM25 的 2-gram/单字得分噪声大，改让 phrase 主导精确命中。
  keyword: 0.28,
  vector: 0.3,
  // phrase：字面包含关键名词短语（按短语长度加权），相关度最强信号。
  phrase: 0.45,
  // exactKey：问题字面包含某行/某项的主键（设施名/代码/术语），几乎确定相关。
  exactKey: 0.22,
  city: 0.08,
  hasNumber: 0.07,
  landUseMatch: 0.1,
  hasStructure: 0.05,
  chunkType: 0.12,
  queryIntent: 0.18,
  version: 0.16,
};

/**
 * chunkType 优先级（需求 9）：
 * table_row/code > clause > list_item > table_full > section > 其它。
 * 精确知识单元（行/代码/条款）排在整表/泛段之前。
 */
const CHUNKTYPE_PRIORITY: Record<string, number> = {
  table_row: 1.0,
  code: 1.0,
  indicator: 0.9,
  clause: 0.8,
  definition: 0.75,
  requirement: 0.6,
  list_item: 0.55,
  deliverable: 0.5,
  procedure: 0.5,
  clause_explanation: 0.45,
  table_full: 0.4,
  explanation: 0.35,
  section: 0.3,
  note: 0.2,
  figure: 0.1,
  image_page: 0,
};

export function rerank(
  results: RetrievedChunk[],
  ctx: RerankContext
): RetrievedChunk[] {
  const signals = analyzeQuery(ctx.question);
  const questionLandUse = new Set(
    (ctx.question.match(LAND_USE_RE) ?? []).map((s) => s.toUpperCase())
  );

  // 查询强名词短语：按「语料稀有度(IDF)」加权的字面命中，相关度主信号。
  // 关键：用 IDF 而非字符长度 —— "居住用地"虽长但满篇皆是（区分度低），
  // "绿地率"虽短但稀有（区分度高），稀有短语才应主导排序。
  const phrases = queryPhrases(ctx.question);
  const hays = results.map((r) => {
    const c = r.chunk;
    return `${c.bm25Text ?? c.content} ${c.rowKey ?? ""} ${(c.aliases ?? []).join(" ")} ${
      c.tableTitle ?? ""
    } ${(c.keywords ?? []).join(" ")} ${c.sectionPath ?? ""}`;
  });
  const hasStructuredCandidates = results.some(
    (r) => r.chunk.objectType && r.chunk.objectType !== "plain_section"
  );
  const N = results.length;
  // 短语在候选集中的文档频率 → IDF
  const phraseIdf = new Map<string, number>();
  for (const p of phrases) {
    let dfc = 0;
    for (const h of hays) if (h.includes(p.text)) dfc++;
    phraseIdf.set(p.text, Math.log(1 + (N + 1) / (dfc + 0.5)));
  }
  const totalPhraseW = phrases.reduce((s, p) => s + (phraseIdf.get(p.text) ?? 0), 0);

  for (let ri = 0; ri < results.length; ri++) {
    const r = results[ri];
    const c = r.chunk;
    const hay = hays[ri];
    let score = 0;

    score += WEIGHTS.keyword * r.keywordScore;
    score += WEIGHTS.vector * Math.max(0, r.vectorScore);
    if (r.source === "exact") score += 0.32;

    // 短语命中加分（按 IDF 加权）：命中越稀有的短语，得分越高。
    // focus 衰减：稀有短语若只是在长段落里被「顺带提到一次」，证据力弱；
    // 在短小的条文/表行/定义里出现才是强证据。按 chunk 正文长度衰减，避免
    // 800+ 字的无关长段因一次提及稀有词而霸榜。
    if (totalPhraseW > 0) {
      let matchedW = 0;
      for (const p of phrases) if (hay.includes(p.text)) matchedW += phraseIdf.get(p.text) ?? 0;
      const PHRASE_FOCUS_REF = 180;
      const focus = Math.min(1, PHRASE_FOCUS_REF / Math.max(c.content.length, PHRASE_FOCUS_REF));
      score += WEIGHTS.phrase * (matchedW / totalPhraseW) * focus;
    }

    // 精确主键命中：问题字面包含该行/项的 rowKey、code 或别名（长度≥3，避免短词误命中）。
    const exactKeys = [c.rowKey, c.code, ...(c.aliases ?? [])].filter(
      (k): k is string => !!k && k.length >= 3
    );
    if (exactKeys.some((k) => ctx.question.includes(k))) {
      score += WEIGHTS.exactKey;
    }

    // 城市匹配（归一化："北京"="北京市"）
    if (ctx.city && normalizeCity(c.city) === normalizeCity(ctx.city))
      score += WEIGHTS.city;
    else if (!ctx.city) score += WEIGHTS.city * 0.5;

    // 含明确数值（百分比 / 平方米 / 个 / 米，兼容中文数字）
    if (containsNumeric(c.content)) {
      score += WEIGHTS.hasNumber;
    }

    // 用地类型匹配
    const chunkLandUse = new Set(
      (c.content.match(LAND_USE_RE) ?? []).map((s) => s.toUpperCase())
    );
    if (
      questionLandUse.size > 0 &&
      [...questionLandUse].some((lu) => chunkLandUse.has(lu))
    ) {
      score += WEIGHTS.landUseMatch;
    }

    // 含章节 / 条款 / 页码
    if (c.articleNo || c.sectionPath || c.pageNumber != null) {
      score += WEIGHTS.hasStructure;
    }

    // chunkType 优先级
    score += WEIGHTS.chunkType * (CHUNKTYPE_PRIORITY[c.chunkType] ?? 0.3);
    score += WEIGHTS.queryIntent * queryIntentScore(c, signals);
    score += WEIGHTS.version * versionPriority(c.versionInfo);
    if (c.chunkRole === "atomic") score += 0.04;
    else if (c.chunkRole === "summary") score -= 0.02;
    else if (c.chunkRole === "fallback") score -= 0.08;
    if (hasStructuredCandidates && c.objectType === "plain_section") score -= 0.22;

    r.rerankScore = Number(score.toFixed(4));
  }

  return results.sort((a, b) => b.rerankScore - a.rerankScore);
}

function queryIntentScore(
  chunk: RetrievedChunk["chunk"],
  signals: ReturnType<typeof analyzeQuery>
): number {
  const objectType = chunk.objectType ?? "";
  let score = 0;
  if (signals.asksCode && (chunk.chunkType === "code" || objectType === "classification_code")) score += 1;
  if (signals.asksDefinition && chunk.chunkType === "definition") score += 1;
  if (signals.asksIndicator && (chunk.chunkType === "indicator" || objectType === "indicator_item")) score += 1;
  if (signals.asksConfiguration && /indicator|requirement|structured_table_row/.test(objectType)) score += 0.8;
  if (signals.asksObligation && /requirement|regulation_clause/.test(objectType)) score += 0.9;
  if (signals.asksDeliverable && /deliverable_requirement|drawing_requirement/.test(objectType)) score += 1;
  if (signals.asksDrawing && objectType === "drawing_requirement") score += 1;
  if (signals.asksProcedure && objectType === "procedure_step") score += 1;
  if (signals.asksChecklist && objectType === "checklist_item") score += 1;
  if (signals.asksClause && chunk.chunkType === "clause") score += 0.9;
  if (signals.hasNumericFilter && containsNumeric(chunk.content)) score += 0.4;
  if (signals.asksObligation && chunk.normativeLevel && chunk.normativeLevel !== "unknown") score += 0.4;
  return Math.min(1, score);
}

function versionPriority(versionInfo: RetrievedChunk["chunk"]["versionInfo"]): number {
  if (!versionInfo) return 0.35;
  const status = typeof versionInfo.status === "string" ? versionInfo.status : "unknown";
  const statusScore: Record<string, number> = {
    current: 1,
    reference: 0.7,
    unknown: 0.55,
    possibly_superseded: 0.35,
    internal: 0.45,
    draft: 0.35,
    superseded: 0.05,
  };
  const effectiveDate =
    typeof versionInfo.effectiveDate === "string" ? Date.parse(versionInfo.effectiveDate) : NaN;
  const recency =
    Number.isFinite(effectiveDate)
      ? Math.min(0.2, Math.max(0, (effectiveDate - Date.parse("2000-01-01")) / (1000 * 60 * 60 * 24 * 365 * 100)))
      : 0;
  return Math.min(1, (statusScore[status] ?? 0.55) + recency);
}

/** 将 rerankScore 映射为相关度等级，用于引用卡片展示。 */
export function relevanceLabel(score: number): "高" | "中" | "低" {
  if (score >= 0.45) return "高";
  if (score >= 0.25) return "中";
  return "低";
}
