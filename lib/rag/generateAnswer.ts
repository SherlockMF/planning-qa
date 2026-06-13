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
  const conclusion = stripInternalMarkers(rawConclusion);

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

  // 5. 表格装配：命中表格行 → 回查 RagTable → TableSlice（真实表格展示）。
  //    表格本体由程序渲染，LLM 结论仅作引导/解释文字（核心原则 3）。
  const tableSlices = await assembleTableSlices(top, q);

  // 6. 拼装结构化回答 + 引用卡片
  const citations = context.slice(0, MAX_CITATIONS).map((r) => toCitation(r));
  const answer = buildAnswerText(conclusion, citations);

  let answerBlocks: AnswerBlock[] | undefined;
  if (tableSlices.length > 0) {
    answerBlocks = [
      { type: "text", content: conclusion },
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
      confidence: citations.length >= 2 ? "high" : "medium",
      confidenceLabel:
        citations.length >= 2
          ? "高置信度 · 多段依据交叉印证"
          : "中置信度 · 建议结合引用原文确认",
      feedbackTargetId: `answer-${Date.now()}`,
    },
    retrieval,
  };
}

function toCitation(r: RetrievedChunk): Citation {
  const c = r.chunk;
  return {
    id: c.id,
    fileName: c.fileName,
    sectionPath: c.sectionPath,
    articleNo: c.articleNo,
    pageNumber: c.pageNumber,
    excerpt: cleanExcerpt(c.content),
    relevance: relevanceLabel(r.rerankScore),
  };
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
    /片段.{0,20}(没有|不包含|未包含)/.test(lead)
  );
}

/**
 * 剥离 LLM 结论中残留的内部结构化标记。
 * 主要场景：mock LLM 直接返回 renderChunkAnswerContext 前缀（【结构化XX】…原文：…），
 * 真实 LLM 偶尔在结论中回显这些标记。
 */
function stripInternalMarkers(text: string): string {
  // Mock LLM 场景：内容以「【结构化XX】…\n原文：\n…」格式开头，只保留原文部分
  if (/^【结构化/.test(text.trimStart())) {
    const m = text.match(/\n原文[：:]\n?([\s\S]+)/);
    if (m) return m[1].replace(/\n{3,}/g, "\n\n").trim();
  }
  // 真实 LLM 偶发回显：去掉散落的结构化标记
  return text
    .replace(/【结构化[^】]+】/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
