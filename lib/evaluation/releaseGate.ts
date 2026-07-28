// ============================================================================
// 评测发布门槛：只出报告与 UI 灯，不改生产配置
// ============================================================================

import type {
  EvaluationBatch,
  EvaluationBatchCaseResult,
  EvaluationItem,
} from "../types.ts";
import { clusterEvaluationFailures } from "./failureClusters.ts";

/** 核心集产品通过率下限 */
export const RELEASE_GATE_MIN_PRODUCT_PASS_RATE = 0.85;
/** ERROR 占全部结果的上限（含 ERROR 进分母） */
export const RELEASE_GATE_MAX_ERROR_RATE = 0.05;

export type ReleaseGateStatus = "passed" | "failed" | "blocked_infra";

export interface ReleaseGateRuleResult {
  id: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface ReleaseGateResult {
  status: ReleaseGateStatus;
  rules: ReleaseGateRuleResult[];
  summary: string;
}

export function evaluateReleaseGate(
  batch: EvaluationBatch,
  options: {
    minProductPassRate?: number;
    maxErrorRate?: number;
  } = {}
): ReleaseGateResult {
  const minPass = options.minProductPassRate ?? RELEASE_GATE_MIN_PRODUCT_PASS_RATE;
  const maxError = options.maxErrorRate ?? RELEASE_GATE_MAX_ERROR_RATE;
  const snapshot = batch.caseSnapshot;
  const results = batch.caseResults;
  const clusters = clusterEvaluationFailures(results, snapshot);

  const permissionFails =
    clusters.find((c) => c.id === "acl_leak_or_permission")?.count ?? 0;
  const tableFails = countTableNumericFails(results, snapshot);
  const hasTableCases = snapshot.some(isTableNumericCase) || tableFails > 0;
  const total = results.length;
  const errorRate = total > 0 ? batch.error / total : 0;
  const passRate = batch.productPassRate;

  const rules: ReleaseGateRuleResult[] = [
    {
      id: "permission_zero_fail",
      label: "权限/隔离失败数为 0",
      passed: permissionFails === 0,
      evidence:
        permissionFails === 0
          ? "未发现权限隔离失败"
          : `权限/隔离失败 ${permissionFails} 题`,
    },
    {
      id: "table_numeric_zero_fail",
      label: "表格数值失败数为 0（若含该类题）",
      passed: !hasTableCases || tableFails === 0,
      evidence: !hasTableCases
        ? "本批无表格数值题，跳过"
        : tableFails === 0
          ? "表格数值题全部通过"
          : `表格数值失败 ${tableFails} 题`,
    },
    {
      id: "product_pass_rate",
      label: `产品通过率 ≥ ${(minPass * 100).toFixed(0)}%`,
      passed: passRate != null && passRate >= minPass,
      evidence:
        passRate == null
          ? "尚无有效质量样本（可能全是 ERROR）"
          : `当前 ${(passRate * 100).toFixed(1)}%（阈值 ${(minPass * 100).toFixed(0)}%）`,
    },
    {
      id: "error_rate_cap",
      label: `系统异常率 ≤ ${(maxError * 100).toFixed(0)}%`,
      passed: errorRate <= maxError,
      evidence: `ERROR ${batch.error}/${total || 0} = ${(errorRate * 100).toFixed(1)}%`,
    },
  ];

  const infraBlocked = !rules.find((r) => r.id === "error_rate_cap")!.passed;
  const softFailed = rules.some((r) => r.id !== "error_rate_cap" && !r.passed);

  let status: ReleaseGateStatus = "passed";
  if (infraBlocked) status = "blocked_infra";
  else if (softFailed) status = "failed";

  return {
    status,
    rules,
    summary:
      status === "passed"
        ? "达到发布门槛（仅建议，不自动变更生产配置）"
        : status === "blocked_infra"
          ? "系统异常率过高，先排除基础设施问题"
          : "未达质量门槛，请查看失败规则",
  };
}

function countTableNumericFails(
  results: EvaluationBatchCaseResult[],
  snapshot: EvaluationItem[]
): number {
  const byId = new Map(snapshot.map((item) => [item.id, item]));
  return results.filter((result) => {
    if (result.status !== "FAIL") return false;
    const item = byId.get(result.caseId);
    return (
      (item && isTableNumericCase(item)) ||
      /缺少数值|禁用值|数值断言/.test(result.errorReason ?? "")
    );
  }).length;
}

function isTableNumericCase(item: EvaluationItem): boolean {
  return (
    item.scenario === "PDF数值回归" ||
    (item.expectedAnswerValues?.length ?? 0) > 0 ||
    /表格|数值|指标/.test(item.expectedBehavior ?? "")
  );
}
