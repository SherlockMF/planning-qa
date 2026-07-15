import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWorkflowAuditActor,
  resolveWorkflowSimulatedUser,
} from "../lib/workflow/access.ts";

test("workflow audit access allows admins and developers", () => {
  assert.equal(resolveWorkflowAuditActor("user-admin").role, "admin");
  assert.equal(resolveWorkflowAuditActor("user-developer").role, "developer");
});

test("workflow audit access rejects non-privileged and unknown users", () => {
  assert.throws(
    () => resolveWorkflowAuditActor("user-employee-riverfront"),
    /无权访问工作流审计/
  );
  assert.throws(() => resolveWorkflowAuditActor("missing-user"), /无权访问工作流审计/);
});

test("workflow simulation rejects unknown users instead of falling back to admin", () => {
  const actor = resolveWorkflowAuditActor("user-admin");
  assert.throws(
    () => resolveWorkflowSimulatedUser(actor, "missing-user"),
    /模拟用户不存在/
  );
  assert.equal(resolveWorkflowSimulatedUser(actor).id, "user-admin");
});
