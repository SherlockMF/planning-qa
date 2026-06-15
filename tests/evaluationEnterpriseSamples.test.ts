import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTERPRISE_EVALUATION,
  resolveEvaluationUserId,
} from "../lib/db/mockEvaluation.ts";

test("enterprise evaluation samples cover roles and project ACL scenarios", () => {
  assert.equal(ENTERPRISE_EVALUATION.length, 18);

  const userIds = new Set(ENTERPRISE_EVALUATION.map((item) => item.userId));
  assert.ok(userIds.has("user-employee-riverfront"));
  assert.ok(userIds.has("user-employee-industrial"));
  assert.ok(userIds.has("user-manager-riverfront"));
  assert.ok(userIds.has("user-manager-tod"));
  assert.ok(userIds.has("user-admin"));
  assert.ok(userIds.has("user-developer"));

  assert.ok(
    ENTERPRISE_EVALUATION.some(
      (item) => item.shouldRefuse && item.expectedBehavior?.includes("无权")
    )
  );
  assert.ok(
    ENTERPRISE_EVALUATION.some((item) =>
      item.expectedBehavior?.includes("开发人员")
    )
  );
});

test("resolveEvaluationUserId keeps per-question mock account for evaluation runs", () => {
  assert.equal(
    resolveEvaluationUserId({ userId: "user-developer" }),
    "user-developer"
  );
  assert.equal(resolveEvaluationUserId({}), undefined);
});
