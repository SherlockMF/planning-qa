// ============================================================================
// 评测跑测 → 工作流审计的绑定
// ----------------------------------------------------------------------------
// 每道题跑一次问答链路，就产出一条 query 审计记录，把 traceId 回写到评测结果，
// 使「这一题为什么是这个分」可以一路追到召回、权限与生成细节。
// 审计只在单题结束时落盘一次：评测是批量跑的，逐步骤写盘会放大 IO。
// ============================================================================

import type { EvaluationItem } from "../types.ts";
import type { WorkflowTrace } from "../workflow/types.ts";
import { WorkflowTraceRecorder, createWorkflowTrace } from "../workflow/trace.ts";
import {
  findLatestIngestionTrace,
  listWorkflowTraces,
  persistWorkflowTraceSafely,
} from "../db/workflowTraces.ts";

export interface EvaluationTraceRunInput<T> {
  item: Pick<EvaluationItem, "id" | "question">;
  /** 本题模拟的提问账号，决定权限过滤结果。 */
  simulatedUserId: string;
  /** 触发跑测的执行者；评测由后台批量触发，默认与模拟账号一致。 */
  actorUserId?: string;
  run: (recorder: WorkflowTraceRecorder) => Promise<T>;
  /** run 用返回值携带软错误时（如 withUsageTracking），从中取出错误。 */
  errorOf?: (value: T) => unknown;
  persist?: (trace: WorkflowTrace) => void;
  resolveIngestionTraceIds?: (trace: WorkflowTrace) => string[];
  now?: () => string;
  traceId?: string;
}

export interface EvaluationTraceRunResult<T> {
  traceId: string;
  runStartedAt: string;
  runFinishedAt: string;
  value?: T;
  error?: unknown;
}

export async function runEvaluationWithTrace<T>(
  input: EvaluationTraceRunInput<T>
): Promise<EvaluationTraceRunResult<T>> {
  const now = input.now ?? (() => new Date().toISOString());
  const runStartedAt = now();
  const trace = createWorkflowTrace({
    id: input.traceId ?? buildTraceId(input.item.id),
    kind: "query",
    actorUserId: input.actorUserId ?? input.simulatedUserId,
    simulatedUserId: input.simulatedUserId,
    question: input.item.question,
    now: runStartedAt,
  });
  const recorder = new WorkflowTraceRecorder(trace);

  let value: T | undefined;
  let error: unknown;
  try {
    value = await input.run(recorder);
    error = input.errorOf && value !== undefined ? input.errorOf(value) : undefined;
  } catch (cause) {
    error = cause;
  }

  if (error) markTraceFailed(recorder, error);
  else if (trace.status === "running") recorder.finish();

  const resolveIngestionTraceIds =
    input.resolveIngestionTraceIds ?? defaultIngestionTraceIds;
  try {
    trace.ingestionTraceIds = resolveIngestionTraceIds(trace);
  } catch (cause) {
    console.error("[evaluation-trace] resolve ingestion traces failed:", cause);
  }

  persistWorkflowTraceSafely(trace, input.persist);

  return {
    traceId: trace.id,
    runStartedAt,
    runFinishedAt: now(),
    value,
    error,
  };
}

function buildTraceId(itemId: string): string {
  return `eval-${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 把错误落在当前未完成的步骤上，让审计台能定位链路断点。 */
function markTraceFailed(recorder: WorkflowTraceRecorder, error: unknown): void {
  if (recorder.trace.status !== "running") return;
  const active =
    recorder.trace.steps.find((step) => step.status === "running") ??
    recorder.trace.steps.find((step) => step.status === "pending");
  if (!active) {
    recorder.trace.status = "failed";
    return;
  }
  if (active.status === "pending") recorder.start(active.key);
  recorder.fail(active.key, error);
}

function defaultIngestionTraceIds(trace: WorkflowTrace): string[] {
  if (trace.relatedDocumentIds.length === 0) return [];
  const ingestionTraces = listWorkflowTraces({ kind: "ingestion" });
  return trace.relatedDocumentIds.map(
    (documentId) =>
      findLatestIngestionTrace(ingestionTraces, documentId)?.id ??
      `reconstructed-${documentId}`
  );
}
