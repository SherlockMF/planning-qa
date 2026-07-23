import test from "node:test";
import assert from "node:assert/strict";

import type { Document, KnowledgeUser } from "../lib/types.ts";
import {
  getTableReprocessRequest,
  prepareTableReprocessRequest,
  publishTableReprocessRequest,
  type TableReprocessApiDependencies,
} from "../lib/reprocess/tableReprocessApi.ts";
import type { ReprocessPreparation } from "../lib/reprocess/tableReprocess.ts";

test("reprocess APIs enforce document management permission", async () => {
  const dependencies = fakeDependencies();
  const response = await prepareTableReprocessRequest(
    { docId: "doc-1", userId: "employee" },
    dependencies
  );
  assert.equal(response.status, 403);
});

test("reprocess APIs return 404 for missing document and staging", async () => {
  const dependencies = fakeDependencies();
  assert.equal(
    (
      await prepareTableReprocessRequest(
        { docId: "missing", userId: "manager" },
        dependencies
      )
    ).status,
    404
  );
  dependencies.get = () => {
    throw new Error("reprocess_staging_not_found");
  };
  assert.equal(
    (
      await getTableReprocessRequest(
        { docId: "doc-1", stagingId: "missing", userId: "manager" },
        dependencies
      )
    ).status,
    404
  );
});

test("reprocess APIs expose ready/published and map publish conflict to 409", async () => {
  const dependencies = fakeDependencies();
  const prepared = await prepareTableReprocessRequest(
    { docId: "doc-1", stagingId: "stage-1", userId: "manager" },
    dependencies
  );
  assert.equal(prepared.status, 200);
  assert.equal(
    (prepared.body as { reprocess: ReprocessPreparation }).reprocess.status,
    "ready"
  );

  dependencies.publish = async () => ({
    status: "conflict",
    reason: "baseline_drift",
  });
  assert.equal(
    (
      await publishTableReprocessRequest(
        { docId: "doc-1", stagingId: "stage-1", userId: "manager" },
        dependencies
      )
    ).status,
    409
  );

  dependencies.publish = async () => preparation("published");
  const published = await publishTableReprocessRequest(
    { docId: "doc-1", stagingId: "stage-1", userId: "manager" },
    dependencies
  );
  assert.equal(published.status, 200);
  assert.equal(
    (published.body as { reprocess: ReprocessPreparation }).reprocess.status,
    "published"
  );
});

function fakeDependencies(): TableReprocessApiDependencies {
  const document: Document = {
    id: "doc-1",
    fileName: "table.pdf",
    city: "北京",
    fileType: "技术标准",
    enabled: true,
    status: "indexed",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  return {
    getDocument: async (id) => (id === document.id ? document : undefined),
    getSourceBuffer: (id) => (id === document.id ? Buffer.from("pdf") : undefined),
    resolveUser: (userId) => user(userId ?? "employee"),
    canManage: (actor) => actor.id === "manager",
    prepare: async (_document, _source, stagingId) => ({
      ...preparation("ready"),
      stagingId: stagingId ?? "generated",
    }),
    get: () => preparation("ready"),
    publish: async () => preparation("published"),
  };
}

function user(id: string): KnowledgeUser {
  return {
    id,
    name: id,
    role: id === "manager" ? "admin" : "employee",
    department: "测试",
    projectIds: [],
    ownedProjectIds: [],
  };
}

function preparation(
  status: ReprocessPreparation["status"]
): ReprocessPreparation {
  return {
    docId: "doc-1",
    stagingId: "stage-1",
    status,
    createdAt: "2026-07-23T00:00:00.000Z",
    manifest: {
      sourceHash: "a",
      baseChunksHash: "b",
      baseRagTablesHash: "c",
      targetChunksHash: "d",
      targetRagTablesHash: "e",
    },
    diff: {
      chunkCount: { before: 1, after: 1 },
      tableCount: { before: 1, after: 1 },
      tables: [],
    },
    blockedReasons: [],
  };
}
