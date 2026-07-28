import test from "node:test";
import assert from "node:assert/strict";

import type { EvaluationItem } from "../lib/types.ts";
import { mergeEvaluationSave } from "../lib/evaluation/humanReview.ts";

function item(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "eval-1",
    question: patch.question ?? "测试问题",
    standardAnswer: patch.standardAnswer ?? "标准答案",
    correctFile: patch.correctFile ?? "测试文件.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

const ranItem = () =>
  item({
    id: "eval-1",
    systemAnswer: "系统回答",
    answerScore: 1,
    autoAnswerScore: 1,
    autoStatus: "REVIEW",
    status: "REVIEW",
    autoJudgeUncertain: false,
    workflowTraceId: "eval-1-trace",
    runStartedAt: "2026-07-28T01:00:00.000Z",
    runFinishedAt: "2026-07-28T01:00:09.000Z",
    errorReason: "引用未命中标准条文",
  });

test("客户端只回传题面时，自动分与审计链接不被抹掉", () => {
  const merged = mergeEvaluationSave(
    [ranItem()],
    [item({ id: "eval-1", question: "改过的题面" })]
  );

  const saved = merged[0];
  assert.equal(saved.question, "改过的题面");
  assert.equal(saved.autoAnswerScore, 1);
  assert.equal(saved.autoStatus, "REVIEW");
  assert.equal(saved.workflowTraceId, "eval-1-trace");
  assert.equal(saved.runStartedAt, "2026-07-28T01:00:00.000Z");
  assert.equal(saved.status, "REVIEW");
});

test("人工改分写入终判并记录复核信息，自动分保留", () => {
  const merged = mergeEvaluationSave(
    [ranItem()],
    [
      {
        ...ranItem(),
        answerScore: 2,
        finalAnswerScore: 2,
        finalStatus: "PASS",
        reviewedBy: "user-admin",
        reviewReason: "页码偏移但内容正确",
      },
    ],
    { now: () => "2026-07-28T02:00:00.000Z" }
  );

  const saved = merged[0];
  assert.equal(saved.autoAnswerScore, 1, "自动分必须原样保留");
  assert.equal(saved.autoStatus, "REVIEW");
  assert.equal(saved.finalAnswerScore, 2);
  assert.equal(saved.finalStatus, "PASS");
  assert.equal(saved.status, "PASS", "展示状态跟随人工终判");
  assert.equal(saved.answerScore, 2, "展示分跟随人工终判");
  assert.equal(saved.reviewedBy, "user-admin");
  assert.equal(saved.reviewedAt, "2026-07-28T02:00:00.000Z");
  assert.equal(saved.reviewReason, "页码偏移但内容正确");
});

test("撤销人工终判时清空复核元数据并回落自动结果", () => {
  const reviewed = {
    ...ranItem(),
    finalAnswerScore: 2 as const,
    finalStatus: "PASS" as const,
    status: "PASS" as const,
    answerScore: 2 as const,
    reviewedBy: "user-admin",
    reviewedAt: "2026-07-28T02:00:00.000Z",
    reviewReason: "页码偏移但内容正确",
  };

  const merged = mergeEvaluationSave(
    [reviewed],
    [{ ...reviewed, finalAnswerScore: undefined, finalStatus: undefined }]
  );

  const saved = merged[0];
  assert.equal(saved.finalAnswerScore, undefined);
  assert.equal(saved.finalStatus, undefined);
  assert.equal(saved.status, "REVIEW");
  assert.equal(saved.answerScore, 1, "回落到自动分");
  assert.equal(saved.reviewedBy, undefined);
  assert.equal(saved.reviewedAt, undefined);
  assert.equal(saved.reviewReason, undefined);
});

test("已有复核时间不会被后续保存刷新", () => {
  const reviewed = {
    ...ranItem(),
    finalAnswerScore: 2 as const,
    finalStatus: "PASS" as const,
    reviewedBy: "user-admin",
    reviewedAt: "2026-07-28T02:00:00.000Z",
    reviewReason: "页码偏移但内容正确",
  };

  const merged = mergeEvaluationSave([reviewed], [reviewed], {
    now: () => "2026-07-28T09:00:00.000Z",
  });

  assert.equal(merged[0].reviewedAt, "2026-07-28T02:00:00.000Z");
});

test("新增与删除题目照常生效", () => {
  const merged = mergeEvaluationSave(
    [ranItem(), item({ id: "eval-2" })],
    [item({ id: "eval-3", question: "新题" })]
  );

  assert.deepEqual(
    merged.map((entry) => entry.id),
    ["eval-3"]
  );
  assert.equal(merged[0].autoStatus, undefined);
});
