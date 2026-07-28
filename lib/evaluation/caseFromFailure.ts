// ============================================================================
// 从失败结果生成候选评测题草稿（需人工补齐后才进回归）
// ============================================================================

import type { EvaluationBatchCaseResult, EvaluationItem } from "../types.ts";

export interface BuildCaseDraftFromFailureInput {
  result: EvaluationBatchCaseResult;
  source?: EvaluationItem;
  batchId: string;
  now?: () => string;
  newId?: () => string;
}

export function buildCaseDraftFromFailure(
  input: BuildCaseDraftFromFailureInput
): EvaluationItem {
  const source = input.source;
  const id =
    input.newId?.() ??
    `eval-draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const hintParts = [
    "【草稿·待补齐】从失败结果生成，请补标准答案与正确文件后取消 draft。",
    input.result.errorReason
      ? `失败原因：${input.result.errorReason}`
      : undefined,
    input.result.systemAnswer
      ? `当时系统回答摘要：${input.result.systemAnswer.slice(0, 180)}`
      : undefined,
    source?.standardAnswer
      ? `原题标准答案（仅供参考）：${source.standardAnswer}`
      : undefined,
    source?.correctFile
      ? `原题正确文件（仅供参考）：${source.correctFile}`
      : undefined,
    input.result.workflowTraceId
      ? `审计 traceId：${input.result.workflowTraceId}`
      : undefined,
  ].filter(Boolean);

  return {
    id,
    question: source?.question?.trim() || `[从失败生成] ${input.result.caseId}`,
    standardAnswer: "",
    correctFile: "",
    correctArticle: "",
    correctPage: "",
    shouldRefuse: source?.shouldRefuse ?? false,
    scenario: source?.scenario ?? "失败回流",
    userId: source?.userId,
    expectedBehavior: hintParts.join(" "),
    expectedAnswerValues: undefined,
    forbiddenAnswerValues: undefined,
    draft: true,
    sourceBatchId: input.batchId,
    sourceCaseId: input.result.caseId,
    sourceTraceId: input.result.workflowTraceId,
  };
}
