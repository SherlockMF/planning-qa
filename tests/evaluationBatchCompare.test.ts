import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationBatch, EvaluationBatchCaseResult } from "../lib/types.ts";
import { compareEvaluationBatches } from "../lib/evaluation/batchCompare.ts";

function batch(
  patch: Partial<EvaluationBatch> & {
    id: string;
    caseResults?: EvaluationBatchCaseResult[];
  }
): EvaluationBatch {
  const { id, ...rest } = patch;
  return {
    id,
    versionLabel: rest.versionLabel ?? id,
    changeNote: rest.changeNote ?? "",
    status: rest.status ?? "done",
    caseIds: rest.caseIds ?? ["a", "b"],
    caseSnapshot: rest.caseSnapshot ?? [],
    caseSetHash: rest.caseSetHash ?? "cases-1",
    evaluatorVersion: rest.evaluatorVersion ?? "eval-scorer-v1",
    knowledgeIndexFingerprint: rest.knowledgeIndexFingerprint ?? "idx-1",
    modelConfigSnapshot: rest.modelConfigSnapshot ?? { llm: "mock" },
    ragConfigSnapshot: rest.ragConfigSnapshot ?? { city: "北京" },
    caseResults: rest.caseResults ?? [],
    passed: rest.passed ?? 0,
    failed: rest.failed ?? 0,
    review: rest.review ?? 0,
    error: rest.error ?? 0,
    productPassRate: rest.productPassRate ?? null,
    createdAt: rest.createdAt ?? "2026-07-28T00:00:00.000Z",
    ...rest,
  };
}

test("compare rejects when fingerprints differ", () => {
  const baseline = batch({ id: "b1", caseSetHash: "c1" });
  const candidate = batch({ id: "b2", caseSetHash: "c2" });
  const result = compareEvaluationBatches(baseline, candidate);
  assert.equal(result.comparable, false);
  assert.ok(result.reasons.some((r) => /caseSetHash/.test(r)));
  assert.deepEqual(result.fixed, []);
  assert.deepEqual(result.regressed, []);
});

test("compare rejects on knowledge index or evaluator drift", () => {
  const baseline = batch({ id: "b1" });
  const idx = compareEvaluationBatches(
    baseline,
    batch({ id: "b2", knowledgeIndexFingerprint: "idx-2" })
  );
  assert.equal(idx.comparable, false);
  assert.ok(idx.reasons.some((r) => /knowledgeIndexFingerprint/.test(r)));

  const ev = compareEvaluationBatches(
    baseline,
    batch({ id: "b3", evaluatorVersion: "eval-scorer-v2" })
  );
  assert.equal(ev.comparable, false);
  assert.ok(ev.reasons.some((r) => /evaluatorVersion/.test(r)));
});

test("comparable batches report fixed / regressed / unchanged", () => {
  const baseline = batch({
    id: "b1",
    caseResults: [
      { caseId: "a", status: "FAIL" },
      { caseId: "b", status: "PASS", inTop5: true, citationCorrect: true },
      { caseId: "c", status: "PASS" },
      {
        caseId: "d",
        status: "FAIL",
        refusedCorrectly: false,
      },
    ],
    productPassRate: 0.5,
  });
  const candidate = batch({
    id: "b2",
    caseResults: [
      { caseId: "a", status: "PASS" },
      { caseId: "b", status: "FAIL", inTop5: false, citationCorrect: false },
      { caseId: "c", status: "PASS" },
      {
        caseId: "d",
        status: "FAIL",
        refusedCorrectly: false,
      },
    ],
    productPassRate: 0.5,
  });

  const result = compareEvaluationBatches(baseline, candidate);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.fixed, ["a"]);
  assert.deepEqual(result.regressed, ["b"]);
  assert.ok(result.unchanged.includes("c"));
  assert.ok(result.unchanged.includes("d"));
  assert.ok(result.metricDeltas);
  assert.equal(result.metricDeltas?.productPassRate, 0);
});
