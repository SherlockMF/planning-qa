import type { EvaluationItem } from "../types.ts";
import { isEvaluationRunError } from "./runStatus.ts";

export interface QualityMetricCard {
  id:
    | "retrieval_hit"
    | "citation_accuracy"
    | "refusal_accuracy"
    | "permission_isolation"
    | "table_numeric"
    | "answer_quality";
  label: string;
  value: string;
  rate?: number;
  description: string;
}

export interface QualityMetricsSummary {
  cards: QualityMetricCard[];
  topErrors: { reason: string; count: number }[];
  /** 跑测系统异常题数；这些题不参与任何质量分母。 */
  errorCount: number;
}

export function computeQualityMetrics(
  allItems: EvaluationItem[]
): QualityMetricsSummary {
  // 系统异常代表链路没跑通，不是模型答错，计入分母会凭空拉低通过率。
  const errored = allItems.filter(isEvaluationRunError);
  const items = allItems.filter((item) => !isEvaluationRunError(item));

  const cards: QualityMetricCard[] = [
    ratioCard(
      "retrieval_hit",
      "Top5 命中率",
      items.filter((item) => item.inTop5 !== undefined),
      (item) => item.inTop5 === true,
      "正确依据是否进入最终候选，衡量检索召回能力。"
    ),
    ratioCard(
      "citation_accuracy",
      "引用准确率",
      items.filter((item) => item.citationCorrect !== undefined),
      (item) => item.citationCorrect === true,
      "回答给出的引用是否能直接支撑结论。"
    ),
    ratioCard(
      "refusal_accuracy",
      "拒答准确率",
      items.filter((item) => item.shouldRefuse && item.refusedCorrectly !== undefined),
      (item) => item.refusedCorrectly === true,
      "依据不足或超范围时是否拒绝编造。"
    ),
    ratioCard(
      "permission_isolation",
      "权限隔离通过率",
      items.filter(isPermissionCase),
      (item) => item.answerScore === 2 || item.refusedCorrectly === true,
      "无权资料命中时是否被拦截，避免进入回答和引用。"
    ),
    ratioCard(
      "table_numeric",
      "表格数值准确率",
      items.filter(isTableNumericCase),
      (item) => item.answerScore === 2,
      "表格类问题是否输出正确数值且避开解析噪声。"
    ),
    ratioCard(
      "answer_quality",
      "完整答案通过率",
      items.filter((item) => !item.shouldRefuse && item.answerScore !== undefined),
      (item) => item.answerScore === 2,
      "应回答题是否同时满足答案内容和证据要求。"
    ),
  ];

  return {
    cards,
    topErrors: summarizeErrors(allItems),
    errorCount: errored.length,
  };
}

function ratioCard(
  id: QualityMetricCard["id"],
  label: string,
  scope: EvaluationItem[],
  pass: (item: EvaluationItem) => boolean,
  description: string
): QualityMetricCard {
  const passed = scope.filter(pass).length;
  const total = scope.length;
  return {
    id,
    label,
    value: total > 0 ? `${passed}/${total}` : "—",
    rate: total > 0 ? passed / total : undefined,
    description,
  };
}

function isPermissionCase(item: EvaluationItem): boolean {
  const text = [item.scenario, item.expectedBehavior, item.standardAnswer]
    .filter(Boolean)
    .join(" ");
  return /权限|无权|防泄露|隔离/.test(text);
}

function isTableNumericCase(item: EvaluationItem): boolean {
  return (
    item.scenario === "PDF数值回归" ||
    (item.expectedAnswerValues?.length ?? 0) > 0 ||
    /表格|数值|指标/.test(item.expectedBehavior ?? "")
  );
}

function summarizeErrors(items: EvaluationItem[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const reason = item.errorReason?.trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 5);
}
