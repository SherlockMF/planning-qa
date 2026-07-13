import test from "node:test";
import assert from "node:assert/strict";

import {
  canUseDeveloperTools,
  visibleNavItemsForUser,
} from "../lib/knowledge/navigation.ts";
import {
  canAccessDocument,
  getSelectableKnowledgeUsers,
  getKnowledgeUser,
} from "../lib/knowledge/permissions.ts";
import type { Document } from "../lib/types.ts";

const restrictedProjectDoc: Document = {
  id: "doc-project-tod",
  fileName: "轨道站点 TOD 综合开发项目资料.txt",
  city: "北京",
  fileType: "控规导则",
  enabled: true,
  status: "indexed",
  createdAt: "2026-06-13T00:00:00.000Z",
  permissionLevel: 2,
  projectId: "project-tod",
  projectName: "轨道站点 TOD 综合开发",
};

test("开发人员可访问全部项目资料", () => {
  const developer = getKnowledgeUser("user-developer");
  assert.ok(developer);

  assert.equal(canAccessDocument(developer!, restrictedProjectDoc), true);
});

test("默认用户是管理员", () => {
  const defaultUser = getKnowledgeUser();

  assert.equal(defaultUser?.id, "user-admin");
  assert.equal(defaultUser?.role, "admin");
});

test("管理员可打开面试展示页，普通员工仍不显示内部工具", () => {
  const employee = getKnowledgeUser("user-employee-riverfront");
  const admin = getKnowledgeUser("user-admin");
  const developer = getKnowledgeUser("user-developer");
  assert.ok(employee);
  assert.ok(admin);
  assert.ok(developer);

  assert.equal(canUseDeveloperTools(employee!), false);
  assert.equal(canUseDeveloperTools(admin!), true);
  assert.equal(canUseDeveloperTools(developer!), true);
  assert.deepEqual(
    visibleNavItemsForUser(employee!).map((item) => item.href),
    ["/", "/documents"]
  );
  assert.deepEqual(
    visibleNavItemsForUser(admin!).map((item) => item.href),
    ["/", "/documents", "/chunks", "/debug", "/evaluation"]
  );
  assert.deepEqual(
    visibleNavItemsForUser(developer!).map((item) => item.href),
    ["/", "/documents", "/chunks", "/debug", "/evaluation"]
  );
});

test("人员切换列表暂时隐藏开发人员账号", () => {
  assert.deepEqual(
    getSelectableKnowledgeUsers().map((user) => user.id),
    [
      "user-employee-riverfront",
      "user-employee-industrial",
      "user-manager-riverfront",
      "user-manager-tod",
      "user-admin",
    ]
  );
});
