import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Chunk, RagTable } from "../lib/types.ts";
import {
  getTableReprocess,
  prepareTableReprocess,
  publishTableReprocess,
  recoverIncompleteTableReprocessTransactions,
  type ReprocessRepository,
} from "../lib/reprocess/tableReprocess.ts";

test("prepare stages hashes and diff without mutating active slices", async (t) => {
  const dataRoot = temporaryRoot(t);
  const activeChunks = [chunk("old")];
  const activeTables = [table("same", [["旧值"]])];
  const beforeChunks = JSON.stringify(activeChunks);
  const beforeTables = JSON.stringify(activeTables);

  const prepared = await prepareTableReprocess({
    docId: "doc-1",
    stagingId: "stage-1",
    dataRoot,
    sourceBuffer: Buffer.from("source-v1"),
    activeChunks,
    activeRagTables: activeTables,
    build: async () => ({
      chunks: [chunk("new")],
      ragTables: [table("same", [["新值"]])],
    }),
  });

  assert.equal(prepared.status, "ready");
  assert.equal(prepared.diff.chunkCount.before, 1);
  assert.equal(prepared.diff.chunkCount.after, 1);
  assert.equal(prepared.diff.tables[0]?.change, "modified");
  assert.equal(JSON.stringify(activeChunks), beforeChunks);
  assert.equal(JSON.stringify(activeTables), beforeTables);
  assert.ok(prepared.manifest.sourceHash);
  assert.ok(prepared.manifest.baseChunksHash);
  assert.ok(prepared.manifest.targetRagTablesHash);
  assert.equal(
    getTableReprocess("doc-1", "stage-1", { dataRoot }).status,
    "ready"
  );
});

test("prepare blocks structurally empty tables and rejects traversal ids", async (t) => {
  const dataRoot = temporaryRoot(t);
  await assert.rejects(
    prepareTableReprocess({
      docId: "../doc",
      stagingId: "stage",
      dataRoot,
      sourceBuffer: Buffer.from("x"),
      activeChunks: [],
      activeRagTables: [],
      build: async () => ({ chunks: [], ragTables: [] }),
    }),
    /invalid_reprocess_identifier/
  );
  const blocked = await prepareTableReprocess({
    docId: "doc-1",
    stagingId: "blocked",
    dataRoot,
    sourceBuffer: Buffer.from("x"),
    activeChunks: [],
    activeRagTables: [],
    build: async () => ({
      chunks: [chunk("new")],
      ragTables: [table("empty", [])],
    }),
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.blockedReasons[0] ?? "", /empty_rows/);
});

test("publish is recoverable, idempotent, and detects stale baselines", async (t) => {
  const dataRoot = temporaryRoot(t);
  const repository = memoryRepository([chunk("old")], [table("old", [["旧值"]])]);
  await prepareTableReprocess({
    docId: "doc-1",
    stagingId: "ready",
    dataRoot,
    sourceBuffer: Buffer.from("source-v1"),
    activeChunks: repository.read().chunks,
    activeRagTables: repository.read().ragTables,
    build: async () => ({
      chunks: [chunk("new")],
      ragTables: [table("new", [["新值"]])],
    }),
  });

  const published = await publishTableReprocess({
    docId: "doc-1",
    stagingId: "ready",
    dataRoot,
    repository,
    sourceBuffer: Buffer.from("source-v1"),
  });
  assert.equal(published.status, "published");
  assert.equal(repository.read().chunks[0]?.id, "new");
  assert.equal(
    (
      await publishTableReprocess({
        docId: "doc-1",
        stagingId: "ready",
        dataRoot,
        repository,
        sourceBuffer: Buffer.from("source-v1"),
      })
    ).status,
    "published"
  );

  await prepareTableReprocess({
    docId: "doc-1",
    stagingId: "stale",
    dataRoot,
    sourceBuffer: Buffer.from("source-v1"),
    activeChunks: repository.read().chunks,
    activeRagTables: repository.read().ragTables,
    build: async () => ({
      chunks: [chunk("future")],
      ragTables: [table("future", [["未来"]])],
    }),
  });
  repository.writeChunks([chunk("drift")]);
  const conflict = await publishTableReprocess({
    docId: "doc-1",
    stagingId: "stale",
    dataRoot,
    repository,
    sourceBuffer: Buffer.from("source-v1"),
  });
  assert.equal(conflict.status, "conflict");
});

test("publish rolls back a partial write and recovery resolves applying journals", async (t) => {
  const dataRoot = temporaryRoot(t);
  const repository = memoryRepository([chunk("old")], [table("old", [["旧值"]])]);
  await prepareTableReprocess({
    docId: "doc-1",
    stagingId: "failure",
    dataRoot,
    sourceBuffer: Buffer.from("source-v1"),
    activeChunks: repository.read().chunks,
    activeRagTables: repository.read().ragTables,
    build: async () => ({
      chunks: [chunk("new")],
      ragTables: [table("new", [["新值"]])],
    }),
  });
  repository.failNextRagTableWrite = true;
  await assert.rejects(
    publishTableReprocess({
      docId: "doc-1",
      stagingId: "failure",
      dataRoot,
      repository,
      sourceBuffer: Buffer.from("source-v1"),
    }),
    /injected_ragtable_write_failure/
  );
  assert.equal(repository.read().chunks[0]?.id, "old");
  assert.equal(repository.read().ragTables[0]?.tableId, "old");

  const transactionPath = path.join(
    dataRoot,
    "reprocess",
    "doc-1",
    "failure",
    "transaction.json"
  );
  const transaction = JSON.parse(fs.readFileSync(transactionPath, "utf8"));
  transaction.state = "applying";
  fs.writeFileSync(transactionPath, JSON.stringify(transaction));
  repository.writeChunks([chunk("new")]);
  recoverIncompleteTableReprocessTransactions({ dataRoot, repository });
  assert.equal(repository.read().chunks[0]?.id, "old");
  assert.equal(repository.read().ragTables[0]?.tableId, "old");
});

function temporaryRoot(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "table-reprocess-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function chunk(id: string): Chunk {
  return {
    id,
    documentId: "doc-1",
    content: id,
    embedding: [1],
  } as Chunk;
}

function table(id: string, rows: string[][]): RagTable {
  return {
    tableId: id,
    docId: "doc-1",
    docTitle: "文档",
    tableTitle: "表",
    tableType: "generic_table",
    sectionPath: [],
    pageStart: 1,
    pageEnd: 1,
    columns: [{ columnId: "c1", header: "列", canonicalName: "列", headerPath: ["列"], originalIndex: 0 }],
    rows: rows.map((values, index) => ({
      rowId: `${id}-${index}`,
      tableId: id,
      rowIndex: index,
      rowType: "data",
      cells: { 列: values[0] ?? "" },
      pageStart: 1,
      pageEnd: 1,
      searchText: values.join(" "),
    })),
    markdownFull: "",
    confidence: 1,
    warnings: [],
  };
}

function memoryRepository(
  initialChunks: Chunk[],
  initialTables: RagTable[]
): ReprocessRepository & { failNextRagTableWrite: boolean } {
  let chunks = structuredClone(initialChunks);
  let ragTables = structuredClone(initialTables);
  return {
    failNextRagTableWrite: false,
    read: () => ({
      chunks: structuredClone(chunks),
      ragTables: structuredClone(ragTables),
    }),
    writeChunks: (next) => {
      chunks = structuredClone(next);
    },
    writeRagTables(next) {
      if (this.failNextRagTableWrite) {
        this.failNextRagTableWrite = false;
        throw new Error("injected_ragtable_write_failure");
      }
      ragTables = structuredClone(next);
    },
  };
}
