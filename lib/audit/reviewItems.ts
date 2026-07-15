import { createHash } from "node:crypto";

import type { KnowledgeObject } from "../rag/objects.ts";
import { blockIdAt } from "../rag/sectionTree.ts";
import type {
  AuditPipelineSnapshot,
  AuditSourceItem,
  FocusSelectionResult,
} from "./types.ts";

const DEFAULT_FOCUS_LIMIT = 20;
const LOW_CONFIDENCE_THRESHOLD = 0.8;

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildAuditReviewItems(
  input: AuditPipelineSnapshot
): AuditSourceItem[] {
  const blockById = new Map(
    input.blocks.map((block, index) => [blockIdAt(index), block])
  );
  const chunkIdsByObjectId = new Map<string, string[]>();
  for (const chunk of input.chunks) {
    if (!chunk.objectId) continue;
    const chunkIds = chunkIdsByObjectId.get(chunk.objectId) ?? [];
    chunkIds.push(chunk.id);
    chunkIdsByObjectId.set(chunk.objectId, chunkIds);
  }
  for (const chunkIds of chunkIdsByObjectId.values()) chunkIds.sort();

  const tableIdByObjectId = new Map<string, string>();
  for (const object of input.knowledgeObjects) {
    if (object.objectType !== "structured_table") continue;
    tableIdByObjectId.set(object.id, object.sourceTableId ?? object.id);
  }
  const ragTableById = new Map(
    input.ragTables.map((ragTable) => [ragTable.tableId, ragTable])
  );

  return input.knowledgeObjects.map((object) => {
    const sourceBlockIds = [...(object.sourceBlockIds ?? [])];
    const sourceExcerpt = sourceBlockIds
      .map((blockId) => blockById.get(blockId)?.normalizedText)
      .filter((text): text is string => text !== undefined)
      .join("\n\n");
    const linkedTableObjectId = tableObjectIdOf(object);
    const ragTableId =
      object.sourceTableId ??
      (linkedTableObjectId
        ? tableIdByObjectId.get(linkedTableObjectId)
        : undefined) ??
      (object.objectType === "structured_table"
        ? tableIdByObjectId.get(object.id)
        : undefined);
    const ragTable = ragTableId ? ragTableById.get(ragTableId) : undefined;
    const title = object.title?.trim() || object.id;

    return {
      auditItemId: `${object.objectType}:${object.id}`,
      objectType: object.objectType,
      title,
      sourcePageStart: object.sourcePageStart,
      sourcePageEnd: object.sourcePageEnd,
      sourceBlockIds,
      sourceTableId: object.sourceTableId,
      sourceRowIndex: object.sourceRowIndex,
      knowledgeObjectId: object.id,
      chunkIds: [...(chunkIdsByObjectId.get(object.id) ?? [])],
      ragTableId,
      confidence: object.confidence,
      warnings: [...(object.warnings ?? [])],
      contentSha256: sha256Text(object.content),
      selectedForReview: false,
      content: object.content,
      ...(sourceExcerpt ? { sourceExcerpt } : {}),
      ...(object.objectType === "structured_table" && ragTable
        ? { tableMarkdown: ragTable.markdownFull }
        : {}),
    };
  });
}

export function selectFocusReviewItems(
  items: AuditSourceItem[],
  seed: string,
  limit = DEFAULT_FOCUS_LIMIT
): FocusSelectionResult {
  const cap = Math.max(0, limit);
  const selectedReasons = new Map<string, string>();
  const canSelect = () => selectedReasons.size < cap;
  const select = (item: AuditSourceItem | undefined, reason: string) => {
    if (!item || !canSelect() || selectedReasons.has(item.auditItemId)) return;
    selectedReasons.set(item.auditItemId, reason);
  };

  const risks = items
    .filter(
      (item) => item.warnings.length > 0 || item.confidence < LOW_CONFIDENCE_THRESHOLD
    )
    .sort(
      (left, right) =>
        right.warnings.length - left.warnings.length ||
        left.confidence - right.confidence ||
        left.auditItemId.localeCompare(right.auditItemId)
    );
  for (const item of risks) {
    select(item, item.warnings.length > 0 ? "warning" : "low_confidence");
  }

  const tableIds = [...new Set(items.flatMap((item) => item.ragTableId ?? []))]
    .sort();
  for (const tableId of tableIds) {
    const tableItems = items
      .filter((item) => item.ragTableId === tableId)
      .sort((left, right) => left.auditItemId.localeCompare(right.auditItemId));
    select(
      tableItems.find((item) => item.objectType === "structured_table"),
      "table_header"
    );
    select(
      tableItems.find((item) => item.objectType === "structured_table_row"),
      "table_representative_row"
    );
  }

  const stableRemainder = items
    .filter((item) => !selectedReasons.has(item.auditItemId))
    .map((item) => ({ item, hash: sha256Text(`${seed}:${item.auditItemId}`) }))
    .sort(
      (left, right) =>
        left.hash.localeCompare(right.hash) ||
        left.item.auditItemId.localeCompare(right.item.auditItemId)
    )
    .map(({ item }) => item);
  const coveredObjectTypes = new Set(
    items
      .filter((item) => selectedReasons.has(item.auditItemId))
      .map((item) => item.objectType)
  );
  for (const item of stableRemainder) {
    if (coveredObjectTypes.has(item.objectType)) continue;
    select(item, "object_type_coverage");
    coveredObjectTypes.add(item.objectType);
  }
  for (const item of stableRemainder) select(item, "stable_sample");

  const hasCompleteTableCoverage = tableIds.every((tableId) => {
    const selectedForTable = items.filter(
      (item) =>
        item.ragTableId === tableId && selectedReasons.has(item.auditItemId)
    );
    return (
      selectedForTable.some((item) => item.objectType === "structured_table") &&
      selectedForTable.some(
        (item) => item.objectType === "structured_table_row"
      )
    );
  });

  return {
    items: items.map((item) => {
      const selectionReason = selectedReasons.get(item.auditItemId);
      return {
        ...item,
        selectedForReview: selectionReason !== undefined,
        selectionReason,
      };
    }),
    selectionWarnings: hasCompleteTableCoverage
      ? []
      : ["review_table_coverage_truncated"],
  };
}

function tableObjectIdOf(object: KnowledgeObject): string | undefined {
  return "tableObjectId" in object && typeof object.tableObjectId === "string"
    ? object.tableObjectId
    : undefined;
}
