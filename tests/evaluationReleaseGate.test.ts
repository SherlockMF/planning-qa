import test from "node:test";
import assert from "node:assert/strict";

import type {
  EvaluationBatch,
  EvaluationBatchCaseResult,
  EvaluationItem,
} from "../lib/types.ts";
import { evaluateReleaseGate } from "../lib/evaluation/releaseGate.ts";

function batch(
  results: EvaluationBatchCaseResult[],
  snapshot: EvaluationItem[] = []
): EvaluationBatch {
  const counts = { PASS: 0, FAIL: 0, REVIEW: 0, ERROR: 0 };
  for (const r of results) counts[r.status] += 1;
  const quality = counts.PASS + counts.FAIL + counts.REVIEW;
  return {
    id: "batch-1",
    versionLabel: "v1",
    changeNote: "",
    status: "done",
    caseIds: results.map((r) => r.caseId),
    caseSnapshot: snapshot,
    caseSetHash: "h",
    evaluatorVersion: "e",
    knowledgeIndexFingerprint: "i",
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    caseResults: results,
    passed: counts.PASS,
    failed: counts.FAIL,
    review: counts.REVIEW,
    error: counts.ERROR,
    productPassRate: quality > 0 ? counts.PASS / quality : null,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

function item(
  patch: Partial<EvaluationItem> & { id: string }
): EvaluationItem {
  const { id, ...rest } = patch;
  return {
    id,
    question: "q",
    standardAnswer: "a",
    correctFile: "f.pdf",
    correctArticle: "",
    correctPage: "",
    shouldRefuse: false,
    ...rest,
  };
}

test("gate passes when core rates and hard zeros hold", () => {
  const result = evaluateReleaseGate(
    batch(
      [
        { caseId: "a", status: "PASS" },
        { caseId: "b", status: "PASS" },
        { caseId: "c", status: "PASS" },
        { caseId: "d", status: "PASS" },
        { caseId: "e", status: "PASS" },
        { caseId: "f", status: "PASS" },
        { caseId: "g", status: "REVIEW" },
      ],
      [
        item({ id: "a" }),
        item({ id: "b" }),
        item({ id: "c" }),
        item({ id: "d" }),
        item({ id: "e" }),
        item({ id: "f" }),
        item({ id: "g" }),
      ]
    )
  );
  assert.equal(result.status, "passed");
  assert.ok(result.rules.every((rule) => rule.passed));
});

test("permission FAIL blocks the gate", () => {
  const result = evaluateReleaseGate(
    batch(
      [{ caseId: "p1", status: "FAIL", refusedCorrectly: false }],
      [
        item({
          id: "p1",
          shouldRefuse: true,
          scenario: "项目权限",
          expectedBehavior: "防泄露",
        }),
      ]
    )
  );
  assert.equal(result.status, "failed");
  const perm = result.rules.find((rule) => rule.id === "permission_zero_fail");
  assert.equal(perm?.passed, false);
});

test("table numeric FAIL blocks the gate when such cases exist", () => {
  const result = evaluateReleaseGate(
    batch(
      [{ caseId: "n1", status: "FAIL", errorReason: "缺少数值：1700" }],
      [
        item({
          id: "n1",
          scenario: "PDF数值回归",
          expectedAnswerValues: ["1700"],
        }),
      ]
    )
  );
  assert.equal(result.status, "failed");
  assert.equal(
    result.rules.find((rule) => rule.id === "table_numeric_zero_fail")?.passed,
    false
  );
});

test("high ERROR rate yields blocked_infra", () => {
  const result = evaluateReleaseGate(
    batch([
      { caseId: "a", status: "PASS" },
      { caseId: "b", status: "ERROR" },
      { caseId: "c", status: "ERROR" },
      { caseId: "d", status: "ERROR" },
    ])
  );
  assert.equal(result.status, "blocked_infra");
  assert.equal(
    result.rules.find((rule) => rule.id === "error_rate_cap")?.passed,
    false
  );
});

test("low productPassRate fails the gate", () => {
  const result = evaluateReleaseGate(
    batch([
      { caseId: "a", status: "PASS" },
      { caseId: "b", status: "FAIL" },
      { caseId: "c", status: "FAIL" },
      { caseId: "d", status: "FAIL" },
    ])
  );
  assert.equal(result.status, "failed");
  assert.equal(
    result.rules.find((rule) => rule.id === "product_pass_rate")?.passed,
    false
  );
});
