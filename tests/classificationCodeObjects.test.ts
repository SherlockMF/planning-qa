import test from "node:test";
import assert from "node:assert/strict";

import { extractClassificationCodeObjects } from "../lib/rag/normalizers/classificationCode.ts";
import type {
  StructuredTableObject,
  StructuredTableRowObject,
} from "../lib/rag/objects.ts";

function classificationRow(
  rowIndex: number,
  content: string
): StructuredTableRowObject {
  return {
    id: `structured_table_row-${rowIndex}`,
    docId: "doc-repeated-classification",
    objectType: "structured_table_row",
    content,
    sectionPath: ["公共服务设施"],
    sectionPathText: "公共服务设施",
    sourcePageStart: 43,
    sourcePageEnd: 43,
    sourcePages: [43],
    sourceBlockIds: ["block-533"],
    sourceTableId: "tbl-31",
    confidence: 0.9,
    tableObjectId: "structured_table-17q2g1c",
    tableType: "classification_code_table",
    rowIndex,
    rowKey: "22",
    fields: {
      代码: "22",
      名称: "综合环卫站",
      内容: content,
    },
    normalizedFields: {},
  };
}

const table: StructuredTableObject = {
  id: "structured_table-17q2g1c",
  docId: "doc-repeated-classification",
  objectType: "structured_table",
  content: "公共服务设施分类代码表",
  sectionPath: ["公共服务设施"],
  sectionPathText: "公共服务设施",
  sourcePageStart: 43,
  sourcePageEnd: 43,
  sourcePages: [43],
  sourceBlockIds: ["block-533"],
  sourceTableId: "tbl-31",
  confidence: 0.9,
  tableTitle: "公共服务设施分类代码表",
  tableType: "classification_code_table",
  headers: [],
  normalizedHeaders: [],
  rows: [
    classificationRow(4, "街道级，面积 1200，服务规模 20000—30000"),
    classificationRow(5, "小计，每千人建筑面积 10"),
  ],
  pageSpan: [43],
  isContinuationMerged: false,
};

test("keeps repeated classification rows stable and unique by row identity", () => {
  const first = extractClassificationCodeObjects(table.docId, [table]);
  const second = extractClassificationCodeObjects(table.docId, [table]);

  assert.equal(first.length, 2);
  assert.notEqual(first[0]?.id, first[1]?.id);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id)
  );
  assert.deepEqual(
    first.map((item) => item.sourceRowIndex),
    [4, 5]
  );
});
