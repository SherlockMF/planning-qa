import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Chunk, RagTable } from "../types.ts";
import {
  assertReprocessIdentifier,
  listTransactionFiles,
  readReprocessJson,
  writeJsonFileAtomically,
  writeReprocessJson,
} from "./tableReprocessStore.ts";

export type ReprocessStatus = "ready" | "blocked" | "failed" | "published";

export interface ReprocessManifest {
  sourceHash: string;
  baseChunksHash: string;
  baseRagTablesHash: string;
  targetChunksHash: string;
  targetRagTablesHash: string;
}

export interface ReprocessDiff {
  chunkCount: { before: number; after: number };
  tableCount: { before: number; after: number };
  tables: Array<{
    tableId: string;
    change: "added" | "removed" | "modified" | "unchanged";
    beforeRows: number;
    afterRows: number;
  }>;
}

export interface ReprocessPreparation {
  docId: string;
  stagingId: string;
  status: ReprocessStatus;
  createdAt: string;
  manifest: ReprocessManifest;
  diff: ReprocessDiff;
  blockedReasons: string[];
  error?: string;
}

export interface ReprocessBuildResult {
  chunks: Chunk[];
  ragTables: RagTable[];
}

export interface PrepareTableReprocessInput {
  docId: string;
  stagingId?: string;
  dataRoot?: string;
  sourceBuffer: Buffer;
  activeChunks: Chunk[];
  activeRagTables: RagTable[];
  build: () => Promise<ReprocessBuildResult>;
}

export interface ReprocessRepository {
  read(): { chunks: Chunk[]; ragTables: RagTable[] };
  writeChunks(chunks: Chunk[]): void;
  writeRagTables(ragTables: RagTable[]): void;
}

interface ReprocessTransaction {
  transactionId: string;
  docId: string;
  stagingId: string;
  state: "prepared" | "applying" | "committed" | "rolled_back";
  oldChunks: Chunk[];
  oldRagTables: RagTable[];
  targetChunks: Chunk[];
  targetRagTables: RagTable[];
  oldChunksHash: string;
  oldRagTablesHash: string;
  targetChunksHash: string;
  targetRagTablesHash: string;
}

const DEFAULT_DATA_ROOT = path.join(process.cwd(), ".data");

export async function prepareTableReprocess(
  input: PrepareTableReprocessInput
): Promise<ReprocessPreparation> {
  const stagingId =
    input.stagingId ?? `stage-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const dataRoot = input.dataRoot ?? DEFAULT_DATA_ROOT;
  assertReprocessIdentifier(input.docId);
  assertReprocessIdentifier(stagingId);

  const oldChunks = documentChunks(input.activeChunks, input.docId);
  const oldTables = documentTables(input.activeRagTables, input.docId);
  let target: ReprocessBuildResult;
  try {
    target = await input.build();
  } catch (error) {
    target = { chunks: [], ragTables: [] };
    const failed = preparation(
      input.docId,
      stagingId,
      input.sourceBuffer,
      oldChunks,
      oldTables,
      target,
      "failed",
      [],
      String(error)
    );
    persistPreparation(dataRoot, failed, target);
    return failed;
  }

  const blockedReasons = structuralGateReasons(target);
  const result = preparation(
    input.docId,
    stagingId,
    input.sourceBuffer,
    oldChunks,
    oldTables,
    target,
    blockedReasons.length ? "blocked" : "ready",
    blockedReasons
  );
  persistPreparation(dataRoot, result, target);
  return result;
}

export function getTableReprocess(
  docId: string,
  stagingId: string,
  options: { dataRoot?: string } = {}
): ReprocessPreparation {
  return readReprocessJson<ReprocessPreparation>(
    options.dataRoot ?? DEFAULT_DATA_ROOT,
    docId,
    stagingId,
    "preparation.json"
  );
}

export async function publishTableReprocess(input: {
  docId: string;
  stagingId: string;
  dataRoot?: string;
  repository: ReprocessRepository;
  sourceBuffer: Buffer;
}): Promise<
  | ReprocessPreparation
  | { status: "conflict"; reason: "blocked" | "source_drift" | "baseline_drift" }
> {
  const dataRoot = input.dataRoot ?? DEFAULT_DATA_ROOT;
  const prepared = getTableReprocess(input.docId, input.stagingId, { dataRoot });
  if (prepared.status === "published") return prepared;
  if (prepared.status !== "ready") return { status: "conflict", reason: "blocked" };
  if (hashBuffer(input.sourceBuffer) !== prepared.manifest.sourceHash) {
    return { status: "conflict", reason: "source_drift" };
  }

  const active = input.repository.read();
  const oldChunks = documentChunks(active.chunks, input.docId);
  const oldTables = documentTables(active.ragTables, input.docId);
  if (
    hashJson(oldChunks) !== prepared.manifest.baseChunksHash ||
    hashJson(oldTables) !== prepared.manifest.baseRagTablesHash
  ) {
    return { status: "conflict", reason: "baseline_drift" };
  }

  const targetChunks = readReprocessJson<Chunk[]>(
    dataRoot,
    input.docId,
    input.stagingId,
    "chunks.json"
  );
  const targetTables = readReprocessJson<RagTable[]>(
    dataRoot,
    input.docId,
    input.stagingId,
    "ragtables.json"
  );
  const transaction: ReprocessTransaction = {
    transactionId: crypto.randomUUID(),
    docId: input.docId,
    stagingId: input.stagingId,
    state: "prepared",
    oldChunks,
    oldRagTables: oldTables,
    targetChunks,
    targetRagTables: targetTables,
    oldChunksHash: hashJson(oldChunks),
    oldRagTablesHash: hashJson(oldTables),
    targetChunksHash: hashJson(targetChunks),
    targetRagTablesHash: hashJson(targetTables),
  };
  writeReprocessJson(
    dataRoot,
    input.docId,
    input.stagingId,
    "transaction.json",
    transaction
  );

  const nextChunks = replaceDocumentChunks(active.chunks, input.docId, targetChunks);
  const nextTables = replaceDocumentTables(active.ragTables, input.docId, targetTables);
  try {
    transaction.state = "applying";
    writeReprocessJson(
      dataRoot,
      input.docId,
      input.stagingId,
      "transaction.json",
      transaction
    );
    input.repository.writeChunks(nextChunks);
    input.repository.writeRagTables(nextTables);
    transaction.state = "committed";
    writeReprocessJson(
      dataRoot,
      input.docId,
      input.stagingId,
      "transaction.json",
      transaction
    );
    prepared.status = "published";
    writeReprocessJson(
      dataRoot,
      input.docId,
      input.stagingId,
      "preparation.json",
      prepared
    );
    return prepared;
  } catch (error) {
    input.repository.writeChunks(active.chunks);
    input.repository.writeRagTables(active.ragTables);
    transaction.state = "rolled_back";
    writeReprocessJson(
      dataRoot,
      input.docId,
      input.stagingId,
      "transaction.json",
      transaction
    );
    throw error;
  }
}

export function recoverIncompleteTableReprocessTransactions(input: {
  dataRoot?: string;
  repository: ReprocessRepository;
}): void {
  const dataRoot = input.dataRoot ?? DEFAULT_DATA_ROOT;
  for (const file of listTransactionFiles(dataRoot)) {
    const transaction = JSON.parse(
      fs.readFileSync(file, "utf8")
    ) as ReprocessTransaction;
    if (transaction.state !== "applying") continue;
    const active = input.repository.read();
    const currentChunks = documentChunks(active.chunks, transaction.docId);
    const currentTables = documentTables(active.ragTables, transaction.docId);
    if (
      hashJson(currentChunks) === transaction.targetChunksHash &&
      hashJson(currentTables) === transaction.targetRagTablesHash
    ) {
      transaction.state = "committed";
    } else {
      input.repository.writeChunks(
        replaceDocumentChunks(active.chunks, transaction.docId, transaction.oldChunks)
      );
      input.repository.writeRagTables(
        replaceDocumentTables(
          active.ragTables,
          transaction.docId,
          transaction.oldRagTables
        )
      );
      transaction.state = "rolled_back";
    }
    writeJsonFileAtomically(file, transaction);
  }
}

function preparation(
  docId: string,
  stagingId: string,
  sourceBuffer: Buffer,
  oldChunks: Chunk[],
  oldTables: RagTable[],
  target: ReprocessBuildResult,
  status: ReprocessStatus,
  blockedReasons: string[],
  error?: string
): ReprocessPreparation {
  return {
    docId,
    stagingId,
    status,
    createdAt: new Date().toISOString(),
    manifest: {
      sourceHash: hashBuffer(sourceBuffer),
      baseChunksHash: hashJson(oldChunks),
      baseRagTablesHash: hashJson(oldTables),
      targetChunksHash: hashJson(target.chunks),
      targetRagTablesHash: hashJson(target.ragTables),
    },
    diff: buildDiff(oldChunks, oldTables, target.chunks, target.ragTables),
    blockedReasons,
    error,
  };
}

function persistPreparation(
  dataRoot: string,
  prepared: ReprocessPreparation,
  target: ReprocessBuildResult
): void {
  writeReprocessJson(
    dataRoot,
    prepared.docId,
    prepared.stagingId,
    "chunks.json",
    target.chunks
  );
  writeReprocessJson(
    dataRoot,
    prepared.docId,
    prepared.stagingId,
    "ragtables.json",
    target.ragTables
  );
  writeReprocessJson(
    dataRoot,
    prepared.docId,
    prepared.stagingId,
    "manifest.json",
    prepared.manifest
  );
  writeReprocessJson(
    dataRoot,
    prepared.docId,
    prepared.stagingId,
    "diff.json",
    prepared.diff
  );
  writeReprocessJson(
    dataRoot,
    prepared.docId,
    prepared.stagingId,
    "preparation.json",
    prepared
  );
}

function structuralGateReasons(target: ReprocessBuildResult): string[] {
  const reasons: string[] = [];
  if (!target.chunks.length) reasons.push("empty_chunks");
  for (const table of target.ragTables) {
    if (!table.columns.length) reasons.push(`${table.tableId}:empty_columns`);
    if (!table.rows.length) reasons.push(`${table.tableId}:empty_rows`);
  }
  return reasons;
}

function buildDiff(
  oldChunks: Chunk[],
  oldTables: RagTable[],
  targetChunks: Chunk[],
  targetTables: RagTable[]
): ReprocessDiff {
  const before = new Map(oldTables.map((table) => [table.tableId, table]));
  const after = new Map(targetTables.map((table) => [table.tableId, table]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return {
    chunkCount: { before: oldChunks.length, after: targetChunks.length },
    tableCount: { before: oldTables.length, after: targetTables.length },
    tables: ids.map((tableId) => {
      const left = before.get(tableId);
      const right = after.get(tableId);
      return {
        tableId,
        change: !left
          ? "added"
          : !right
            ? "removed"
            : hashJson(left) === hashJson(right)
              ? "unchanged"
              : "modified",
        beforeRows: left?.rows.length ?? 0,
        afterRows: right?.rows.length ?? 0,
      };
    }),
  };
}

function documentChunks(chunks: Chunk[], docId: string): Chunk[] {
  return chunks.filter((chunk) => chunk.documentId === docId);
}

function documentTables(tables: RagTable[], docId: string): RagTable[] {
  return tables.filter((table) => table.docId === docId);
}

function replaceDocumentChunks(
  all: Chunk[],
  docId: string,
  target: Chunk[]
): Chunk[] {
  return [...all.filter((chunk) => chunk.documentId !== docId), ...target];
}

function replaceDocumentTables(
  all: RagTable[],
  docId: string,
  target: RagTable[]
): RagTable[] {
  return [...all.filter((table) => table.docId !== docId), ...target];
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
