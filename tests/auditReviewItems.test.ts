import test from "node:test";
import assert from "node:assert/strict";
import type { Chunk, RagTable } from "../lib/types.ts";
import type { KnowledgeObject } from "../lib/rag/objects.ts";
import {
  projectReviewItems,
  stableLowRiskSample,
} from "../lib/audit/reviewItems.ts";

function knowledgeObject(
  id: string,
  overrides: Partial<KnowledgeObject> = {}
): KnowledgeObject {
  return {
    id,
    docId: "doc-1",
    objectType: "plain_section",
    title: id,
    content: `${id} content`,
    sectionPath: [],
    sectionPathText: "",
    confidence: 0.95,
    ...overrides,
  } as KnowledgeObject;
}

function chunk(id: string, objectId: string, overrides: Partial<Chunk> = {}): Chunk {
  return {
    id,
    documentId: "doc-1",
    fileName: "pilot.pdf",
    city: "北京",
    chunkType: "section",
    objectId,
    content: `${id} content`,
    keywords: [],
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

const ragTable: RagTable = {
  tableId: "tbl-1",
  docId: "doc-1",
  docTitle: "pilot",
  tableTitle: "配置指标表",
  tableType: "indicator_table",
  sectionPath: [],
  pageStart: 2,
  pageEnd: 2,
  columns: [
    { columnId: "c1", header: "编号", canonicalName: "编号", headerPath: ["编号"], originalIndex: 0 },
    { columnId: "c2", header: "设施名称", canonicalName: "设施名称", headerPath: ["设施名称"], originalIndex: 1 },
    { columnId: "c3", header: "服务规模", canonicalName: "服务规模", headerPath: ["服务规模"], originalIndex: 2 },
  ],
  rows: [
    {
      rowId: "row-0",
      tableId: "tbl-1",
      rowIndex: 0,
      rowType: "data",
      cells: { 编号: "14", 设施名称: "污水设施", 服务规模: "20平方米/万平方米" },
      pageStart: 2,
      pageEnd: 2,
      searchText: "14 污水设施 20平方米/万平方米",
    },
    {
      rowId: "row-1",
      tableId: "tbl-1",
      rowIndex: 1,
      rowType: "data",
      cells: { 编号: "15", 设施名称: "综合通信机房", 服务规模: "1000—5000户" },
      pageStart: 2,
      pageEnd: 2,
      extractionWarnings: ["noisy_extraction_text"],
      searchText: "15 综合通信机房 1000—5000户",
    },
    {
      rowId: "row-2",
      tableId: "tbl-1",
      rowIndex: 2,
      rowType: "data",
      cells: { 编号: "16", 设施名称: "开闭站", 服务规模: "每处" },
      pageStart: 2,
      pageEnd: 2,
      searchText: "16 开闭站 每处",
    },
  ],
  markdownFull: "",
  confidence: 0.7,
  warnings: [],
};

function snapshot() {
  const warningRow = knowledgeObject("obj-warning-row", {
    objectType: "structured_table_row",
    sourcePageStart: 2,
    sourcePageEnd: 2,
    sourceBlockIds: ["block-table"],
    sourceTableId: "tbl-1",
    sourceRowIndex: 1,
    confidence: 0.7,
    warnings: ["noisy_extraction_text"],
  });
  const ordinaryRow = knowledgeObject("obj-ordinary-row", {
    objectType: "structured_table_row",
    sourcePageStart: 2,
    sourcePageEnd: 2,
    sourceBlockIds: ["block-table"],
    sourceTableId: "tbl-1",
    sourceRowIndex: 2,
  });
  const lowConfidence = knowledgeObject("obj-low-confidence", { confidence: 0.79 });
  const ordinarySection = knowledgeObject("obj-ordinary-section");

  return {
    blocks: [],
    knowledgeObjects: [warningRow, ordinaryRow, lowConfidence, ordinarySection],
    chunks: [
      chunk("chunk-warning", warningRow.id, {
        chunkType: "table_row",
        sourceTableId: "tbl-1",
        sourceRowIndex: 1,
      }),
      chunk("chunk-ordinary-row", ordinaryRow.id, {
        chunkType: "table_row",
        sourceTableId: "tbl-1",
        sourceRowIndex: 2,
      }),
      chunk("chunk-low", lowConfidence.id),
      chunk("chunk-ordinary", ordinarySection.id),
    ],
    ragTables: [ragTable],
    warnings: [],
  };
}

test("projects knowledge objects with joined chunks and adjacent table context", () => {
  const items = projectReviewItems(snapshot(), {
    artifactSeed: "artifact-a",
    maxFocusItems: 20,
    lowRiskSampleSize: 2,
  });

  assert.equal(items.length, 4);
  assert.equal(new Set(items.map((item) => item.auditItemId)).size, items.length);

  const warning = items.find((item) => item.warnings.includes("noisy_extraction_text"));
  assert.equal(warning?.selectionReason, "warning");
  assert.equal(warning?.source.ragTableId, "tbl-1");
  assert.deepEqual(warning?.source.chunkIds, ["chunk-warning"]);
  assert.deepEqual(warning?.tableContext, {
    headers: ["编号", "设施名称", "服务规模"],
    targetRow: ["15", "综合通信机房", "1000—5000户"],
    previousRow: ["14", "污水设施", "20平方米/万平方米"],
    nextRow: ["16", "开闭站", "每处"],
  });
});

test("selects focus items by warning, low confidence, then table coverage and caps the result", () => {
  const items = projectReviewItems(snapshot(), {
    artifactSeed: "artifact-a",
    maxFocusItems: 3,
    lowRiskSampleSize: 2,
  });

  assert.equal(items.filter((item) => item.selectedForReview).length, 3);
  assert.equal(
    items.find((item) => item.auditItemId === "obj-warning-row")?.selectionReason,
    "warning"
  );
  assert.equal(
    items.find((item) => item.auditItemId === "obj-low-confidence")?.selectionReason,
    "low_confidence"
  );
  assert.equal(
    items.find((item) => item.auditItemId === "obj-ordinary-row")?.selectionReason,
    "table_coverage"
  );
  assert.equal(
    items.find((item) => item.auditItemId === "obj-ordinary-section")?.selectedForReview,
    false
  );
});

test("stable low-risk sampling is deterministic and does not select existing focus items", () => {
  const items = projectReviewItems(snapshot(), {
    artifactSeed: "artifact-a",
    maxFocusItems: 2,
    lowRiskSampleSize: 0,
  });

  const first = stableLowRiskSample(items, "artifact-a", 2);
  const second = stableLowRiskSample(items, "artifact-a", 2);

  assert.deepEqual(
    first.map((item) => item.auditItemId),
    second.map((item) => item.auditItemId)
  );
  assert.equal(first.every((item) => !item.selectedForReview), true);
});
