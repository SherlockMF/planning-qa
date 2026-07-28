import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationBatchCaseResult, EvaluationItem } from "../lib/types.ts";
import { clusterEvaluationFailures } from "../lib/evaluation/failureClusters.ts";

function result(
  patch: Partial<EvaluationBatchCaseResult> & { caseId: string }
): EvaluationBatchCaseResult {
  return {
    status: patch.status ?? "FAIL",
    ...patch,
  };
}

function snap(patch: Partial<EvaluationItem> & { id: string }): EvaluationItem {
  return {
    id: patch.id,
    question: patch.question ?? "q",
    standardAnswer: patch.standardAnswer ?? "",
    correctFile: patch.correctFile ?? "",
    correctArticle: "",
    correctPage: "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

test("clusterEvaluationFailures groups by failure mode", () => {
  const clusters = clusterEvaluationFailures(
    [
      result({
        caseId: "r1",
        status: "FAIL",
        inTop5: false,
        errorReason: "召回不足 / 误拒答",
        workflowTraceId: "t-r1",
      }),
      result({
        caseId: "c1",
        status: "FAIL",
        inTop5: true,
        citationCorrect: false,
        errorReason: "引用未命中标准条文",
        workflowTraceId: "t-c1",
      }),
      result({
        caseId: "p1",
        status: "FAIL",
        refusedCorrectly: false,
        errorReason: "应拒答却作答",
      }),
      result({
        caseId: "n1",
        status: "FAIL",
        errorReason: "缺少数值：1700",
      }),
      result({
        caseId: "e1",
        status: "ERROR",
        errorReason: "运行异常：timeout",
        workflowTraceId: "t-e1",
      }),
      result({ caseId: "ok", status: "PASS" }),
    ],
    [
      snap({ id: "r1" }),
      snap({ id: "c1" }),
      snap({
        id: "p1",
        shouldRefuse: true,
        scenario: "项目权限",
        expectedBehavior: "无权资料应拒答，防泄露",
      }),
      snap({
        id: "n1",
        scenario: "PDF数值回归",
        expectedAnswerValues: ["1700"],
      }),
      snap({ id: "e1" }),
      snap({ id: "ok" }),
    ]
  );

  const byId = Object.fromEntries(clusters.map((c) => [c.id, c]));
  assert.equal(byId.retrieval_miss.count, 1);
  assert.deepEqual(byId.retrieval_miss.caseIds, ["r1"]);
  assert.equal(byId.retrieval_miss.sampleWorkflowTraceId, "t-r1");

  assert.equal(byId.bad_citation.count, 1);
  assert.equal(byId.acl_leak_or_permission.count, 1);
  assert.equal(byId.table_numeric.count, 1);
  assert.equal(byId.infra_error.count, 1);
  assert.equal(byId.missed_refusal?.count ?? 0, 0, "权限拒答失败归 acl 簇优先");
});

test("false_refusal and missed_refusal are distinguished", () => {
  const clusters = clusterEvaluationFailures(
    [
      result({
        caseId: "fr",
        status: "FAIL",
        errorReason: "召回不足 / 误拒答",
      }),
      result({
        caseId: "mr",
        status: "FAIL",
        refusedCorrectly: false,
        errorReason: "应拒答却作答",
      }),
    ],
    [
      snap({ id: "fr", shouldRefuse: false }),
      snap({ id: "mr", shouldRefuse: true }),
    ]
  );
  const byId = Object.fromEntries(clusters.map((c) => [c.id, c]));
  assert.equal(byId.false_refusal.count, 1);
  assert.equal(byId.missed_refusal.count, 1);
});

test("PASS and REVIEW without hard failure are not clustered", () => {
  const clusters = clusterEvaluationFailures(
    [
      result({ caseId: "p", status: "PASS" }),
      result({
        caseId: "r",
        status: "REVIEW",
        autoAnswerScore: 1,
        errorReason: "引用未命中标准条文",
      }),
    ],
    [snap({ id: "p" }), snap({ id: "r" })]
  );
  assert.equal(clusters.length, 0);
});
