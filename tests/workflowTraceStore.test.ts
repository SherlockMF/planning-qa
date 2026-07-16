import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Chunk, Document, RagTable } from "../lib/types.ts";
import { createWorkflowTrace } from "../lib/workflow/trace.ts";
import {
  FileWorkflowTraceStore,
  buildReconstructedIngestionTrace,
  findLatestIngestionTrace,
  persistWorkflowTraceSafely,
} from "../lib/db/workflowTraces.ts";

test("file trace store saves, replaces, reads, and filters traces", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-traces-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileWorkflowTraceStore(path.join(dir, "workflow-traces.json"));
  const first = createWorkflowTrace({
    id: "query-1",
    kind: "query",
    actorUserId: "user-admin",
    question: "first",
    now: "2026-07-14T10:00:00.000Z",
  });
  const second = createWorkflowTrace({
    id: "ingestion-1",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
    now: "2026-07-14T11:00:00.000Z",
  });

  store.save(first);
  store.save(second);
  first.warnings.push("updated");
  store.save(first);

  assert.equal(store.get("query-1")?.warnings[0], "updated");
  assert.deepEqual(store.list({ kind: "query" }).map((trace) => trace.id), [
    "query-1",
  ]);
  assert.deepEqual(store.list().map((trace) => trace.id), [
    "ingestion-1",
    "query-1",
  ]);
});

test("latest ingestion trace is selected per document", () => {
  const older = createWorkflowTrace({
    id: "ingestion-old",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
    now: "2026-07-14T09:00:00.000Z",
  });
  const newer = createWorkflowTrace({
    id: "ingestion-new",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
    now: "2026-07-14T12:00:00.000Z",
  });
  const other = createWorkflowTrace({
    id: "ingestion-other",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-2",
    now: "2026-07-14T13:00:00.000Z",
  });

  assert.equal(findLatestIngestionTrace([older, other, newer], "doc-1")?.id, "ingestion-new");
});

test("reconstructed ingestion trace exposes only verifiable current facts", () => {
  const document: Document = {
    id: "doc-1",
    fileName: "城市公共服务设施标准.pdf",
    city: "北京",
    fileType: "技术标准",
    enabled: true,
    status: "indexed",
    createdAt: "2026-07-01T09:00:00.000Z",
    permissionLevel: 1,
  };
  const chunks = [
    makeChunk("chunk-1", "clause", [0.1, 0.2]),
    makeChunk("chunk-2", "table_row", [0.2, 0.3]),
    makeChunk("chunk-3", "table_row"),
  ];
  const ragTables = [{ tableId: "table-1", docId: "doc-1" }] as unknown as RagTable[];

  const trace = buildReconstructedIngestionTrace({
    document,
    chunks,
    ragTables,
    actorUserId: "user-admin",
    now: "2026-07-14T14:00:00.000Z",
  });

  assert.equal(trace.status, "completed");
  assert.ok(trace.steps.every((step) => step.source === "reconstructed"));
  assert.ok(trace.steps.every((step) => step.durationMs == null));
  assert.ok(trace.steps.every((step) => step.startedAt == null));
  assert.equal(trace.steps.find((step) => step.key === "chunking")?.metrics?.chunkCount, 3);
  assert.equal(trace.steps.find((step) => step.key === "embedding")?.metrics?.embeddedCount, 2);
  assert.equal(trace.steps.find((step) => step.key === "persistence")?.metrics?.ragTableCount, 1);
  assert.match(trace.warnings[0], /历史回溯/);
});

test("audit persistence failure is isolated from the business workflow", () => {
  const trace = createWorkflowTrace({
    id: "trace-safe-persist",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
  });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const saved = persistWorkflowTraceSafely(trace, () => {
      throw new Error("disk unavailable");
    });
    assert.equal(saved, false);
    assert.deepEqual(trace.warnings, ["审计记录持久化失败"]);
  } finally {
    console.error = originalError;
  }
});

function makeChunk(id: string, chunkType: Chunk["chunkType"], embedding?: number[]): Chunk {
  return {
    id,
    documentId: "doc-1",
    fileName: "城市公共服务设施标准.pdf",
    city: "北京",
    chunkType,
    content: `content-${id}`,
    keywords: [],
    embedding,
    createdAt: "2026-07-01T09:00:00.000Z",
  };
}
