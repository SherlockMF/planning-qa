// ============================================================================
// 评测批次输入快照：剥离跑测结果，避免把 latest 分数固化进历史
// ============================================================================

import type { EvaluationItem } from "../types.ts";

/** 题库输入字段；批次 caseSnapshot 只保留这些，不含本次/历史跑测结果。 */
const INPUT_KEYS = [
  "id",
  "scenario",
  "userId",
  "expectedBehavior",
  "seq",
  "question",
  "standardAnswer",
  "correctFile",
  "correctArticle",
  "correctPage",
  "shouldRefuse",
  "expectedAnswerValues",
  "forbiddenAnswerValues",
] as const satisfies readonly (keyof EvaluationItem)[];

/** 从题库条目生成批次输入快照（去掉自动分、人工终判、审计链接等结果字段）。 */
export function toEvaluationCaseSnapshot(item: EvaluationItem): EvaluationItem {
  const snapshot = {} as EvaluationItem;
  for (const key of INPUT_KEYS) {
    const value = item[key];
    if (value !== undefined) {
      Object.assign(snapshot, { [key]: value });
    }
  }
  return snapshot;
}

export function toEvaluationCaseSnapshots(
  items: EvaluationItem[]
): EvaluationItem[] {
  return items.map(toEvaluationCaseSnapshot);
}
