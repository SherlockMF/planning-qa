import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, RagTable, Block } from "../lib/types.ts";
import type { KnowledgeObject } from "../lib/rag/objects.ts";
import type { AuditSourceItem } from "../lib/audit/types.ts";
import {
  buildAuditReviewItems,
  selectFocusReviewItems,
} from "../lib/audit/reviewItems.ts";

function auditItem(
  auditItemId: string,
  overrides: Partial<AuditSourceItem> = {}
): AuditSourceItem {
  return {
    auditItemId,
    objectType: "plain_section",
    title: auditItemId,
    sourceBlockIds: [],
    knowledgeObjectId: auditItemId,
    chunkIds: [],
    confidence: 0.95,
    warnings: [],
    contentSha256: `sha-${auditItemId}`,
    selectedForReview: false,
    content: `content-${auditItemId}`,
    ...overrides,
  };
}

test("projects source ids without persisting embeddings", () => {
  const tableObject = {
    id: "table-object",
    docId: "doc-audit",
    objectType: "structured_table",
    title: "指标表",
    content: "指标表正文",
    sectionPath: [],
    sectionPathText: "",
    sourcePageStart: 2,
    sourcePageEnd: 2,
    sourceBlockIds: [],
    sourceTableId: "tbl-1",
    confidence: 0.96,
    warnings: [],
    tableType: "indicator_table",
    headers: [],
    normalizedHeaders: [],
    rows: [],
    pageSpan: [2],
    isContinuationMerged: false,
  } satisfies KnowledgeObject;
  const rowObject = {
    id: "row-object",
    docId: "doc-audit",
    objectType: "structured_table_row",
    title: "高度指标",
    content: "高度 24m",
    sectionPath: [],
    sectionPathText: "",
    sourcePageStart: 2,
    sourcePageEnd: 2,
    sourceBlockIds: ["block-0"],
    sourceTableId: "tbl-1",
    sourceRowIndex: 0,
    confidence: 0.94,
    warnings: [],
    tableObjectId: "table-object",
    tableType: "indicator_table",
    rowIndex: 0,
    fields: { 指标: "高度", 数值: "24m" },
    normalizedFields: {},
  } satisfies KnowledgeObject;
  const chunk: Chunk = {
    id: "chunk-1",
    documentId: "doc-audit",
    fileName: "指标.pdf",
    city: "测试城市",
    chunkType: "table_row",
    objectId: "row-object",
    content: "高度 24m",
    keywords: [],
    embedding: [0.1, 0.2],
    createdAt: "2026-07-15T00:00:00.000Z",
  };
  const ragTable: RagTable = {
    tableId: "tbl-1",
    docId: "doc-audit",
    docTitle: "指标",
    tableTitle: "指标表",
    tableType: "indicator_table",
    sectionPath: [],
    pageStart: 2,
    pageEnd: 2,
    columns: [],
    rows: [],
    markdownFull: "| 指标 | 数值 |\n| --- | --- |\n| 高度 | 24m |",
    confidence: 0.96,
    warnings: [],
  };
  const block: Block = {
    type: "table_row",
    pageStart: 2,
    pageEnd: 2,
    rawText: "高度\t24m",
    normalizedText: "高度 24m",
  };

  const items = buildAuditReviewItems({
    blocks: [block],
    knowledgeObjects: [tableObject, rowObject],
    chunks: [chunk],
    ragTables: [ragTable],
    warnings: [],
  });
  const table = items.find((item) => item.knowledgeObjectId === "table-object");
  const row = items.find((item) => item.knowledgeObjectId === "row-object");

  assert.deepEqual(row?.chunkIds, ["chunk-1"]);
  assert.equal(row?.ragTableId, "tbl-1");
  assert.equal(row?.tableMarkdown, undefined);
  assert.equal(table?.tableMarkdown, ragTable.markdownFull);
  assert.equal(row?.sourceExcerpt, "高度 24m");
  assert.doesNotMatch(JSON.stringify(items), /0\.1/);
});

test("selects risks first and remains stable", () => {
  const items = Array.from({ length: 30 }, (_, index) =>
    auditItem(`plain_section:item-${index}`, {
      confidence: index === 29 ? 0.5 : 0.95,
      warnings: index === 28 ? ["parse_warning"] : [],
    })
  );

  const first = selectFocusReviewItems(items, "doc-audit:artifact-a");
  const second = selectFocusReviewItems(items, "doc-audit:artifact-a");

  assert.deepEqual(first, second);
  assert.equal(first.items.filter((item) => item.selectedForReview).length, 20);
  assert.equal(
    first.items.find((item) => item.auditItemId === "plain_section:item-28")
      ?.selectedForReview,
    true
  );
  assert.equal(
    first.items.find((item) => item.auditItemId === "plain_section:item-29")
      ?.selectedForReview,
    true
  );
});

test("records a coverage warning when table minimums exceed the cap", () => {
  const items = Array.from({ length: 12 }, (_, index) => {
    const ragTableId = `table-${index}`;
    return [
      auditItem(`structured_table:table-${index}`, {
        objectType: "structured_table",
        ragTableId,
      }),
      auditItem(`structured_table_row:row-${index}`, {
        objectType: "structured_table_row",
        ragTableId,
      }),
    ];
  }).flat();

  const result = selectFocusReviewItems(items, "doc-audit:artifact-a");

  assert.equal(result.items.filter((item) => item.selectedForReview).length, 20);
  assert.deepEqual(result.selectionWarnings, [
    "review_table_coverage_truncated",
  ]);
});
