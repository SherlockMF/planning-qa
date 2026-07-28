// ============================================================================
// 评测批次对比：可比性门禁 + 回归 diff
// ============================================================================

import type {
  EvaluationBatch,
  EvaluationBatchCaseResult,
  EvaluationBatchCompareResult,
  EvaluationRunStatus,
} from "../types.ts";

function configEqual(
  a: Record<string, string | number | boolean | null>,
  b: Record<string, string | number | boolean | null>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function compareEvaluationBatches(
  baseline: EvaluationBatch,
  candidate: EvaluationBatch
): EvaluationBatchCompareResult {
  const reasons: string[] = [];
  if (baseline.caseSetHash !== candidate.caseSetHash) {
    reasons.push("caseSetHash 不一致：题库集合不同，不能比较");
  }
  if (baseline.evaluatorVersion !== candidate.evaluatorVersion) {
    reasons.push("evaluatorVersion 不一致：评分逻辑已变更");
  }
  if (
    baseline.knowledgeIndexFingerprint !== candidate.knowledgeIndexFingerprint
  ) {
    reasons.push(
      "knowledgeIndexFingerprint 不一致：知识库索引已变更，趋势不可比"
    );
  }
  if (!configEqual(baseline.modelConfigSnapshot, candidate.modelConfigSnapshot)) {
    reasons.push("modelConfigSnapshot 不一致：模型配置不同");
  }
  if (!configEqual(baseline.ragConfigSnapshot, candidate.ragConfigSnapshot)) {
    reasons.push("ragConfigSnapshot 不一致：RAG 配置不同");
  }

  if (reasons.length > 0) {
    return {
      comparable: false,
      reasons,
      fixed: [],
      regressed: [],
      unchanged: [],
    };
  }

  const baseMap = new Map(
    baseline.caseResults.map((result) => [result.caseId, result])
  );
  const candMap = new Map(
    candidate.caseResults.map((result) => [result.caseId, result])
  );
  const caseIds = [
    ...new Set([...baseMap.keys(), ...candMap.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  const fixed: string[] = [];
  const regressed: string[] = [];
  const unchanged: string[] = [];

  for (const caseId of caseIds) {
    const from = baseMap.get(caseId)?.status;
    const to = candMap.get(caseId)?.status;
    if (!from || !to) {
      unchanged.push(caseId);
      continue;
    }
    if (from !== "PASS" && to === "PASS") fixed.push(caseId);
    else if (from === "PASS" && to !== "PASS") regressed.push(caseId);
    else unchanged.push(caseId);
  }

  return {
    comparable: true,
    reasons: [],
    fixed,
    regressed,
    unchanged,
    statusCounts: {
      baseline: countStatuses(baseline.caseResults),
      candidate: countStatuses(candidate.caseResults),
    },
    metricDeltas: {
      productPassRate: deltaRate(
        baseline.productPassRate,
        candidate.productPassRate
      ),
      top5HitRate: deltaScopedRate(baseline.caseResults, candidate.caseResults, (r) =>
        r.inTop5 === undefined ? null : r.inTop5
      ),
      citationAccuracy: deltaScopedRate(
        baseline.caseResults,
        candidate.caseResults,
        (r) => (r.citationCorrect === undefined ? null : r.citationCorrect)
      ),
      refusalAccuracy: deltaScopedRate(
        baseline.caseResults,
        candidate.caseResults,
        (r) => (r.refusedCorrectly === undefined ? null : r.refusedCorrectly)
      ),
    },
  };
}

function countStatuses(
  results: EvaluationBatchCaseResult[]
): Record<EvaluationRunStatus, number> {
  const counts: Record<EvaluationRunStatus, number> = {
    PASS: 0,
    FAIL: 0,
    REVIEW: 0,
    ERROR: 0,
  };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

function deltaRate(baseline: number | null, candidate: number | null): number | null {
  if (baseline == null || candidate == null) return null;
  return Number((candidate - baseline).toFixed(4));
}

function deltaScopedRate(
  baseline: EvaluationBatchCaseResult[],
  candidate: EvaluationBatchCaseResult[],
  pick: (result: EvaluationBatchCaseResult) => boolean | null
): number | null {
  const rateOf = (results: EvaluationBatchCaseResult[]) => {
    let pass = 0;
    let total = 0;
    for (const result of results) {
      if (result.status === "ERROR") continue;
      const value = pick(result);
      if (value === null) continue;
      total += 1;
      if (value) pass += 1;
    }
    return total > 0 ? pass / total : null;
  };
  return deltaRate(rateOf(baseline), rateOf(candidate));
}
