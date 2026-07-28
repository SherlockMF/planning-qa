// ============================================================================
// 评测批次：创建 / 查询 / 异步执行 / 取消
// ============================================================================

import type {
  Chunk,
  Document,
  EvaluationBatch,
  EvaluationBatchCaseResult,
  EvaluationItem,
  EvaluationRunStatus,
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
const DEFAULT_CONCURRENCY = 3;

/** 进程内防重入：同一 batchId 同时只跑一个 worker */
const activeRuns = new Set<string>();
/** 协作式取消标记 */
const cancelRequested = new Set<string>();

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

export function cancelEvaluationBatch(
  batchId: string,
  store: FileEvaluationBatchStore = getDefaultEvaluationBatchStore()
): EvaluationBatch | undefined {
  cancelRequested.add(batchId);
  const batch = store.get(batchId);
  if (!batch) return undefined;
  if (batch.status === "queued") {
    const cancelled: EvaluationBatch = {
      ...batch,
      status: "cancelled",
      finishedAt: new Date().toISOString(),
    };
    store.save(cancelled);
    cancelRequested.delete(batchId);
    return cancelled;
  }
  return batch;
}

export interface ExecuteEvaluationBatchOptions {
  store?: FileEvaluationBatchStore;
  concurrency?: number;
  now?: () => string;
  scoreCase?: (item: EvaluationItem) => Promise<EvaluationBatchCaseResult>;
  onPersist?: (batch: EvaluationBatch) => void;
  /** 跑完后把结果镜像回题库 latest（可选） */
  mirrorToEvaluation?: (
    results: EvaluationBatchCaseResult[],
    batchId: string
  ) => Promise<void> | void;
}

/**
 * 异步执行批次。可 fire-and-forget；同一 batchId 防重入。
 * 每题完成后立即落盘，支持 cancel 协作停止。
 */
export async function executeEvaluationBatch(
  batchId: string,
  options: ExecuteEvaluationBatchOptions = {}
): Promise<EvaluationBatch | undefined> {
  if (activeRuns.has(batchId)) return options.store?.get(batchId);
  const store = options.store ?? getDefaultEvaluationBatchStore();
  const now = options.now ?? (() => new Date().toISOString());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const batch = store.get(batchId);
  if (!batch) return undefined;
  if (batch.status === "done" || batch.status === "cancelled") return batch;
  if (cancelRequested.has(batchId)) {
    const cancelled: EvaluationBatch = {
      ...batch,
      status: "cancelled",
      finishedAt: now(),
    };
    store.save(cancelled);
    cancelRequested.delete(batchId);
    return cancelled;
  }

  activeRuns.add(batchId);
  try {
    let current: EvaluationBatch = {
      ...batch,
      status: "running",
      startedAt: batch.startedAt ?? now(),
      caseResults: [...batch.caseResults],
    };
    store.save(current);
    options.onPersist?.(current);

    const scoreCase = options.scoreCase ?? defaultScoreCase;
    const remaining = current.caseSnapshot.filter(
      (item) => !current.caseResults.some((r) => r.caseId === item.id)
    );

    // 共用结果数组；await 之后的 push/save 是同步的，worker 间不会丢题
    const results: EvaluationBatchCaseResult[] = [...current.caseResults];
    let cursor = 0;
    let cancelled = false;

    async function worker() {
      while (cursor < remaining.length) {
        if (cancelRequested.has(batchId)) {
          cancelled = true;
          break;
        }
        const index = cursor++;
        if (index >= remaining.length) break;
        const caseItem = remaining[index];
        let caseResult: EvaluationBatchCaseResult;
        try {
          caseResult = await scoreCase(caseItem);
        } catch (error) {
          caseResult = {
            caseId: caseItem.id,
            status: "ERROR",
            errorReason:
              "运行异常：" +
              (error instanceof Error ? error.message : String(error)),
          };
        }
        if (cancelRequested.has(batchId)) {
          cancelled = true;
        }
        results.push(caseResult);
        current = {
          ...current,
          caseResults: [...results],
          ...recountBatchResults(results),
        };
        store.save(current);
        options.onPersist?.(current);
        if (cancelled) break;
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, Math.max(remaining.length, 1)) },
        () => worker()
      )
    );

    const finalStatus =
      cancelRequested.has(batchId) || cancelled ? "cancelled" : "done";
    current = {
      ...current,
      status: finalStatus,
      finishedAt: now(),
      ...recountBatchResults(current.caseResults),
    };
    store.save(current);
    options.onPersist?.(current);
    cancelRequested.delete(batchId);

    if (finalStatus === "done" && options.mirrorToEvaluation) {
      await options.mirrorToEvaluation(current.caseResults, current.id);
    }

    return current;
  } catch (error) {
    const failed = store.get(batchId);
    if (failed) {
      const errored: EvaluationBatch = {
        ...failed,
        status: "error",
        finishedAt: now(),
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      store.save(errored);
      options.onPersist?.(errored);
      cancelRequested.delete(batchId);
      return errored;
    }
    throw error;
  } finally {
    activeRuns.delete(batchId);
  }
}

export function toEvaluationBatchCaseResult(
  item: EvaluationItem
): EvaluationBatchCaseResult {
  const status = (item.status ??
    item.autoStatus ??
    "ERROR") as EvaluationRunStatus;
  return {
    caseId: item.id,
    status,
    workflowTraceId: item.workflowTraceId,
    systemAnswer: item.systemAnswer,
    autoAnswerScore: item.autoAnswerScore ?? item.answerScore,
    autoJudgeUncertain: item.autoJudgeUncertain,
    inTop5: item.inTop5,
    citationCorrect: item.citationCorrect,
    refusedCorrectly: item.refusedCorrectly,
    errorReason: item.errorReason,
    answerDurationMs: item.answerDurationMs,
    tokensUsed: item.tokensUsed,
    runStartedAt: item.runStartedAt,
    runFinishedAt: item.runFinishedAt,
  };
}

async function defaultScoreCase(
  item: EvaluationItem
): Promise<EvaluationBatchCaseResult> {
  // 动态导入避免纯单元测试路径强依赖 generateAnswer / Next 别名
  const { scoreEvaluationItem } = await import("../db/evaluation.ts");
  const scored = await scoreEvaluationItem(item);
  return toEvaluationBatchCaseResult(scored);
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
