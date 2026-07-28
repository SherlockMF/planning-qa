// ============================================================================
// 评测跑测状态四分法
// ----------------------------------------------------------------------------
// PASS   自动判定通过且依据明确
// FAIL   自动判定的硬失败（应拒答却作答、数值断言失败、召回不足等）
// REVIEW 自动判定不确定（部分正确、只靠文件别名/内容重叠命中）
// ERROR  跑测过程系统异常，不代表模型答错，不应计入质量分母
// ============================================================================

import type { EvaluationItem, EvaluationRunStatus } from "../types.ts";

type AutoStatusInput = Pick<
  EvaluationItem,
  "runErrored" | "answerScore" | "autoJudgeUncertain"
>;

/**
 * 从本次自动跑测结果派生状态；返回 undefined 表示该题尚未运行。
 * 不考虑人工终判——人工终判由 resolveEvaluationRunStatus 叠加。
 */
export function deriveEvaluationRunStatus(
  item: AutoStatusInput
): EvaluationRunStatus | undefined {
  if (item.runErrored) return "ERROR";
  if (item.answerScore === undefined) return undefined;
  if (item.answerScore === 0) return "FAIL";
  if (item.answerScore === 1) return "REVIEW";
  return item.autoJudgeUncertain ? "REVIEW" : "PASS";
}

/**
 * 展示用状态：人工终判优先，其次已记录的自动状态，
 * 最后对历史数据（无 autoStatus）按结果字段现推。
 */
export function resolveEvaluationRunStatus(
  item: AutoStatusInput & Pick<EvaluationItem, "finalStatus" | "autoStatus">
): EvaluationRunStatus | undefined {
  return item.finalStatus ?? item.autoStatus ?? deriveEvaluationRunStatus(item);
}

/** 该题是否因系统异常而不可用于质量统计。 */
export function isEvaluationRunError(
  item: AutoStatusInput & Pick<EvaluationItem, "finalStatus" | "autoStatus">
): boolean {
  return resolveEvaluationRunStatus(item) === "ERROR";
}
