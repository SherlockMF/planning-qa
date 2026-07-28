import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationBatch } from "../lib/types.ts";
import { buildLabOverview } from "../lib/evaluation/labOverview.ts";

function batch(
  patch: Partial<EvaluationBatch> & { id: string; createdAt: string }
): EvaluationBatch {
  const { id, createdAt, ...rest } = patch;
  return {
    id,
    versionLabel: rest.versionLabel ?? id,
    changeNote: "",
    status: rest.status ?? "done",
    caseIds: rest.caseIds ?? ["a"],
    caseSnapshot: rest.caseSnapshot ?? [],
    caseSetHash: rest.caseSetHash ?? "same-cases",
    evaluatorVersion: rest.evaluatorVersion ?? "ev1",
    knowledgeIndexFingerprint: rest.knowledgeIndexFingerprint ?? "idx1",
    modelConfigSnapshot: rest.modelConfigSnapshot ?? { llm: "m" },
    ragConfigSnapshot: rest.ragConfigSnapshot ?? { city: "北京" },
    caseResults: rest.caseResults ?? [{ caseId: "a", status: "PASS" }],
    passed: rest.passed ?? 1,
    failed: rest.failed ?? 0,
    review: rest.review ?? 0,
    error: rest.error ?? 0,
    productPassRate: rest.productPassRate ?? 1,
    createdAt,
    ...rest,
  };
}

test("buildLabOverview reports no baseline when only one comparable batch", () => {
  const overview = buildLabOverview([
    batch({
      id: "b1",
      createdAt: "2026-07-28T02:00:00.000Z",
      caseResults: [{ caseId: "a", status: "FAIL", inTop5: false }],
      productPassRate: 0,
      failed: 1,
      passed: 0,
    }),
  ]);
  assert.equal(overview.latest?.id, "b1");
  assert.equal(overview.comparableBaseline, null);
  assert.equal(overview.regression, null);
  assert.match(overview.baselineNote, /尚无可比基线/);
  assert.ok((overview.topClusters?.length ?? 0) >= 1);
});

test("buildLabOverview picks latest comparable prior batch", () => {
  const overview = buildLabOverview([
    batch({
      id: "new",
      createdAt: "2026-07-28T03:00:00.000Z",
      caseResults: [{ caseId: "a", status: "PASS" }],
      productPassRate: 1,
    }),
    batch({
      id: "drift",
      createdAt: "2026-07-28T02:30:00.000Z",
      caseSetHash: "other",
      caseResults: [{ caseId: "a", status: "FAIL" }],
      productPassRate: 0,
    }),
    batch({
      id: "old",
      createdAt: "2026-07-28T02:00:00.000Z",
      caseResults: [{ caseId: "a", status: "FAIL" }],
      productPassRate: 0,
      failed: 1,
      passed: 0,
    }),
  ]);
  assert.equal(overview.latest?.id, "new");
  assert.equal(overview.comparableBaseline?.id, "old");
  assert.equal(overview.regression?.fixed.length, 1);
  assert.equal(overview.regression?.regressed.length, 0);
  assert.equal(overview.gate?.status, "passed");
});

test("buildLabOverview ignores non-done batches for latest", () => {
  const overview = buildLabOverview([
    batch({
      id: "running",
      status: "running",
      createdAt: "2026-07-28T04:00:00.000Z",
    }),
    batch({
      id: "done",
      createdAt: "2026-07-28T03:00:00.000Z",
    }),
  ]);
  assert.equal(overview.latest?.id, "done");
});
