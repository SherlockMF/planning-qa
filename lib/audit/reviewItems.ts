import type { RagTable, TableRow } from "../types.ts";
import type { KnowledgeObject } from "../rag/objects.ts";
import type { AuditReviewItem, ProcessDocumentResult } from "./types.ts";

export interface ProjectReviewItemsOptions {
  artifactSeed?: string;
  maxFocusItems?: number;
  lowRiskSampleSize?: number;
}

export function projectReviewItems(
  snapshot: ProcessDocumentResult["snapshot"],
  options: ProjectReviewItemsOptions = {}
): AuditReviewItem[] {
  const chunksByObjectId = new Map<string, ProcessDocumentResult["snapshot"]["chunks"]>();
  for (const chunk of snapshot.chunks) {
    if (!chunk.objectId) continue;
    const chunks = chunksByObjectId.get(chunk.objectId) ?? [];
    chunks.push(chunk);
    chunksByObjectId.set(chunk.objectId, chunks);
  }

  const tablesById = new Map(snapshot.ragTables.map((table) => [table.tableId, table]));
  const items = snapshot.knowledgeObjects.map((object) => {
    const chunks = chunksByObjectId.get(object.id) ?? [];
    const tableId = object.sourceTableId ?? chunks.find((chunk) => chunk.sourceTableId)?.sourceTableId;
    const rowIndex = object.sourceRowIndex ?? chunks.find((chunk) => chunk.sourceRowIndex !== undefined)?.sourceRowIndex;
    const ragTable = tableId ? tablesById.get(tableId) : undefined;
    const tableRow = ragTable?.rows.find((row) => row.rowIndex === rowIndex);
    const warnings = unique([
      ...(object.warnings ?? []),
      ...chunks.flatMap((chunk) => chunk.extractionWarnings ?? []),
      ...(tableRow?.extractionWarnings ?? []),
    ]);

    return {
      auditItemId: object.id,
      objectType: object.objectType,
      title: reviewItemTitle(object),
      content: object.content,
      confidence: object.confidence,
      warnings,
      selectedForReview: false,
      source: {
        pageStart: object.sourcePageStart ?? tableRow?.pageStart,
        pageEnd: object.sourcePageEnd ?? tableRow?.pageEnd,
        blockIds: [...(object.sourceBlockIds ?? [])],
        tableId,
        rowIndex,
        ragTableId: ragTable?.tableId,
        knowledgeObjectId: object.id,
        chunkIds: chunks.map((chunk) => chunk.id).sort(),
      },
      tableContext: ragTable && tableRow
        ? buildTableContext(ragTable, tableRow)
        : undefined,
    } satisfies AuditReviewItem;
  });

  const maxFocusItems = Math.min(20, Math.max(0, options.maxFocusItems ?? 20));
  selectByReason(items, "warning", (item) => item.warnings.length > 0, maxFocusItems);
  selectByReason(
    items,
    "low_confidence",
    (item) => item.confidence !== undefined && item.confidence < 0.8,
    maxFocusItems
  );
  selectByReason(items, "table_coverage", (item) => item.source.ragTableId !== undefined, maxFocusItems);

  const remaining = maxFocusItems - items.filter((item) => item.selectedForReview).length;
  const lowRiskSampleSize = Math.min(
    remaining,
    Math.max(0, options.lowRiskSampleSize ?? 0)
  );
  const seed = options.artifactSeed ?? snapshot.knowledgeObjects[0]?.docId ?? "audit";
  for (const item of stableLowRiskSample(items, seed, lowRiskSampleSize)) {
    item.selectedForReview = true;
    item.selectionReason = "stable_sample";
  }

  return items;
}

export function stableLowRiskSample(
  items: AuditReviewItem[],
  artifactSeed: string,
  sampleSize: number
): AuditReviewItem[] {
  return items
    .filter((item) => !item.selectedForReview)
    .map((item) => ({ item, hash: fnv1a(`${artifactSeed}${item.auditItemId}`) }))
    .sort((left, right) => left.hash - right.hash || left.item.auditItemId.localeCompare(right.item.auditItemId))
    .slice(0, Math.max(0, sampleSize))
    .map(({ item }) => item);
}

function selectByReason(
  items: AuditReviewItem[],
  reason: NonNullable<AuditReviewItem["selectionReason"]>,
  predicate: (item: AuditReviewItem) => boolean,
  maxFocusItems: number
): void {
  let selectedCount = items.filter((item) => item.selectedForReview).length;
  for (const item of items) {
    if (selectedCount >= maxFocusItems) return;
    if (item.selectedForReview || !predicate(item)) continue;
    item.selectedForReview = true;
    item.selectionReason = reason;
    selectedCount += 1;
  }
}

function buildTableContext(ragTable: RagTable, targetRow: TableRow) {
  const targetPosition = ragTable.rows.findIndex((row) => row.rowId === targetRow.rowId);
  const previousRow = targetPosition > 0 ? ragTable.rows[targetPosition - 1] : undefined;
  const nextRow = targetPosition >= 0 ? ragTable.rows[targetPosition + 1] : undefined;
  const headers = ragTable.columns.map((column) => column.header);

  return {
    headers,
    targetRow: rowValues(headers, targetRow),
    previousRow: previousRow ? rowValues(headers, previousRow) : undefined,
    nextRow: nextRow ? rowValues(headers, nextRow) : undefined,
  };
}

function rowValues(headers: string[], row: TableRow): string[] {
  return headers.map((header) => row.cells[header] ?? "");
}

function reviewItemTitle(object: KnowledgeObject): string {
  if (object.title?.trim()) return object.title.trim();
  if ("rowKey" in object && typeof object.rowKey === "string" && object.rowKey.trim()) {
    return object.rowKey.trim();
  }
  if ("itemName" in object && typeof object.itemName === "string" && object.itemName.trim()) {
    return object.itemName.trim();
  }
  return object.sectionPathText || object.objectType;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
