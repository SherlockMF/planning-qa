// ============================================================================
// 评测数据访问 + 评测运行器
// ----------------------------------------------------------------------------
// "运行评测"会对每道题真实调用问答链路，并据实回填系统回答、引用是否正确、
// 答案得分、是否正确拒答、正确条文是否进入 Top5 等字段。所有统计来自真实运行，
// 不预设任何指标。
// ============================================================================

import type { EvaluationItem, EvaluationStats } from "@/lib/types";
import { ensureSeeded, getStore } from "./store";
import { generateAnswer } from "@/lib/rag/generateAnswer";
import { MOCK_EVALUATION } from "./mockEvaluation";
import { saveEvaluationFile } from "./persist";

export async function listEvaluation(): Promise<EvaluationItem[]> {
  await ensureSeeded();
  return [...getStore().evaluation];
}

/** 将题库重置为内置示例题库（从源码读取，保证文本编码正确）。 */
export async function resetEvaluation(): Promise<EvaluationItem[]> {
  await ensureSeeded();
  getStore().evaluation = MOCK_EVALUATION.map((e) => ({ ...e }));
  saveEvaluationFile(getStore().evaluation);
  return getStore().evaluation;
}

export async function saveEvaluation(
  items: EvaluationItem[]
): Promise<EvaluationItem[]> {
  await ensureSeeded();
  getStore().evaluation = items;
  saveEvaluationFile(items);
  return items;
}

/** 对全部题目真实运行问答链路并回填结果。 */
export async function runEvaluation(): Promise<EvaluationItem[]> {
  await ensureSeeded();
  const store = getStore();

  // 限制并发，避免大量题目同时打爆 LLM/Embedding 接口（如智谱限流）。
  // 单题失败也不影响整体：捕获后标记该题错误原因，继续其它题。
  const CONCURRENCY = 3;
  const items = store.evaluation;
  const updated: EvaluationItem[] = new Array(items.length);

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      updated[idx] = await scoreItem(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker())
  );

  store.evaluation = updated;
  saveEvaluationFile(updated);
  return updated;
}

async function scoreItem(item: EvaluationItem): Promise<EvaluationItem> {
  let result;
  try {
    result = await generateAnswer(item.question);
  } catch (err) {
    // 运行期异常（接口报错/限流等）：保留题目，标记错误，不中断整体评测
    return {
      ...item,
      systemAnswer: undefined,
      inTop5: undefined,
      citationCorrect: undefined,
      refusedCorrectly: undefined,
      answerScore: undefined,
      errorReason: "运行异常：" + String(err instanceof Error ? err.message : err),
    };
  }
  const { response, retrieval } = result;

  const answered = response.foundEvidence;

  // 是否“命中正确条文”：文件名匹配，且——
  //  · 若指定了条款，条款需匹配；
  //  · 否则若指定了页码，页码需匹配（适配按页而非按条编号的文件，如多数 PDF 标准）。
  const norm = (s?: string | number | null) => String(s ?? "").trim();
  const hasArticle = !!item.correctArticle && item.correctArticle !== "—";
  const hasPage = !!item.correctPage && item.correctPage !== "—";
  const hasTarget = !!item.correctFile && item.correctFile !== "—";

  // 文件名必须匹配；定位上命中任一信号即算正确：条款匹配 / 页码±1 / 原文与标准答案高度重叠。
  // 关键：内容对了就算对，不被页码偏移误伤。
  const stdTokens = tokenizeForOverlap(
    item.standardAnswer && item.standardAnswer !== "—" ? item.standardAnswer : ""
  );
  const overlapsStdAnswer = (text: string): boolean => {
    if (stdTokens.length === 0) return false;
    const hit = stdTokens.filter((t) => text.includes(t)).length;
    return hit / stdTokens.length >= 0.5;
  };
  const matchesTarget = (c: {
    fileName: string;
    articleNo?: string;
    pageNumber?: number;
    text: string;
  }) => {
    if (norm(c.fileName) !== norm(item.correctFile)) return false;
    if (hasArticle && norm(c.articleNo) === norm(item.correctArticle)) return true;
    if (
      hasPage &&
      Number.isFinite(Number(c.pageNumber)) &&
      Number.isFinite(Number(item.correctPage)) &&
      Math.abs(Number(c.pageNumber) - Number(item.correctPage)) <= 1
    )
      return true;
    if (overlapsStdAnswer(c.text)) return true;
    if (!hasArticle && !hasPage) return true; // 仅给了文件
    return false;
  };

  // 正确条文是否进入 Top5
  const inTop5 =
    hasTarget && retrieval
      ? retrieval.mergedTop.some((r) =>
          matchesTarget({ ...r.chunk, text: r.chunk.content })
        )
      : undefined;

  // 引用是否正确：
  //  · 应拒答题 → 引用概念无意义，留 undefined
  //  · 应作答题 + 有答案 → 检查引用是否命中目标；否则 false
  const citationCorrect: boolean | undefined = item.shouldRefuse
    ? undefined
    : answered && hasTarget
      ? response.citations.some((c) => matchesTarget({ ...c, text: c.excerpt }))
      : false;

  // 是否正确拒答（仅对应拒答题有意义）
  const refusedCorrectly = item.shouldRefuse ? !answered : undefined;

  // 答案得分与错误原因
  let answerScore: 0 | 1 | 2;
  let errorReason = "";

  if (item.shouldRefuse) {
    if (!answered) {
      answerScore = 2;
    } else {
      answerScore = 0;
      errorReason = "应拒答却作答";
    }
  } else {
    if (!answered) {
      answerScore = 0;
      errorReason = "召回不足 / 误拒答";
    } else if (citationCorrect) {
      answerScore = 2;
    } else {
      answerScore = 1;
      errorReason = "引用未命中标准条文";
    }
  }

  return {
    ...item,
    systemAnswer: response.answer,
    inTop5,
    citationCorrect,
    refusedCorrectly,
    answerScore,
    errorReason,
  };
}

/** 把标准答案拆成可比对的 token（数值 + 中文 2-gram），用于内容重叠判断。 */
function tokenizeForOverlap(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
  for (const m of s.matchAll(/[A-Za-z]\d{1,2}/g)) out.add(m[0].toUpperCase());
  const han = s.match(/[一-龥]+/g) ?? [];
  for (const seg of han) {
    for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
  }
  return [...out];
}

export function computeStats(items: EvaluationItem[]): EvaluationStats {
  const ran = items.filter((i) => i.answerScore !== undefined);
  const total = items.length;

  const inTop5Count = items.filter((i) => i.inTop5 === true).length;
  const citationCorrectCount = items.filter(
    (i) => i.citationCorrect === true
  ).length;
  const refusedCorrectlyCount = items.filter(
    (i) => i.shouldRefuse && i.refusedCorrectly === true
  ).length;

  const scored = ran.map((i) => i.answerScore as number);
  const averageScore =
    scored.length > 0
      ? Number(
          (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2)
        )
      : 0;

  const errorReasonSummary: Record<string, number> = {};
  for (const i of items) {
    if (i.errorReason) {
      errorReasonSummary[i.errorReason] =
        (errorReasonSummary[i.errorReason] ?? 0) + 1;
    }
  }

  return {
    total,
    inTop5Count,
    citationCorrectCount,
    averageScore,
    refusedCorrectlyCount,
    errorReasonSummary,
  };
}
