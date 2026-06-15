import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, Document } from "../lib/types.ts";
import {
  canAccessDocument,
  canManageDocumentInManagement,
  canViewDocumentInManagement,
  getKnowledgeUser,
  splitChunksByUserAccess,
} from "../lib/knowledge/permissions.ts";
import {
  buildNoAccessChatResponse,
  shouldReturnNoAccess,
} from "../lib/knowledge/noAccess.ts";
import type { RetrievedChunk } from "../lib/types.ts";

const baseDoc: Document = {
  id: "doc-public",
  fileName: "院内通用制度.txt",
  city: "北京",
  fileType: "其他",
  enabled: true,
  status: "indexed",
  createdAt: "2026-06-13T00:00:00.000Z",
  permissionLevel: 1,
};

function projectDoc(patch: Partial<Document>): Document {
  return {
    ...baseDoc,
    id: "doc-project",
    fileName: "滨江片区控规优化项目资料.txt",
    category: "项目资料",
    permissionLevel: 2,
    projectId: "project-riverfront",
    projectName: "滨江片区控规优化",
    projectOwnerId: "user-manager-riverfront",
    ...patch,
  };
}

function chunkFor(doc: Document): Chunk {
  return {
    id: `chunk-${doc.id}`,
    documentId: doc.id,
    fileName: doc.fileName,
    city: doc.city,
    chunkType: "clause",
    content: `${doc.projectName ?? doc.fileName} 的控规优化资料包含滨江慢行系统和公共服务设施优化策略。`,
    keywords: ["滨江", "控规优化", "慢行系统", "公共服务设施"],
    createdAt: doc.createdAt,
  };
}

function hit(
  chunk: Chunk,
  patch: Partial<RetrievedChunk> = {}
): RetrievedChunk {
  return {
    chunk,
    keywordScore: 0,
    vectorScore: 0,
    rerankScore: 0,
    source: "vector",
    matchedKeywords: [],
    ...patch,
  };
}

test("普通员工可访问公开资料和被授权项目资料", () => {
  const employee = getKnowledgeUser("user-employee-riverfront");
  assert.ok(employee);

  assert.equal(canAccessDocument(employee!, baseDoc), true);
  assert.equal(canAccessDocument(employee!, projectDoc({})), true);
  assert.equal(
    canAccessDocument(employee!, projectDoc({ projectId: "project-tod" })),
    false
  );
});

test("项目负责人可访问自己负责的项目资料，管理员可访问全部", () => {
  const manager = getKnowledgeUser("user-manager-riverfront");
  const admin = getKnowledgeUser("user-admin");
  assert.ok(manager);
  assert.ok(admin);

  assert.equal(canAccessDocument(manager!, projectDoc({})), true);
  assert.equal(
    canAccessDocument(
      manager!,
      projectDoc({
        projectId: "project-tod",
        projectOwnerId: "user-manager-tod",
      })
    ),
    false
  );
  assert.equal(
    canAccessDocument(
      admin!,
      projectDoc({
        projectId: "project-tod",
        projectOwnerId: "user-manager-tod",
      })
    ),
    true
  );
});

test("splitChunksByUserAccess separates denied project chunks before retrieval", () => {
  const docs = [
    baseDoc,
    projectDoc({}),
    projectDoc({
      id: "doc-project-tod",
      projectId: "project-tod",
      projectName: "轨道站点 TOD 综合开发",
      projectOwnerId: "user-manager-tod",
    }),
  ];
  const chunks = docs.map(chunkFor);
  const result = splitChunksByUserAccess(chunks, docs, "user-employee-riverfront");

  assert.deepEqual(
    result.accessible.map((c) => c.documentId).sort(),
    ["doc-project", "doc-public"]
  );
  assert.deepEqual(result.denied.map((c) => c.documentId), ["doc-project-tod"]);
});

test("document management list is filtered by current user project ACL", () => {
  const managerTod = getKnowledgeUser("user-manager-tod");
  const admin = getKnowledgeUser("user-admin");
  const developer = getKnowledgeUser("user-developer");
  assert.ok(managerTod);
  assert.ok(admin);
  assert.ok(developer);

  const docs = [
    { ...baseDoc, status: "pending" as const },
    projectDoc({
      id: "doc-project-tod",
      projectId: "project-tod",
      projectName: "轨道站点 TOD 综合开发",
      projectOwnerId: "user-manager-tod",
      status: "failed",
    }),
    projectDoc({
      id: "doc-project-industrial",
      projectId: "project-industrial",
      projectName: "产业园城市设计",
      projectOwnerId: "user-manager-riverfront",
    }),
  ];

  assert.deepEqual(
    docs
      .filter((doc) => canViewDocumentInManagement(managerTod!, doc))
      .map((doc) => doc.id),
    ["doc-public", "doc-project-tod"]
  );
  assert.deepEqual(
    docs
      .filter((doc) => canViewDocumentInManagement(admin!, doc))
      .map((doc) => doc.id),
    ["doc-public", "doc-project-tod", "doc-project-industrial"]
  );
  assert.deepEqual(
    docs
      .filter((doc) => canViewDocumentInManagement(developer!, doc))
      .map((doc) => doc.id),
    ["doc-public", "doc-project-tod", "doc-project-industrial"]
  );
});

test("document management mutations are limited to managers of the document", () => {
  const employee = getKnowledgeUser("user-employee-riverfront");
  const managerTod = getKnowledgeUser("user-manager-tod");
  const managerRiverfront = getKnowledgeUser("user-manager-riverfront");
  const admin = getKnowledgeUser("user-admin");
  const developer = getKnowledgeUser("user-developer");
  assert.ok(employee);
  assert.ok(managerTod);
  assert.ok(managerRiverfront);
  assert.ok(admin);
  assert.ok(developer);

  const todDoc = projectDoc({
    id: "doc-project-tod",
    projectId: "project-tod",
    projectName: "轨道站点 TOD 综合开发",
    projectOwnerId: "user-manager-tod",
  });

  assert.equal(canViewDocumentInManagement(employee!, projectDoc({})), true);
  assert.equal(canManageDocumentInManagement(employee!, projectDoc({})), false);
  assert.equal(canManageDocumentInManagement(managerTod!, todDoc), true);
  assert.equal(canManageDocumentInManagement(managerRiverfront!, todDoc), false);
  assert.equal(canManageDocumentInManagement(admin!, todDoc), true);
  assert.equal(canManageDocumentInManagement(developer!, todDoc), true);
  assert.equal(canManageDocumentInManagement(admin!, baseDoc), true);
});

test("document accessibleUserIds grants explicit project document access", () => {
  const employee = getKnowledgeUser("user-employee-riverfront");
  const otherEmployee = getKnowledgeUser("user-employee-industrial");
  assert.ok(employee);
  assert.ok(otherEmployee);

  const todDoc = projectDoc({
    id: "doc-project-tod",
    projectId: "project-tod",
    projectName: "轨道站点 TOD 综合开发",
    projectOwnerId: "user-manager-tod",
    accessibleUserIds: ["user-employee-riverfront"],
  });

  assert.equal(canViewDocumentInManagement(employee!, todDoc), true);
  assert.equal(canAccessDocument(employee!, todDoc), true);
  assert.equal(canViewDocumentInManagement(otherEmployee!, todDoc), false);
  assert.equal(canAccessDocument(otherEmployee!, todDoc), false);
});

test("document projectOwnerId grants the assigned manager project document access", () => {
  const manager = getKnowledgeUser("user-manager-riverfront");
  assert.ok(manager);

  const assignedDoc = projectDoc({
    projectId: "project-new-district",
    projectName: "新片区城市设计",
    projectOwnerId: "user-manager-riverfront",
  });

  assert.equal(canViewDocumentInManagement(manager!, assignedDoc), true);
  assert.equal(canAccessDocument(manager!, assignedDoc), true);
  assert.equal(canManageDocumentInManagement(manager!, assignedDoc), true);
});

test("document projectOwnerId overrides legacy ownedProjectIds for managers", () => {
  const legacyProjectManager = getKnowledgeUser("user-manager-riverfront");
  const assignedManager = getKnowledgeUser("user-manager-tod");
  assert.ok(legacyProjectManager);
  assert.ok(assignedManager);

  const reassignedDoc = projectDoc({
    projectId: "project-riverfront",
    projectName: "滨江片区控规优化",
    projectOwnerId: "user-manager-tod",
    accessibleUserIds: [],
  });

  assert.equal(canViewDocumentInManagement(legacyProjectManager!, reassignedDoc), false);
  assert.equal(canAccessDocument(legacyProjectManager!, reassignedDoc), false);
  assert.equal(canManageDocumentInManagement(legacyProjectManager!, reassignedDoc), false);
  assert.equal(canViewDocumentInManagement(assignedManager!, reassignedDoc), true);
  assert.equal(canAccessDocument(assignedManager!, reassignedDoc), true);
  assert.equal(canManageDocumentInManagement(assignedManager!, reassignedDoc), true);
});

test("document projectOwnerId scopes access even without projectId", () => {
  const assignedManager = getKnowledgeUser("user-manager-riverfront");
  const otherManager = getKnowledgeUser("user-manager-tod");
  const employee = getKnowledgeUser("user-employee-riverfront");
  assert.ok(assignedManager);
  assert.ok(otherManager);
  assert.ok(employee);

  const ownerOnlyDoc = projectDoc({
    projectId: undefined,
    projectName: "朝阳园北区市政交通方案",
    projectOwnerId: "user-manager-riverfront",
    accessibleUserIds: [],
    permissionLevel: 1,
  });

  assert.equal(canAccessDocument(assignedManager!, ownerOnlyDoc), true);
  assert.equal(canAccessDocument(otherManager!, ownerOnlyDoc), false);
  assert.equal(canAccessDocument(employee!, ownerOnlyDoc), false);
  assert.equal(canViewDocumentInManagement(otherManager!, ownerOnlyDoc), false);
});

test("无权项目资料命中时返回权限提示且不泄露引用", () => {
  const response = buildNoAccessChatResponse("TOD 综合开发");

  assert.equal(response.foundEvidence, false);
  assert.equal(response.noAccess, true);
  assert.equal(response.citations.length, 0);
  assert.match(response.answer, /无权访问|权限/);
});

test("无权资料强词面命中优先于可访问弱向量命中", () => {
  const publicChunk = chunkFor(baseDoc);
  const deniedChunk = chunkFor(
    projectDoc({ projectId: "project-tod", projectName: "轨道站点 TOD 综合开发" })
  );

  assert.equal(
    shouldReturnNoAccess(
      [hit(publicChunk, { source: "vector", vectorScore: 0.72, rerankScore: 0.42 })],
      [
        hit(deniedChunk, {
          source: "hybrid",
          keywordScore: 1,
          vectorScore: 0.8,
          rerankScore: 1.4,
          matchedKeywords: ["TOD", "地下空间"],
        }),
      ]
    ),
    true
  );
});
