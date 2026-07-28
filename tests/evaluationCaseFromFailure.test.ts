import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationBatchCaseResult, EvaluationItem } from "../lib/types.ts";
import { buildCaseDraftFromFailure } from "../lib/evaluation/caseFromFailure.ts";

test("buildCaseDraftFromFailure copies question context and marks draft", () => {
  const source: EvaluationItem = {
    id: "eval-old",
    question: "容积率上限是多少？",
    standardAnswer: "2.5",
    correctFile: "标准.pdf",
    correctArticle: "第3条",
    correctPage: "12",
    shouldRefuse: false,
    scenario: "法规回归",
    userId: "user-admin",
    expectedBehavior: "引用正确条款",
  };
  const result: EvaluationBatchCaseResult = {
    caseId: "eval-old",
    status: "FAIL",
    systemAnswer: "错误答案",
    errorReason: "引用未命中标准条文",
    workflowTraceId: "trace-9",
  };

  const draft = buildCaseDraftFromFailure({
    source,
    result,
    batchId: "batch-1",
    now: () => "2026-07-28T08:00:00.000Z",
    newId: () => "eval-draft-1",
  });

  assert.equal(draft.draft, true);
  assert.equal(draft.question, source.question);
  assert.equal(draft.userId, "user-admin");
  assert.equal(draft.scenario, "法规回归");
  assert.equal(draft.sourceBatchId, "batch-1");
  assert.equal(draft.sourceCaseId, "eval-old");
  assert.equal(draft.sourceTraceId, "trace-9");
  // 标准依据需人工重核，不直接复用可能已过期的标注冒充金标
  assert.equal(draft.standardAnswer, "");
  assert.equal(draft.correctFile, "");
  assert.equal(draft.correctArticle, "");
  assert.equal(draft.correctPage, "");
  assert.match(draft.expectedBehavior ?? "", /待补齐/);
  assert.equal(draft.answerScore, undefined);
  assert.equal(draft.workflowTraceId, undefined);
});

test("draft can be built from result alone when snapshot missing", () => {
  const draft = buildCaseDraftFromFailure({
    result: {
      caseId: "orphan",
      status: "ERROR",
      errorReason: "运行异常：timeout",
      workflowTraceId: "t1",
    },
    batchId: "batch-2",
    newId: () => "eval-draft-2",
  });
  assert.equal(draft.draft, true);
  assert.equal(draft.question, "[从失败生成] orphan");
  assert.equal(draft.sourceTraceId, "t1");
});
