import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowTraceRecorder,
  createWorkflowTrace,
  sanitizeWorkflowSummary,
} from "../lib/workflow/trace.ts";

test("query trace starts with the complete ordered workflow skeleton", () => {
  const trace = createWorkflowTrace({
    id: "trace-query-1",
    kind: "query",
    actorUserId: "user-admin",
    simulatedUserId: "user-employee-riverfront",
    question: "社区卫生服务中心的服务规模是多少？",
    now: "2026-07-14T10:00:00.000Z",
  });

  assert.equal(trace.status, "running");
  assert.equal(trace.steps.length, 12);
  assert.deepEqual(
    trace.steps.map((step) => step.key),
    [
      "input_safety",
      "scope_check",
      "permission_filter",
      "query_signals",
      "multi_recall",
      "rerank",
      "context_expansion",
      "evidence_gate",
      "conclusion_generation",
      "citation_assembly",
      "answer_reflection",
      "final_output",
    ]
  );
  assert.ok(trace.steps.every((step) => step.status === "pending"));
});

test("recorder completes a step with duration and emits sanitized details", () => {
  const trace = createWorkflowTrace({
    id: "trace-query-2",
    kind: "query",
    actorUserId: "user-admin",
    now: "2026-07-14T10:00:00.000Z",
  });
  const events: string[] = [];
  const recorder = new WorkflowTraceRecorder(trace, (event) => {
    events.push(event.type);
  });

  recorder.start("input_safety", "2026-07-14T10:00:01.000Z");
  recorder.complete(
    "input_safety",
    {
      outputSummary: {
        safe: true,
        content: "x".repeat(500),
        systemPrompt: "never persist this",
        embedding: [0.1, 0.2, 0.3],
      },
    },
    "2026-07-14T10:00:01.125Z"
  );

  const step = trace.steps[0];
  assert.equal(step.status, "completed");
  assert.equal(step.durationMs, 125);
  assert.equal(step.outputSummary?.safe, true);
  assert.equal(step.outputSummary?.systemPrompt, "[REDACTED]");
  assert.equal(step.outputSummary?.embedding, "[REDACTED]");
  assert.match(String(step.outputSummary?.content), /…\[truncated 220 chars\]$/);
  assert.deepEqual(events, ["step.started", "step.completed"]);
});

test("blocking a step skips every later pending step and completes the trace", () => {
  const trace = createWorkflowTrace({
    id: "trace-query-3",
    kind: "query",
    actorUserId: "user-admin",
    now: "2026-07-14T10:00:00.000Z",
  });
  const recorder = new WorkflowTraceRecorder(trace);

  recorder.start("input_safety", "2026-07-14T10:00:00.010Z");
  recorder.block(
    "input_safety",
    { outcome: "blocked", reasonCode: "prompt_injection" },
    "2026-07-14T10:00:00.030Z"
  );

  assert.equal(trace.status, "blocked");
  assert.equal(trace.completedAt, "2026-07-14T10:00:00.030Z");
  assert.equal(trace.steps[0].status, "blocked");
  assert.ok(trace.steps.slice(1).every((step) => step.status === "skipped"));
  assert.ok(
    trace.steps
      .slice(1)
      .every((step) => step.decision?.reasonCode === "blocked_by_input_safety")
  );
});

test("ingestion trace uses the six document-processing steps", () => {
  const trace = createWorkflowTrace({
    id: "trace-ingestion-1",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
    now: "2026-07-14T10:00:00.000Z",
  });

  assert.deepEqual(
    trace.steps.map((step) => step.key),
    [
      "upload_registration",
      "content_parsing",
      "knowledge_objects",
      "chunking",
      "embedding",
      "persistence",
    ]
  );
});

test("summary sanitizer limits arrays and records the omitted count", () => {
  const sanitized = sanitizeWorkflowSummary({
    candidates: Array.from({ length: 15 }, (_, index) => ({ id: index })),
  });

  assert.equal((sanitized.candidates as unknown[]).length, 13);
  assert.deepEqual((sanitized.candidates as unknown[])[12], {
    truncatedItems: 3,
  });
});

test("recorder callback failure never interrupts workflow state changes", () => {
  const trace = createWorkflowTrace({
    id: "trace-callback-failure",
    kind: "query",
    actorUserId: "user-admin",
  });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const recorder = new WorkflowTraceRecorder(trace, () => {
      throw new Error("stream disconnected");
    });
    assert.doesNotThrow(() => recorder.start("input_safety"));
    assert.equal(trace.steps[0].status, "running");
  } finally {
    console.error = originalError;
  }
});

test("failing a step sanitizes errors and closes later running steps", () => {
  const trace = createWorkflowTrace({
    id: "trace-failure-sanitize",
    kind: "ingestion",
    actorUserId: "user-admin",
  });
  const recorder = new WorkflowTraceRecorder(trace);
  recorder.start("knowledge_objects");
  recorder.start("chunking");
  recorder.fail(
    "knowledge_objects",
    new Error(`systemPrompt=${"secret".repeat(100)}`)
  );

  assert.equal(trace.steps[2].status, "failed");
  assert.equal(trace.steps[3].status, "skipped");
  assert.ok((trace.steps[2].decision?.explanation?.length ?? 0) <= 320);
  assert.doesNotMatch(
    trace.steps[2].decision?.explanation ?? "",
    /secretsecret/
  );
  assert.match(trace.steps[2].decision?.explanation ?? "", /\[REDACTED\]/);
});
