import test from "node:test";
import assert from "node:assert/strict";
import { NUMERIC_GOLDEN_QUESTIONS } from "../lib/rag/eval/goldenQuestions.ts";
import {
  runNumericAnswerEval,
  runNumericObjectEval,
} from "../lib/rag/eval/runEval.ts";
import { MOCK_EVALUATION } from "../lib/db/mockEvaluation.ts";

test("numeric golden eval runs every numeric question through answer value assertions", async () => {
  const answers = new Map<string, string>(
    NUMERIC_GOLDEN_QUESTIONS.map((question) => [
      question.query,
      question.expectedAnswerValues.join("；"),
    ])
  );
  const seen: string[] = [];

  const results = await runNumericAnswerEval(async (question) => {
    seen.push(question);
    return answers.get(question) ?? "";
  });

  assert.equal(results.length, NUMERIC_GOLDEN_QUESTIONS.length);
  assert.deepEqual(seen, NUMERIC_GOLDEN_QUESTIONS.map((question) => question.query));
  assert.equal(results.every((result) => result.pass), true);
});

test("numeric golden eval reports missing and forbidden answer values", async () => {
  const [question] = NUMERIC_GOLDEN_QUESTIONS;
  const forbidden = question.forbiddenAnswerValues?.[0] ?? "forbidden-value";
  const [result] = await runNumericAnswerEval(async () => forbidden, [question]);

  assert.equal(result.pass, false);
  assert.deepEqual(result.missingValues, question.expectedAnswerValues);
  assert.deepEqual(
    result.forbiddenValuesFound,
    question.forbiddenAnswerValues?.includes(forbidden) ? [forbidden] : []
  );
  assert.equal(result.answer, forbidden);
  assert.equal(result.sourceHint, question.sourceHint);
});

test("numeric golden questions are included in the app evaluation set", () => {
  const byQuestion = new Map(MOCK_EVALUATION.map((item) => [item.question, item]));

  for (const question of NUMERIC_GOLDEN_QUESTIONS) {
    const item = byQuestion.get(question.query);
    assert.ok(item, `missing evaluation item for ${question.query}`);
    assert.deepEqual(item.expectedAnswerValues, question.expectedAnswerValues);
    assert.deepEqual(
      item.forbiddenAnswerValues ?? [],
      question.forbiddenAnswerValues ?? []
    );
  }
});

test("numeric object eval checks parsed knowledge objects before answering", () => {
  const question = {
    ...NUMERIC_GOLDEN_QUESTIONS[2],
    expectedKeywords: ["社区卫生服务站", "一般规模"],
    expectedAnswerValues: ["规模性指标.一般规模：350"],
  };

  const results = runNumericObjectEval(
    [
      {
        id: "obj-1",
        docId: "doc-1",
        objectType: "indicator_item",
        content:
          "指标对象：社区卫生服务站。规模性指标.一般规模：350。千人指标：25。",
        sectionPath: [],
        sectionPathText: "",
        sourcePageStart: 16,
        confidence: 1,
        fields: {
          设施名称: "社区卫生服务站",
          "规模性指标.一般规模": "350",
        },
        itemName: "社区卫生服务站",
        indicatorValues: [],
      },
    ],
    [question]
  );

  assert.equal(results[0].pass, true);
  assert.equal(results[0].matchedObjectIds[0], "obj-1");
});
