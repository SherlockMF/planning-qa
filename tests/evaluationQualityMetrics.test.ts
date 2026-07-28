import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationItem } from "../lib/types.ts";
import { computeQualityMetrics } from "../lib/evaluation/qualityMetrics.ts";

function item(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "eval-test",
    question: patch.question ?? "测试问题",
    standardAnswer: patch.standardAnswer ?? "标准答案",
    correctFile: patch.correctFile ?? "测试文件.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

test("computeQualityMetrics groups AI product quality signals for interview readout", () => {
  const summary = computeQualityMetrics([
    item({
      id: "normal-pass",
      scenario: "项目资料问答",
      inTop5: true,
      citationCorrect: true,
      answerScore: 2,
    }),
    item({
      id: "numeric-pass",
      scenario: "PDF数值回归",
      expectedAnswerValues: ["1700"],
      inTop5: true,
      citationCorrect: true,
      answerScore: 2,
    }),
    item({
      id: "permission-pass",
      scenario: "项目权限",
      shouldRefuse: true,
      refusedCorrectly: true,
      answerScore: 2,
    }),
    item({
      id: "citation-fail",
      scenario: "行业垂直知识",
      inTop5: true,
      citationCorrect: false,
      answerScore: 1,
      errorReason: "引用未命中目标",
    }),
  ]);

  const byId = Object.fromEntries(summary.cards.map((card) => [card.id, card]));

  assert.equal(byId.retrieval_hit.value, "3/3");
  assert.equal(byId.retrieval_hit.rate, 1);
  assert.equal(byId.citation_accuracy.value, "2/3");
  assert.equal(byId.citation_accuracy.rate, 2 / 3);
  assert.equal(byId.refusal_accuracy.value, "1/1");
  assert.equal(byId.refusal_accuracy.rate, 1);
  assert.equal(byId.permission_isolation.value, "1/1");
  assert.equal(byId.permission_isolation.rate, 1);
  assert.equal(byId.table_numeric.value, "1/1");
  assert.equal(byId.table_numeric.rate, 1);
  assert.deepEqual(summary.topErrors, [{ reason: "引用未命中目标", count: 1 }]);
  assert.equal(summary.errorCount, 0);
});

test("系统异常题不进入质量分母，只单独计数", () => {
  const summary = computeQualityMetrics([
    item({
      id: "normal-pass",
      inTop5: true,
      citationCorrect: true,
      answerScore: 2,
      autoStatus: "PASS",
    }),
    item({
      id: "runtime-error",
      runErrored: true,
      autoStatus: "ERROR",
      errorReason: "运行异常：Request timeout",
      // 异常题可能残留上一次跑测的布尔字段，不得被算作失败
      inTop5: false,
      citationCorrect: false,
      answerScore: 0,
    }),
  ]);

  const byId = Object.fromEntries(summary.cards.map((card) => [card.id, card]));

  assert.equal(byId.retrieval_hit.value, "1/1");
  assert.equal(byId.retrieval_hit.rate, 1);
  assert.equal(byId.citation_accuracy.value, "1/1");
  assert.equal(byId.answer_quality.value, "1/1");
  assert.equal(byId.answer_quality.rate, 1);
  assert.equal(summary.errorCount, 1);
});

test("人工终判为 ERROR 的题目同样退出质量分母", () => {
  const summary = computeQualityMetrics([
    item({
      id: "human-marked-error",
      answerScore: 0,
      autoStatus: "FAIL",
      finalStatus: "ERROR",
      inTop5: false,
    }),
  ]);

  const byId = Object.fromEntries(summary.cards.map((card) => [card.id, card]));

  assert.equal(byId.retrieval_hit.value, "—");
  assert.equal(byId.retrieval_hit.rate, undefined);
  assert.equal(summary.errorCount, 1);
});
