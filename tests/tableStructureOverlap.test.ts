import test from "node:test";
import assert from "node:assert/strict";

import { parseRawTableV2 } from "../lib/parse/tableStructure.ts";

test("rejects two source cells occupying the same physical slot", () => {
  const value = {
    schemaVersion: 2,
    page: 14,
    bbox: [10, 20, 210, 120],
    extractionMethod: "lines",
    gridEvidence: {
      horizontalBoundaries: [20, 50, 80],
      verticalBoundaries: [10, 80, 150],
      lineCoverage: 1,
    },
    cells: [
      {
        text: "A",
        bbox: [10, 20, 80, 50],
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
        sourceOrder: [0],
      },
      {
        text: "B",
        bbox: [10, 20, 80, 50],
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
        sourceOrder: [1],
      },
    ],
    ignoredFragments: [],
    warnings: [],
  };

  assert.throws(() => parseRawTableV2(value), /overlapping_raw_table_cells/);
});
