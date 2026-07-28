// ============================================================================
// 评测批次：创建 / 查询（执行见同文件后续）
// ============================================================================

import type {
  Chunk,
  Document,
  EvaluationBatch,
  EvaluationItem,
  RagTable,
} from "../types.ts";
import {
  FileEvaluationBatchStore,
  getDefaultEvaluationBatchStore,
} from "../db/evaluationBatches.ts";
import { toEvaluationCaseSnapshots } from "./caseSnapshot.ts";
import {
  EVALUATOR_VERSION,
  hashCaseSet,
  knowledgeIndexFingerprint,
} from "./hash.ts";
import { recountBatchResults } from "./batchStats.ts";

const CLIENT_REQUEST_IDEM_MS = 15_000;

export interface EvaluationBatchKnowledgeSnapshot {
  documents: Document[];
  chunks: Chunk[];
  ragTables: RagTable[];
}

export interface CreateEvaluationBatchDeps {
  versionLabel: string;
  changeNote: string;
  caseIds?: string[];
  clientRequestId?: string;
  /** 当前题库；测试可注入，生产由调用方从 store 传入 */
  items: EvaluationItem[];
  knowledge: EvaluationBatchKnowledgeSnapshot;
  modelConfigSnapshot: Record<string, string | number | boolean | null>;
  ragConfigSnapshot: Record<string, string | number | boolean | null>;
  store?: FileEvaluationBatchStore;
  now?: () => string;
  newId?: () => string;
}

export function createEvaluationBatch(
  input: CreateEvaluationBatchDeps
): EvaluationBatch {
  const store = input.store ?? getDefaultEvaluationBatchStore();
  const now = input.now ?? (() => new Date().toISOString());
  const createdAt = now();

  if (input.clientRequestId) {
    const existing = findIdempotentBatch(
      store.list(),
      input.clientRequestId,
      createdAt
    );
    if (existing) return existing;
  }

  const idSet =
    input.caseIds && input.caseIds.length > 0
      ? new Set(input.caseIds)
      : null;
  const selected = input.items.filter((item) => !idSet || idSet.has(item.id));
  if (selected.length === 0) {
    throw new Error("没有可运行的评测题目");
  }

  const caseSnapshot = toEvaluationCaseSnapshots(selected);
  const counts = recountBatchResults([]);
  const batch: EvaluationBatch = {
    id: (input.newId ?? defaultBatchId)(),
    versionLabel: input.versionLabel.trim() || "unnamed",
    changeNote: input.changeNote.trim(),
    status: "queued",
    caseIds: caseSnapshot.map((item) => item.id),
    caseSnapshot,
    caseSetHash: hashCaseSet(caseSnapshot),
    evaluatorVersion: EVALUATOR_VERSION,
    knowledgeIndexFingerprint: knowledgeIndexFingerprint(input.knowledge),
    modelConfigSnapshot: { ...input.modelConfigSnapshot },
    ragConfigSnapshot: { ...input.ragConfigSnapshot },
    caseResults: [],
    ...counts,
    createdAt,
    clientRequestId: input.clientRequestId,
  };

  store.save(batch);
  return store.get(batch.id)!;
}

export function listBatches(
  store: FileEvaluationBatchStore = getDefaultEvaluationBatchStore()
): EvaluationBatch[] {
  return store.list();
}

export function getBatch(
  id: string,
  store: FileEvaluationBatchStore = getDefaultEvaluationBatchStore()
): EvaluationBatch | undefined {
  return store.get(id);
}

function findIdempotentBatch(
  batches: EvaluationBatch[],
  clientRequestId: string,
  nowIso: string
): EvaluationBatch | undefined {
  const nowMs = Date.parse(nowIso);
  return batches.find((batch) => {
    if (batch.clientRequestId !== clientRequestId) return false;
    const createdMs = Date.parse(batch.createdAt);
    if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) return false;
    return nowMs - createdMs <= CLIENT_REQUEST_IDEM_MS;
  });
}

function defaultBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
