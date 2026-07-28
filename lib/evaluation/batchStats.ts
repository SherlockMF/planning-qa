// ============================================================================
// 评测批次计数与产品通过率
// ============================================================================

import type {
  EvaluationBatch,
  EvaluationBatchCaseResult,
  EvaluationRunStatus,
} from "../types.ts";

export function recountBatchResults(
  caseResults: EvaluationBatchCaseResult[]
): Pick<
  EvaluationBatch,
  "passed" | "failed" | "review" | "error" | "productPassRate"
> {
  const counts: Record<EvaluationRunStatus, number> = {
    PASS: 0,
    FAIL: 0,
    REVIEW: 0,
    ERROR: 0,
  };
  for (const result of caseResults) {
    counts[result.status] += 1;
  }
  const qualityTotal = counts.PASS + counts.FAIL + counts.REVIEW;
  return {
    passed: counts.PASS,
    failed: counts.FAIL,
    review: counts.REVIEW,
    error: counts.ERROR,
    productPassRate:
      qualityTotal > 0 ? Number((counts.PASS / qualityTotal).toFixed(4)) : null,
  };
}
