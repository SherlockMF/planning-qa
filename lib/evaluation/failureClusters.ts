// ============================================================================
// 评测失败聚类：把 FAIL/ERROR 按模式归桶，便于优先改哪里
// ============================================================================

import type {
  EvaluationBatchCaseResult,
  EvaluationItem,
} from "../types.ts";

export type FailureClusterId =
  | "retrieval_miss"
  | "bad_citation"
  | "acl_leak_or_permission"
  | "table_numeric"
  | "false_refusal"
  | "missed_refusal"
  | "generation_incomplete"
  | "infra_error";

export interface FailureCluster {
  id: FailureClusterId;
  label: string;
  count: number;
  caseIds: string[];
  representativeErrorReason?: string;
  sampleWorkflowTraceId?: string;
}

const CLUSTER_LABELS: Record<FailureClusterId, string> = {
  retrieval_miss: "检索未进 Top5",
  bad_citation: "引用不准",
  acl_leak_or_permission: "权限/隔离失败",
  table_numeric: "表格数值错误",
  false_refusal: "误拒答",
  missed_refusal: "应拒答却作答",
  generation_incomplete: "有依据但答案不完整",
  infra_error: "系统异常",
};

export function clusterEvaluationFailures(
  results: EvaluationBatchCaseResult[],
  caseSnapshot: EvaluationItem[] = []
): FailureCluster[] {
  const byId = new Map(caseSnapshot.map((item) => [item.id, item]));
  const buckets = new Map<
    FailureClusterId,
    {
      caseIds: string[];
      reasons: string[];
      sampleWorkflowTraceId?: string;
    }
  >();

  for (const result of results) {
    if (result.status !== "FAIL" && result.status !== "ERROR") continue;
    const item = byId.get(result.caseId);
    const clusterId = classifyFailure(result, item);
    const bucket = buckets.get(clusterId) ?? {
      caseIds: [],
      reasons: [],
      sampleWorkflowTraceId: undefined,
    };
    bucket.caseIds.push(result.caseId);
    if (result.errorReason?.trim()) bucket.reasons.push(result.errorReason.trim());
    if (!bucket.sampleWorkflowTraceId && result.workflowTraceId) {
      bucket.sampleWorkflowTraceId = result.workflowTraceId;
    }
    buckets.set(clusterId, bucket);
  }

  return [...buckets.entries()]
    .map(([id, bucket]) => ({
      id,
      label: CLUSTER_LABELS[id],
      count: bucket.caseIds.length,
      caseIds: bucket.caseIds,
      representativeErrorReason: mostCommon(bucket.reasons),
      sampleWorkflowTraceId: bucket.sampleWorkflowTraceId,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function classifyFailure(
  result: EvaluationBatchCaseResult,
  item?: EvaluationItem
): FailureClusterId {
  if (result.status === "ERROR") return "infra_error";

  if (item && isPermissionCase(item) && result.status === "FAIL") {
    return "acl_leak_or_permission";
  }

  if (item && isTableNumericCase(item) && result.status === "FAIL") {
    return "table_numeric";
  }
  if (/缺少数值|禁用值|数值断言/.test(result.errorReason ?? "")) {
    return "table_numeric";
  }

  if (result.inTop5 === false) return "retrieval_miss";

  if (item?.shouldRefuse && result.refusedCorrectly === false) {
    return "missed_refusal";
  }

  if (
    (!item?.shouldRefuse && /误拒答|召回不足/.test(result.errorReason ?? "")) ||
    (!item?.shouldRefuse &&
      result.autoAnswerScore === 0 &&
      /拒答/.test(result.errorReason ?? ""))
  ) {
    return "false_refusal";
  }

  if (result.citationCorrect === false) return "bad_citation";

  return "generation_incomplete";
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

function mostCommon(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0]?.[0];
}
