// ============================================================================
// 回答生成编排
// ----------------------------------------------------------------------------
// 完整链路：检索前范围判断 → 混合检索 → 检索后依据判断 → LLM 抽取式生成结论
// → 按固定模板拼装【结论】/【依据】/【注意】，并产出引用卡片。
// 全程不允许编造：结论来自 LLM 抽取的 chunk 原文，引用来自检索命中的 chunk。
// ============================================================================

import type {
  AnswerBlock,
  ChatResponse,
  Citation,
  KnowledgeRoleId,
  RetrievedChunk,
} from "@/lib/types";
import { retrieve, type RetrieveResult } from "./retrieve.ts";
import { checkEvidence, checkScope } from "./refusal.ts";
import { relevanceLabel } from "./rerank.ts";
import { assembleTableSlices } from "./tableAssembly.ts";
import { getLLMProvider, toContextChunk } from "@/lib/ai/llm";
import { renderChunkAnswerContext } from "./retrieval/renderAnswerContext.ts";
import {
  buildNoAccessChatResponse,
  shouldReturnNoAccess,
} from "@/lib/knowledge/noAccess";
import {
  applyLowFidelityFallback,
  classifyEvidenceQuality,
  type EvidenceQuality,
} from "./evidenceQuality.ts";
import {
  finalizeConclusionText,
  sanitizeConclusionText,
} from "./answerFormatting.ts";
import {
  preferCleanStructuredCitations,
  rankStructuredEvidenceForQuestion,
  recoverConclusionFromStructuredEvidence,
} from "./structuredFieldSelector.ts";

// LLM 可见的上下文窗口（要覆盖到依据判断所用的 Top-N，避免“能搜到却答不出”）
const LLM_CONTEXT = 5;
// 展示给用户的引用条数上限。必须 ≥ LLM_CONTEXT：
// 否则结论可能基于第 5 条片段而依据卡片不展示它（"看不见的依据"）。
const MAX_CITATIONS = LLM_CONTEXT;

const NOTICE_TEXT =
  "该回答仅适用于当前知识库已收录文件及对应城市。如具体地块规划条件、已批控规图则或更新文件另有规定，应以具体文件为准。";

export interface GenerateResult {
  response: ChatResponse;
  retrieval: RetrieveResult | null;
}

export async function generateAnswer(
  question: string,
  city?: string,
  userId?: string,
  userRole?: KnowledgeRoleId
): Promise<GenerateResult> {
  const q = question.trim();
  if (!q) {
    return {
      response: buildRefusal(
        "问题为空，请输入要查询的法规问题。",
        "输入为空"
      ),
      retrieval: null,
    };
  }

  // 1. 检索前范围判断
  const scope = checkScope(q);
  if (scope.shouldRefuse) {
    return {
      response: buildRefusal(scope.reason!, scope.reasonCode!),
      retrieval: null,
    };
  }

  // 2. 混合检索
  const retrieval = await retrieve(q, city, userId, userRole);
  const top = retrieval.mergedTop;

  if (shouldReturnNoAccess(top, retrieval.deniedTop)) {
    return {
      response: buildNoAccessChatResponse(q),
      retrieval,
    };
  }

  // 3. 检索后依据判断
  const evidence = checkEvidence(q, top);
  if (evidence.shouldRefuse) {
    if (retrieval.deniedTop.length > 0) {
      return {
        response: buildNoAccessChatResponse(q),
        retrieval,
      };
    }
    return {
      response: buildRefusal(evidence.reason!, evidence.reasonCode!),
      retrieval,
    };
  }

  // 4. LLM 生成结论（仅基于传入 chunks）。上下文给到 Top-N，确保依据可见。
  const context = top.slice(0, LLM_CONTEXT);
  const llm = getLLMProvider();
  const rawConclusion = await llm.synthesizeConclusion({
    question: q,
    city,
    chunks: context.map((r, i) => {
      const chunk = toContextChunk(r.chunk, i + 1);
      const structured = renderChunkAnswerContext(r.chunk);
      return structured
        ? {
            ...chunk,
            content: `${structured}\n\n原文：\n${chunk.content}`,
          }
        : chunk;
    }),
  });
  const conclusion = sanitizeConclusionText(rawConclusion);

  if (!conclusion.trim()) {
    return {
      response: buildRefusal("未能从检索到的条文中提炼出明确结论。", "结论提炼失败"),
      retrieval,
    };
  }

  // LLM 有时会在 conclusion 里自行拒答（"抱歉，知识库中没有..."）。
  // 检测这类自拒答并转为标准拒答格式，避免「结论说没有依据 + 却展示引用」的矛盾。
  if (isLLMSelfRefusal(conclusion)) {
    return {
      response: buildRefusal(
        "知识库中检索到的片段未包含该问题的明确条文依据，LLM 判断不足以作答。",
        "LLM自判无依据"
      ),
      retrieval,
    };
  }

  // 5. 表格装配：仅当「最相关证据本身是表格」时才渲染，避免计数/文字题被检索分高
  //    但与结论无关的表格蹭进来（如问「分为多少类」却挂出整张用地分类表）。
  const topIsTable = top
    .slice(0, 2)
    .some((h) => TABLE_CHUNK_TYPES.has(h.chunk.chunkType));
  let tableSlices = topIsTable ? await assembleTableSlices(top, q) : [];
  // 只在「确有一张表真正支撑结论」时渲染表格。实测：当某张表就是答案时其支撑度
  // 极高（0.9+）；当答案其实在条文、表只是蹭检索分时，最高支撑度也只有 ~0.46。
  // 故以 0.5 为界：低于则一张不渲染（避免问停车挂出体育设施表这类噪声），
  // 高于则只保留强支撑（≥最高的 0.6 倍）的表。
  if (tableSlices.length > 0) {
    const scored = tableSlices.map((s) => ({
      s,
      sup: conclusionSupport(conclusion, sliceText(s)),
    }));
    const maxSup = Math.max(...scored.map((x) => x.sup));
    tableSlices =
      maxSup < 0.5
        ? []
        : scored.filter((x) => x.sup >= maxSup * 0.6).map((x) => x.s);
  }

  // 6. 拼装结构化回答 + 引用卡片
  //    依据不再无脑铺满 Top-N：先按内容去重（同句的 clause/requirement 双胞胎），
  //    再按「对结论的支撑度」过滤，只保留真正支撑结论的条文。
  const selected = selectCitations(context, conclusion, topIsTable);
  const citations = preferCleanStructuredCitations(
    rankStructuredEvidenceForQuestion(selected.citations, q),
    q
  );
  const { bestSupport } = selected;
  const needsSourceReview = citations.some(
    (c) =>
      c.lowFidelity ||
      c.excerptDisplayPolicy === "source_page_required" ||
      (c.extractionWarnings?.length ?? 0) > 0
  );
  const finalizedConclusion = finalizeConclusionText(conclusion, citations);
  const hasReflectionFallback = finalizedConclusion.reflection.needsFallback;
  const recoveredConclusion = recoverConclusionFromStructuredEvidence(citations, q);
  const displayConclusion = recoveredConclusion ?? applyLowFidelityFallback(
    finalizedConclusion.text,
    citations
  );
  const unresolvedReflectionFallback = hasReflectionFallback && !recoveredConclusion;
  if (needsSourceReview || unresolvedReflectionFallback) tableSlices = [];
  const answer = buildAnswerText(displayConclusion, citations);

  let answerBlocks: AnswerBlock[] | undefined;
  if (tableSlices.length > 0) {
    answerBlocks = [
      { type: "text", content: displayConclusion },
      ...tableSlices.map(
        (s): AnswerBlock => ({
          type: "table_slice",
          tableId: s.tableId,
          tableTitle: s.tableTitle,
          columns: s.columns,
          rows: s.rows,
          selectedRowIds: s.selectedRowIds,
          source: {
            docTitle: s.sourceDocTitle,
            pageStart: s.pageStart,
            pageEnd: s.pageEnd,
          },
        })
      ),
    ];
  }

  return {
    response: {
      answer,
      foundEvidence: true,
      citations,
      answerBlocks,
      confidence: needsSourceReview || unresolvedReflectionFallback
        ? "low"
        : citations.length >= 2 || bestSupport >= 0.55
          ? "high"
          : "medium",
      confidenceLabel:
        needsSourceReview
          ? "低置信度 · 表格解析疑似低保真，请核对原文页面"
          : unresolvedReflectionFallback
          ? "低置信度 · 输出前校验发现结论不完整，请核对原文"
          : citations.length >= 2
          ? "高置信度 · 多段依据交叉印证"
          : bestSupport >= 0.55
            ? "高置信度 · 依据与结论高度一致"
            : "中置信度 · 建议结合引用原文确认",
      feedbackTargetId: `answer-${Date.now()}`,
    },
    retrieval,
  };
}

/** 表格类 chunk 类型（用于判断「最相关证据是否为表格」）。 */
const TABLE_CHUNK_TYPES = new Set(["table_full", "table_row"]);

/** 字符二元组集合（去空格与标点），用于衡量结论与片段的字面重叠。 */
function bigrams(s: string): Set<string> {
  const t = (s || "").replace(/[\s\p{P}]/gu, "");
  const g = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

/** 序列化一张 TableSlice 的可读文本（标题 + 各行单元格），用于支撑度衡量。 */
function sliceText(s: { tableTitle: string; rows: { cells: Record<string, string> }[] }): string {
  const cells = s.rows.flatMap((r) => Object.values(r.cells));
  return [s.tableTitle, ...cells].filter(Boolean).join(" ");
}

/** 片段对结论的支撑度：结论的二元组中有多少比例能在片段里找到（0~1）。 */
function conclusionSupport(conclusion: string, text: string): number {
  const cg = bigrams(conclusion);
  if (cg.size === 0) return 0;
  const tg = bigrams(text);
  let hit = 0;
  for (const g of cg) if (tg.has(g)) hit++;
  return hit / cg.size;
}

/** 去重用规范化键：去空白与常见标点。 */
function normForDedup(text: string): string {
  return (text || "").replace(/\s+/g, "").replace(/[，。、；：,.:;]/g, "");
}

/**
 * 选取依据，去掉「无脑铺满 Top-N」带来的噪声：
 *  ① 文字/计数题（最相关证据非表格）不把表格行当文字依据；
 *  ② 同一张表最多保留一条依据（避免多行重复刷屏）；
 *  ③ 内容去重（同句的 clause/requirement 双胞胎、互为子串的片段）；
 *  ④ 兜底至少保留一条，避免「有结论却无依据」。
 */
function selectCitations(
  context: RetrievedChunk[],
  conclusion: string,
  topIsTable: boolean
): { citations: Citation[]; bestSupport: number } {
  const kept: RetrievedChunk[] = [];
  const seenTables = new Set<string>();
  for (const r of context) {
    const c = r.chunk;
    const isTable = TABLE_CHUNK_TYPES.has(c.chunkType);
    if (!topIsTable && isTable) continue; // 文字/计数题不挂表格行
    if (isTable && c.tableId) {
      const key = `${c.documentId}__${c.tableId}`;
      if (seenTables.has(key)) continue; // 同表只留一条
      seenTables.add(key);
    }
    const norm = normForDedup(cleanExcerpt(c.content));
    if (!norm) continue;
    const dup = kept.some((k) => {
      const kn = normForDedup(cleanExcerpt(k.chunk.content));
      return (
        kn === norm ||
        (norm.length >= 10 && (kn.includes(norm) || norm.includes(kn)))
      );
    });
    if (!dup) kept.push(r);
  }

  const finalKept = kept.length > 0 ? kept : context.slice(0, 1);
  const bestSupport = finalKept.reduce(
    (m, r) => Math.max(m, conclusionSupport(conclusion, r.chunk.content)),
    0
  );
  return {
    citations: finalKept.slice(0, MAX_CITATIONS).map((r) => toCitation(r)),
    bestSupport,
  };
}

function toCitation(r: RetrievedChunk): Citation {
  const c = r.chunk;
  const evidenceQuality = classifyEvidenceQuality({
    chunkType: c.chunkType,
    text: c.content,
  });
  const extractionWarnings = [
    ...new Set([...(c.extractionWarnings ?? []), ...evidenceQuality.warnings]),
  ];
  const evidenceCategories = [
    ...new Set([...(c.evidenceCategories ?? []), ...evidenceQuality.categories]),
  ];
  const excerptDisplayPolicy =
    c.lowFidelity ||
    extractionWarnings.length > 0 ||
    evidenceQuality.displayPolicy === "source_page_required"
      ? "source_page_required"
      : "show_extracted_text";
  const citationQuality: EvidenceQuality = {
    ...evidenceQuality,
    warnings: extractionWarnings as EvidenceQuality["warnings"],
    categories: evidenceCategories as EvidenceQuality["categories"],
    displayPolicy: excerptDisplayPolicy,
  };
  return {
    id: c.id,
    documentId: c.documentId,
    fileName: c.fileName,
    sectionPath: c.sectionPath,
    articleNo: c.articleNo,
    pageNumber: c.pageNumber,
    chunkType: c.chunkType,
    excerpt: buildCitationExcerpt(c, citationQuality),
    lowFidelity: c.lowFidelity || evidenceQuality.blocksAnswer,
    extractionWarnings,
    evidenceCategories,
    excerptDisplayPolicy,
    relevance: relevanceLabel(r.rerankScore),
  };
}

function buildCitationExcerpt(
  chunk: RetrievedChunk["chunk"],
  evidenceQuality: EvidenceQuality
): string {
  if (evidenceQuality.displayPolicy === "source_page_required") {
    return "已定位到相关原文页面；当前自动提取片段存在阅读顺序噪声，建议切换到“原文页面”核对。";
  }

  const structured = renderChunkAnswerContext(chunk);
  return cleanExcerpt(structured || chunk.content);
}

/**
 * 清理 PDF 提取产生的噪声：
 * - 去掉页码分隔符 —01—、—123— 等
 * - 去掉 [[page:N]] 标记（正常应在切片前消耗，但偶有残留）
 * - 合并多余空行 / 前后空白
 */
function cleanExcerpt(text: string): string {
  return text
    .replace(/—\d+—/g, "")          // PDF 页脚 —01—
    .replace(/\[\[page:\d+\]\]/g, "") // 残留页码标记
    .replace(/【第\d+页】/g, "")       // 中文页码标记
    .replace(/\n{3,}/g, "\n\n")       // 多余空行
    .trim();
}

function buildAnswerText(conclusion: string, citations: Citation[]): string {
  const evidenceLines = citations
    .map((c, i) => {
      const head = citations.length > 1 ? `依据${i + 1}：` : "";
      return [
        `${head}`.trim() ? `· ${head}` : "·",
        `  - 文件：${c.fileName}`,
        `  - 章节 / 条款：${[c.sectionPath, c.articleNo]
          .filter(Boolean)
          .join(" ｜ ") || "—"}`,
        `  - 页码：${c.pageNumber != null ? `第${c.pageNumber}页` : "—"}`,
        `  - 原文片段：${c.excerpt}`,
      ].join("\n");
    })
    .join("\n");

  return [
    "【结论】",
    conclusion,
    "",
    "【依据】",
    evidenceLines,
    "",
    "【注意】",
    NOTICE_TEXT,
  ].join("\n");
}

/**
 * 检测 LLM 输出是否为自拒答（含"抱歉""没有依据""无法回答"等模式）。
 * 只检查开头第一句：自拒答总是开门见山；法规原文中段常见的
 * "无法确定的，按下列规定执行"等措辞不应把有效回答误判为拒答
 * （mock LLM 逐字复述原文，整段匹配的误杀率很高）。
 */
function isLLMSelfRefusal(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("抱歉")) return true;
  const lead = t.split(/[。\n]/, 1)[0].slice(0, 80);
  return (
    /没有.{0,20}依据/.test(lead) ||
    /知识库.{0,20}(没有|未包含|不包含|无法)/.test(lead) ||
    /无法.{0,10}(回答|作答|给出)/.test(lead) ||
    /未.{0,10}(检索到|找到).{0,20}(依据|条文|内容)/.test(lead) ||
    /片段.{0,20}(没有|不包含|未包含)/.test(lead) ||
    // LLM 常把"无依据"表述成"未找到…的具体要求/规定/标准/数值"，结尾不是"依据/条文"，
    // 需单独覆盖，否则会被当成正常作答（导致应拒答题误判为"应拒答却作答"）。
    /(未|没有|无法|查无).{0,12}(找到|检索到|查到|包含|提及|涉及|给出).{0,30}(要求|规定|标准|数值|指标|条文|内容|依据|信息|说明)/.test(
      lead
    )
  );
}

function buildRefusal(reason: string, reasonCode: string): ChatResponse {
  const answer = [
    "【无法确定】",
    "当前知识库未检索到该问题的明确条文依据，因此无法给出确定结论。",
    "",
    "【原因】",
    reason,
    "",
    "【建议】",
    "请补充对应城市技术规定、控规导则、专项标准、已批控规图则或具体地块规划条件后再查询。",
  ].join("\n");

  return {
    answer,
    foundEvidence: false,
    citations: [],
    refusalReason: reasonCode,
    confidence: "low",
    confidenceLabel: "低置信度 · 无明确依据",
    feedbackTargetId: `refusal-${Date.now()}`,
  };
}
