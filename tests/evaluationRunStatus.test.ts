import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationItem } from "../lib/types.ts";
import {
  deriveEvaluationRunStatus,
  resolveEvaluationRunStatus,
} from "../lib/evaluation/runStatus.ts";

function item(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "eval-status",
    question: patch.question ?? "测试问题",
    standardAnswer: patch.standardAnswer ?? "标准答案",
    correctFile: patch.correctFile ?? "测试文件.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

test("未运行的题目没有自动状态", () => {
  assert.equal(deriveEvaluationRunStatus(item({})), undefined);
});

test("系统异常判为 ERROR，且不受已有分数影响", () => {
  assert.equal(
    deriveEvaluationRunStatus(
      item({ runErrored: true, errorReason: "运行异常：timeout" })
    ),
    "ERROR"
  );
  assert.equal(
    deriveEvaluationRunStatus(
      item({ runErrored: true, answerScore: 2, errorReason: "运行异常：timeout" })
    ),
    "ERROR"
  );
});

test("硬失败判为 FAIL：应拒答却作答 / 数值断言失败", () => {
  assert.equal(
    deriveEvaluationRunStatus(
      item({
        shouldRefuse: true,
        refusedCorrectly: false,
        answerScore: 0,
        errorReason: "应拒答却作答",
      })
    ),
    "FAIL"
  );
  assert.equal(
    deriveEvaluationRunStatus(
      item({ answerScore: 0, errorReason: "缺少数值：1700" })
    ),
    "FAIL"
  );
});

test("部分正确（1 分）判为 REVIEW", () => {
  assert.equal(
    deriveEvaluationRunStatus(
      item({ answerScore: 1, errorReason: "引用未命中标准条文" })
    ),
    "REVIEW"
  );
});

test("满分但只靠弱信号命中判为 REVIEW", () => {
  assert.equal(
    deriveEvaluationRunStatus(
      item({ answerScore: 2, citationCorrect: true, autoJudgeUncertain: true })
    ),
    "REVIEW"
  );
});

test("满分且判定依据明确判为 PASS", () => {
  assert.equal(
    deriveEvaluationRunStatus(
      item({ answerScore: 2, citationCorrect: true, inTop5: true })
    ),
    "PASS"
  );
  assert.equal(
    deriveEvaluationRunStatus(
      item({ shouldRefuse: true, refusedCorrectly: true, answerScore: 2 })
    ),
    "PASS"
  );
});

test("人工终判覆盖展示状态，自动状态仍保留在 autoStatus", () => {
  const reviewed = item({
    answerScore: 1,
    autoAnswerScore: 1,
    autoStatus: "REVIEW",
    finalAnswerScore: 2,
    finalStatus: "PASS",
    reviewedBy: "user-admin",
    reviewReason: "引用页码偏移但内容正确",
  });
  assert.equal(resolveEvaluationRunStatus(reviewed), "PASS");
  assert.equal(reviewed.autoStatus, "REVIEW");
});

test("无人工终判时展示状态回落到自动状态", () => {
  assert.equal(
    resolveEvaluationRunStatus(item({ answerScore: 0, autoStatus: "FAIL" })),
    "FAIL"
  );
  assert.equal(
    resolveEvaluationRunStatus(item({ answerScore: 2 })),
    "PASS",
    "历史数据没有 autoStatus 时按结果字段现推"
  );
  assert.equal(resolveEvaluationRunStatus(item({})), undefined);
});
