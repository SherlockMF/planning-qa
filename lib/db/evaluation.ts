// ============================================================================
// 评测数据访问 + 评测运行器
// ----------------------------------------------------------------------------
// "运行评测"会对每道题真实调用问答链路，并据实回填系统回答、引用是否正确、
// 答案得分、是否正确拒答、正确条文是否进入 Top5 等字段。所有统计来自真实运行，
// 不预设任何指标。
// ============================================================================

import type { EvaluationItem, EvaluationStats } from "@/lib/types";
import { DEFAULT_CITY } from "../city.ts";
import { withUsageTracking } from "@/lib/ai/usage";
import { ensureSeeded, getStore } from "./store";
import { generateAnswer } from "@/lib/rag/generateAnswer";
import {
  ENTERPRISE_EVALUATION,
  MOCK_EVALUATION,
  resolveEvaluationUserId,
} from "./mockEvaluation";
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

export async function addEnterpriseEvaluationSamples(): Promise<EvaluationItem[]> {
  await ensureSeeded();
  const store = getStore();
  const existingIds = new Set(store.evaluation.map((item) => item.id));
  const additions = ENTERPRISE_EVALUATION.filter(
    (item) => !existingIds.has(item.id)
  ).map((item) => ({ ...item }));
  store.evaluation = [...store.evaluation, ...additions];
  saveEvaluationFile(store.evaluation);
  return store.evaluation;
}

export async function saveEvaluation(
  items: EvaluationItem[]
): Promise<EvaluationItem[]> {
  await ensureSeeded();
  getStore().evaluation = items;
  saveEvaluationFile(items);
  return items;
}

/**
 * 对题目真实运行问答链路并回填结果。
 * @param ids 仅运行指定 id 的题目（用于「运行所选」）；未传则运行全部。
 *            未被选中的题目保留其既有结果，不重新运行。
 */
export async function runEvaluation(
  ids?: string[]
): Promise<EvaluationItem[]> {
  await ensureSeeded();
  const store = getStore();

  // 限制并发，避免大量题目同时打爆 LLM/Embedding 接口（如智谱限流）。
  // 单题失败也不影响整体：捕获后标记该题错误原因，继续其它题。
  const CONCURRENCY = 3;
  const items = store.evaluation;
  const idSet = ids && ids.length > 0 ? new Set(ids) : null;
  const targets = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !idSet || idSet.has(item.id));

  const updated: EvaluationItem[] = [...items];

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const { item, idx } = targets[cursor++];
      updated[idx] = await scoreItem(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () =>
      worker()
    )
  );

  store.evaluation = updated;
  saveEvaluationFile(updated);
  return updated;
}

async function scoreItem(item: EvaluationItem): Promise<EvaluationItem> {
  // 与问答页同城市运行，保证评测结果反映线上真实行为
  const tracked = await withUsageTracking(() =>
    generateAnswer(item.question, DEFAULT_CITY, resolveEvaluationUserId(item))
  );
  const { usage, durationMs: answerDurationMs } = tracked;
  const tokensUsed = usage.totalTokens;

  if (tracked.error) {
    const err = tracked.error;
    return {
      ...item,
      systemAnswer: undefined,
      inTop5: undefined,
      citationCorrect: undefined,
      refusedCorrectly: undefined,
      answerScore: undefined,
      answerDurationMs,
      tokensUsed,
      errorReason: "运行异常：" + String(err instanceof Error ? err.message : err),
    };
  }

  const result = tracked.value!;
  const { response, retrieval } = result;

  const answered = response.foundEvidence;

  // 是否“命中正确条文”：文件名匹配，且——
  //  · 若指定了条款，条款需匹配；
  //  · 否则若指定了页码，页码需匹配（适配按页而非按条编号的文件，如多数 PDF 标准）。
  const norm = (s?: string | number | null) => String(s ?? "").trim();
  // 文件名模糊匹配：题库"答案来源"多为《文件名称》而 chunk.fileName 带扩展名，
  // 严格等值几乎必不中 → 去扩展名/书名号/空白后做双向包含
  const normFile = (s?: string | null) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\.(pdf|docx?|txt|md|markdown)$/i, "")
      .replace(/[《》【】\s]/g, "");
  const targetFile = normFile(item.correctFile);
  // 题库历史标注常把「《文件标题》+章节」或「项目资料/IT与行政知识/停车标准」等
  // 泛称写进 correctFile，而真实文件名往往带后缀（如 …京政发〔2025〕25号、…-2022年9月版）。
  // 直接整串匹配几乎必不中 → 额外支持：①抽出《》中的标题做子串匹配；②泛称别名映射。
  const rawCorrect = String(item.correctFile ?? "");
  const targetTitle = normFile(rawCorrect.match(/《([^》]+)》/)?.[1] ?? "");
  const FILE_ALIASES: { pattern: RegExp; key: string }[] = [
    { pattern: /停车/, key: "停车配建" },
    { pattern: /报销|财务|企业制度/, key: "财务报销" },
    { pattern: /IT与行政|设计软件|账号|软件/, key: "ITAndAdmin" }, // 见下方多关键词处理
    { pattern: /建筑方案报审|报审资料/, key: "建筑方案报审" },
    { pattern: /片区控规优化/, key: "片区控规优化" },
    { pattern: /产业园/, key: "产业园城市设计" },
    { pattern: /TOD/i, key: "TOD" },
  ];
  const aliasMatches = (chunkFileName: string): boolean => {
    const fn = String(chunkFileName ?? "");
    for (const { pattern, key } of FILE_ALIASES) {
      if (!pattern.test(rawCorrect)) continue;
      if (key === "ITAndAdmin") {
        if (/IT|账号|软件|行政/.test(fn)) return true;
      } else if (fn.includes(key)) {
        return true;
      }
    }
    return false;
  };
  const fileMatches = (chunkFileName: string): boolean => {
    const a = normFile(chunkFileName);
    if (!a) return false;
    if (
      targetFile &&
      (a === targetFile || a.includes(targetFile) || targetFile.includes(a))
    )
      return true;
    // 用《标题》做子串匹配，容忍真实文件名的版本/文号后缀
    if (targetTitle && targetTitle.length >= 4 && a.includes(targetTitle))
      return true;
    return aliasMatches(chunkFileName);
  };
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
    if (!fileMatches(c.fileName)) return false;
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
  //  · 应拒答题 / 未作答 / 未标注正确文件 → 无从判定，留 undefined
  //  · 应作答题 + 有答案 + 有标注 → 检查引用是否命中目标
  const citationCorrect: boolean | undefined =
    item.shouldRefuse || !answered || !hasTarget
      ? undefined
      : response.citations.some((c) => matchesTarget({ ...c, text: c.excerpt }));

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
    } else if (hasTarget) {
      if (citationCorrect) {
        answerScore = 2;
      } else {
        answerScore = 1;
        errorReason = "引用未命中标准条文";
      }
    } else if (stdTokens.length > 0) {
      // 未标注正确文件 → 按回答与标准答案的内容重叠判分，不再一律封顶 1 分
      if (overlapsStdAnswer(response.answer)) {
        answerScore = 2;
      } else {
        answerScore = 1;
        errorReason = "回答与标准答案重叠不足";
      }
    } else {
      answerScore = 1;
      errorReason = "缺少标注（标准答案/正确文件），无法自动核对";
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
    answerDurationMs,
    tokensUsed,
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
