import test from "node:test";
import assert from "node:assert/strict";

import type { WorkflowTrace } from "../lib/workflow/types.ts";
import { runEvaluationWithTrace } from "../lib/evaluation/runTrace.ts";

function collector() {
  const saved: WorkflowTrace[] = [];
  return {
    saved,
    persist: (trace: WorkflowTrace) => {
      saved.push(structuredClone(trace));
      return true;
    },
  };
}

test("成功跑测把审计记录写盘并回传 traceId", async () => {
  const store = collector();

  const result = await runEvaluationWithTrace({
    item: { id: "eval-1", question: "二类居住用地是什么？" },
    simulatedUserId: "user-engineer",
    persist: store.persist,
    resolveIngestionTraceIds: () => ["ingestion-doc-1"],
    run: async (recorder) => {
      recorder.start("input_safety");
      recorder.complete("input_safety");
      recorder.trace.relatedDocumentIds.push("doc-1");
      recorder.finish();
      return "answer";
    },
  });

  assert.ok(result.traceId, "必须返回 traceId");
  assert.equal(result.value, "answer");
  assert.equal(result.error, undefined);
  assert.ok(result.runStartedAt);
  assert.ok(result.runFinishedAt);

  const persisted = store.saved.at(-1)!;
  assert.equal(persisted.id, result.traceId);
  assert.equal(persisted.kind, "query");
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.question, "二类居住用地是什么？");
  assert.equal(persisted.simulatedUserId, "user-engineer");
  assert.deepEqual(persisted.ingestionTraceIds, ["ingestion-doc-1"]);
});

test("run 抛错时记录失败链路，并仍然回传 traceId", async () => {
  const store = collector();

  const result = await runEvaluationWithTrace({
    item: { id: "eval-2", question: "超时的问题" },
    simulatedUserId: "user-engineer",
    persist: store.persist,
    run: async (recorder) => {
      recorder.start("input_safety");
      throw new Error("Request timeout");
    },
  });

  assert.ok(result.traceId);
  assert.equal(result.value, undefined);
  assert.equal((result.error as Error).message, "Request timeout");

  const persisted = store.saved.at(-1)!;
  assert.equal(persisted.status, "failed");
  const failed = persisted.steps.find((step) => step.status === "failed");
  assert.equal(failed?.key, "input_safety");
  assert.equal(failed?.decision?.explanation, "Request timeout");
});

test("run 以返回值携带软错误时同样记为失败链路", async () => {
  const store = collector();

  const result = await runEvaluationWithTrace({
    item: { id: "eval-3", question: "限流的问题" },
    simulatedUserId: "user-engineer",
    persist: store.persist,
    run: async () => ({ error: new Error("rate limited"), durationMs: 12 }),
    errorOf: (value) => value.error,
  });

  assert.equal(result.value?.durationMs, 12, "软错误时仍需回传运行指标");
  assert.equal((result.error as Error).message, "rate limited");
  assert.equal(store.saved.at(-1)!.status, "failed");
});

test("审计落盘失败不影响跑测结果", async () => {
  const result = await runEvaluationWithTrace({
    item: { id: "eval-4", question: "落盘失败" },
    simulatedUserId: "user-engineer",
    persist: () => {
      throw new Error("disk full");
    },
    run: async (recorder) => {
      recorder.finish();
      return "answer";
    },
  });

  assert.equal(result.value, "answer");
  assert.equal(result.error, undefined);
  assert.ok(result.traceId);
});
