import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationItem } from "../lib/types.ts";
import { toEvaluationCaseSnapshot } from "../lib/evaluation/caseSnapshot.ts";

test("toEvaluationCaseSnapshot strips run and review fields", () => {
  const item: EvaluationItem = {
    id: "eval-1",
    question: "容积率上限？",
    standardAnswer: "2.5",
    correctFile: "标准.pdf",
    correctArticle: "第3条",
    correctPage: "12",
    shouldRefuse: false,
    scenario: "法规回归",
    userId: "user-admin",
    expectedBehavior: "引用正确条款",
    expectedAnswerValues: ["2.5"],
    systemAnswer: "答案",
    answerScore: 2,
    autoAnswerScore: 2,
    autoStatus: "PASS",
    status: "PASS",
    finalStatus: "PASS",
    finalAnswerScore: 2,
    workflowTraceId: "trace-1",
    inTop5: true,
    citationCorrect: true,
    reviewedBy: "user-admin",
    reviewReason: "ok",
  };

  const snapshot = toEvaluationCaseSnapshot(item);

  assert.equal(snapshot.id, "eval-1");
  assert.equal(snapshot.question, "容积率上限？");
  assert.equal(snapshot.expectedAnswerValues?.[0], "2.5");
  assert.equal(snapshot.systemAnswer, undefined);
  assert.equal(snapshot.answerScore, undefined);
  assert.equal(snapshot.autoStatus, undefined);
  assert.equal(snapshot.workflowTraceId, undefined);
  assert.equal(snapshot.inTop5, undefined);
  assert.equal(snapshot.reviewedBy, undefined);
});
