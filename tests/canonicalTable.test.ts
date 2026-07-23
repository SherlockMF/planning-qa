import test from "node:test";
import assert from "node:assert/strict";

import type { RawTableV2 } from "../lib/parse/tableStructure.ts";
import {
  buildTableModelFromCanonical,
  canonicalizeRawTable,
} from "../lib/parse/canonicalTable.ts";

function rawTable(cells: RawTableV2["cells"]): RawTableV2 {
  return {
    schemaVersion: 2,
    page: 14,
    bbox: [0, 0, 300, 90],
    extractionMethod: "lines",
    gridEvidence: {
      horizontalBoundaries: [0, 30, 60, 90],
      verticalBoundaries: [0, 100, 200, 300],
      lineCoverage: 1,
    },
    cells,
    ignoredFragments: [],
    warnings: [],
  };
}

function cell(
  text: string,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number
): RawTableV2["cells"][number] {
  return {
    text,
    bbox: [colStart * 100, rowStart * 30, colEnd * 100, rowEnd * 30],
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    sourceOrder: [rowStart * 10 + colStart],
  };
}

test("builds header paths only inside an explicit colspan", () => {
  const result = canonicalizeRawTable(rawTable([
    cell("设施名称", 0, 2, 0, 1),
    cell("规模性指标", 0, 1, 1, 3),
    cell("建筑面积", 1, 2, 1, 2),
    cell("用地面积", 1, 2, 2, 3),
    cell("社区卫生服务站", 2, 3, 0, 1),
    cell("350", 2, 3, 1, 2),
    cell("1000", 2, 3, 2, 3),
  ]));

  assert.equal(result.kind, "table");
  assert.deepEqual(result.table.columns.map((column) => column.headerPath), [
    ["设施名称"],
    ["规模性指标", "建筑面积"],
    ["规模性指标", "用地面积"],
  ]);

  const model = buildTableModelFromCanonical(result.table);
  assert.deepEqual(model.headerPaths, [
    ["设施名称"],
    ["规模性指标", "建筑面积"],
    ["规模性指标", "用地面积"],
  ]);
});

test("propagates a data value only across its explicit rowspan", () => {
  const result = canonicalizeRawTable(rawTable([
    cell("类别", 0, 1, 0, 1),
    cell("要求", 0, 1, 1, 3),
    cell("A", 1, 3, 0, 1),
    cell("first", 1, 2, 1, 2),
    cell("one", 1, 2, 2, 3),
    cell("second", 2, 3, 1, 2),
    cell("two", 2, 3, 2, 3),
  ]));

  assert.equal(result.kind, "table");
  assert.deepEqual(
    result.table.rows.map((row) => row.cells.map((entry) => entry.value)),
    [
      ["A", "first", "one"],
      ["A", "second", "two"],
    ]
  );
});
