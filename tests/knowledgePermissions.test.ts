import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, Document } from "../lib/types.ts";
import {
  canAccessDocument,
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
    canAccessDocument(manager!, projectDoc({ projectId: "project-tod" })),
    false
  );
  assert.equal(
    canAccessDocument(admin!, projectDoc({ projectId: "project-tod" })),
    true
  );
});

test("splitChunksByUserAccess separates denied project chunks before retrieval", () => {
  const docs = [
    baseDoc,
    projectDoc({}),
    projectDoc({ id: "doc-project-tod", projectId: "project-tod", projectName: "轨道站点 TOD 综合开发" }),
  ];
  const chunks = docs.map(chunkFor);
  const result = splitChunksByUserAccess(chunks, docs, "user-employee-riverfront");

  assert.deepEqual(
    result.accessible.map((c) => c.documentId).sort(),
    ["doc-project", "doc-public"]
  );
  assert.deepEqual(result.denied.map((c) => c.documentId), ["doc-project-tod"]);
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
