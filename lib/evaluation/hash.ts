// ============================================================================
// 评测批次可比性指纹
// ----------------------------------------------------------------------------
// caseSetHash：题面集合（顺序无关）
// evaluatorVersion：评分逻辑版本常量，改判分规则时手动 bump
// knowledgeIndexFingerprint：当前可检索知识库摘要，索引变更则阻断虚假回归对比
// ============================================================================

import { createHash } from "node:crypto";
import type { Chunk, Document, EvaluationItem, RagTable } from "../types.ts";
import { toEvaluationCaseSnapshot } from "./caseSnapshot.ts";

/**
 * 评分器版本。改动 lib/db/evaluation.ts 判分语义或状态派生规则时必须 bump，
 * 否则历史 batch 会与新规则被错误判为可比。
 */
export const EVALUATOR_VERSION = "eval-scorer-v1-p0-status";

export function hashCaseSet(cases: EvaluationItem[]): string {
  const normalized = cases
    .map((item) => toEvaluationCaseSnapshot(item))
    .map((item) => JSON.stringify(stableSortKeys(item as unknown as Record<string, unknown>)))
    .sort((a, b) => a.localeCompare(b));
  return sha256(normalized.join("\n"));
}

export function evaluatorHash(): string {
  return EVALUATOR_VERSION;
}

export function knowledgeIndexFingerprint(input: {
  documents: Document[];
  chunks: Chunk[];
  ragTables: RagTable[];
}): string {
  const indexedIds = new Set(
    input.documents
      .filter((doc) => doc.enabled && doc.status === "indexed")
      .map((doc) => doc.id)
  );

  const docRows = input.documents
    .filter((doc) => indexedIds.has(doc.id))
    .map((doc) =>
      [
        doc.id,
        doc.fileName,
        doc.city,
        doc.fileType,
        doc.status,
        doc.createdAt,
        doc.effectiveDate ?? "",
        doc.projectId ?? "",
        doc.permissionLevel ?? "",
      ].join("|")
    )
    .sort((a, b) => a.localeCompare(b));

  const chunksByDoc = new Map<string, number>();
  for (const chunk of input.chunks) {
    if (!indexedIds.has(chunk.documentId)) continue;
    chunksByDoc.set(
      chunk.documentId,
      (chunksByDoc.get(chunk.documentId) ?? 0) + 1
    );
  }
  const chunkRows = [...chunksByDoc.entries()]
    .map(([documentId, count]) => `${documentId}:${count}`)
    .sort((a, b) => a.localeCompare(b));

  const tableCount = input.ragTables.filter((table) =>
    indexedIds.has(table.docId)
  ).length;

  return sha256(
    [
      "docs",
      ...docRows,
      "chunks",
      ...chunkRows,
      `tables:${tableCount}`,
    ].join("\n")
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 递归按 key 排序，保证 JSON 序列化稳定。 */
function stableSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableSortKeys(v)])
    );
  }
  return value;
}
