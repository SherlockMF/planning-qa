import test from "node:test";
import assert from "node:assert/strict";
import { checkAnswerValueAssertions } from "../lib/rag/eval/answerValueAssertions.ts";

test("passes when answer contains every expected value and no forbidden value", () => {
  const result = checkAnswerValueAssertions("托幼服务规模为0.96万人，服务范围为6岁以下。", {
    expectedAnswerValues: ["0.96万人", "6岁以下"],
    forbiddenAnswerValues: ["0万.9人6", "岁6以下"],
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.missingValues, []);
  assert.deepEqual(result.forbiddenValuesFound, []);
});

test("fails when answer misses expected values or contains scrambled values", () => {
  const result = checkAnswerValueAssertions("托幼服务规模为0万.9人6，服务范围为岁6以下。", {
    expectedAnswerValues: ["0.96万人", "6岁以下"],
    forbiddenAnswerValues: ["0万.9人6", "岁6以下"],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.missingValues, ["0.96万人", "6岁以下"]);
  assert.deepEqual(result.forbiddenValuesFound, ["0万.9人6", "岁6以下"]);
});
