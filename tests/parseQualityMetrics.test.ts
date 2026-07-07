import test from "node:test";
import assert from "node:assert/strict";
import { summarizeParseQuality } from "../lib/rag/eval/parseQualityMetrics.ts";
import type { Block } from "../lib/types.ts";

function tableBlock(input: {
  title?: string;
  headers: string[];
  rows: string[][];
}): Block {
  return {
    type: "table",
    pageStart: 1,
    pageEnd: 1,
    rawText: "",
    normalizedText: "",
    table: {
      tableId: "table-test",
      title: input.title,
      headers: input.headers,
      rows: input.rows,
      markdown: "",
    },
  };
}

test("summarizes table parse quality metrics", () => {
  const metrics = summarizeParseQuality([
    tableBlock({
      title: "基础教育类设施配置指标表",
      headers: ["设施名称", "服务范围", "服务规模"],
      rows: [["托儿所", "岁6以下", "0万.9人6"]],
    }),
    tableBlock({
      headers: ["", ""],
      rows: [
        ["综合考虑出生人口变化趋势、各年龄组占比等因素。", "核算说明不构成配置指标表。"],
      ],
    }),
  ]);

  assert.equal(metrics.tableCount, 2);
  assert.equal(metrics.untitledTableCount, 1);
  assert.equal(metrics.emptyHeaderCellCount, 2);
  assert.equal(metrics.headerCellCount, 5);
  assert.equal(metrics.lowFidelityCellCount, 2);
  assert.equal(metrics.lowFidelityTableCount, 1);
  assert.equal(metrics.lowFidelityWarnings.scrambled_numeric_unit, 1);
  assert.equal(metrics.lowFidelityWarnings.noisy_extraction_text, 1);
});
