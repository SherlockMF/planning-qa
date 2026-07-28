// ============================================================================
// /lab 概览：最近可比 batch、gate 灯、Top 失败簇
// ============================================================================

import type {
  EvaluationBatch,
  EvaluationBatchCompareResult,
} from "../types.ts";
import { compareEvaluationBatches } from "./batchCompare.ts";
import {
  clusterEvaluationFailures,
  type FailureCluster,
} from "./failureClusters.ts";
import {
  evaluateReleaseGate,
  type ReleaseGateResult,
} from "./releaseGate.ts";

export interface LabOverview {
  latest: EvaluationBatch | null;
  comparableBaseline: EvaluationBatch | null;
  baselineNote: string;
  gate: ReleaseGateResult | null;
  regression: EvaluationBatchCompareResult | null;
  topClusters: FailureCluster[];
}

export function buildLabOverview(batches: EvaluationBatch[]): LabOverview {
  const done = batches
    .filter((batch) => batch.status === "done")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const latest = done[0] ?? null;
  if (!latest) {
    return {
      latest: null,
      comparableBaseline: null,
      baselineNote: "尚无已完成的评测批次",
      gate: null,
      regression: null,
      topClusters: [],
    };
  }

  const comparableBaseline =
    done.slice(1).find((candidate) => {
      const compare = compareEvaluationBatches(candidate, latest);
      return compare.comparable;
    }) ?? null;

  const regression = comparableBaseline
    ? compareEvaluationBatches(comparableBaseline, latest)
    : null;

  return {
    latest,
    comparableBaseline,
    baselineNote: comparableBaseline
      ? `对比基线：${comparableBaseline.versionLabel}`
      : "尚无可比基线（题库/索引/模型配置需一致才能看趋势）",
    gate: evaluateReleaseGate(latest),
    regression,
    topClusters: clusterEvaluationFailures(
      latest.caseResults,
      latest.caseSnapshot
    ).slice(0, 3),
  };
}
