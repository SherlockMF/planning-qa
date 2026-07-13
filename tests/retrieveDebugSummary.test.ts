import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, Document, RetrievedChunk } from "../lib/types.ts";
import { buildRetrieveDebugSummary } from "../lib/debug/retrieveDebugSummary.ts";
import { getKnowledgeUser } from "../lib/knowledge/permissions.ts";

function doc(id: string, fileName: string, patch: Partial<Document> = {}): Document {
  return {
    id,
    fileName,
    city: "北京",
    fileType: "项目资料",
    enabled: true,
    status: "indexed",
    createdAt: "2026-07-08T00:00:00.000Z",
    permissionLevel: 2,
    ...patch,
  };
}

function hit(document: Document): RetrievedChunk {
  const chunk: Chunk = {
    id: `chunk-${document.id}`,
    documentId: document.id,
    fileName: document.fileName,
    city: document.city,
    chunkType: "clause",
    content: `${document.fileName} 的项目资料内容`,
    keywords: ["项目资料"],
    createdAt: document.createdAt,
  };
  return {
    chunk,
    keywordScore: 0.8,
    vectorScore: 0.6,
    rerankScore: 0.9,
    source: "hybrid",
    matchedKeywords: ["项目资料"],
  };
}

test("buildRetrieveDebugSummary explains accessible and denied evidence for a mock user", () => {
  const accessible = doc("doc-public", "公开技术标准.pdf", {
    permissionLevel: 1,
    category: "技术标准",
  });
  const denied = doc("doc-tod", "TOD 综合开发项目资料.md", {
    projectId: "project-tod",
    projectName: "TOD 综合开发",
    projectOwnerId: "user-manager-tod",
  });
  const user = getKnowledgeUser("user-employee-riverfront");
  assert.ok(user);

  const summary = buildRetrieveDebugSummary({
    user,
    documents: [accessible, denied],
    mergedTop: [hit(accessible)],
    deniedTop: [hit(denied)],
  });

  assert.equal(summary.userLabel, "张明 · 普通员工");
  assert.equal(summary.accessibleHitCount, 1);
  assert.equal(summary.deniedHitCount, 1);
  assert.equal(summary.riskLabel, "命中无权资料，已在检索前隔离");
  assert.deepEqual(summary.accessibleDocuments, ["公开技术标准.pdf"]);
  assert.deepEqual(summary.deniedDocuments, ["TOD 综合开发项目资料.md"]);
  assert.match(summary.explanation, /不会进入 LLM 上下文/);
});
