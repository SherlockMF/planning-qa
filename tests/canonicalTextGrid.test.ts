import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeRawTable } from "../lib/parse/canonicalTable.ts";
import type { RawTableV2 } from "../lib/parse/tableStructure.ts";

test("text tables collapse transient glyph edges into stable logical columns", () => {
  const raw: RawTableV2 = {
    schemaVersion: 2,
    page: 14,
    bbox: [0, 0, 100, 30],
    extractionMethod: "text",
    gridEvidence: {
      horizontalBoundaries: [0, 10, 20, 30],
      verticalBoundaries: [0, 8, 38, 40, 44, 72, 92, 100],
      lineCoverage: 0.5,
    },
    cells: [
      cell("要求", 0, 1, 0, 2, [0, 0, 40, 10]),
      cell("内容", 0, 1, 2, 7, [40, 0, 100, 10]),
      cell("", 1, 2, 0, 1, [0, 10, 8, 20]),
      cell("更新维护", 1, 2, 1, 2, [8, 10, 40, 20]),
      cell("说明", 1, 2, 2, 6, [40, 10, 92, 20]),
      cell("", 1, 2, 6, 7, [92, 10, 100, 20]),
      cell("土地供应", 2, 3, 0, 2, [0, 20, 40, 30]),
      cell("供应方式", 2, 3, 2, 7, [40, 20, 100, 30]),
    ],
    ignoredFragments: [],
    warnings: [],
  };

  const result = canonicalizeRawTable(raw);
  assert.equal(result.kind, "table");
  if (result.kind !== "table") return;
  assert.deepEqual(result.table.physicalBoundaries.vertical, [0, 40, 100]);
  assert.deepEqual(
    result.table.rows.map((row) => row.cells.map((entry) => entry.value)),
    [
      ["更新维护", "说明"],
      ["土地供应", "供应方式"],
    ]
  );
});

function cell(
  text: string,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
  bbox: [number, number, number, number]
): RawTableV2["cells"][number] {
  return {
    text,
    bbox,
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    sourceOrder: [],
  };
}
