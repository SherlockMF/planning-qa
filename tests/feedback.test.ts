import test from "node:test";
import assert from "node:assert/strict";

import {
  getFeedbackRecord,
  saveFeedbackRecord,
} from "../lib/db/feedback.ts";

test("saveFeedbackRecord stores answer feedback by target id", () => {
  const record = saveFeedbackRecord({
    targetId: "answer-test",
    type: "helpful",
    userId: "user-employee-riverfront",
  });

  assert.equal(record.targetId, "answer-test");
  assert.equal(record.type, "helpful");
  assert.equal(getFeedbackRecord("answer-test")?.userId, "user-employee-riverfront");
});
