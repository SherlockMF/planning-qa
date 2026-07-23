import test from "node:test";
import assert from "node:assert/strict";

import { parseRawTableV2 } from "../lib/parse/tableStructure.ts";

test("accepts a versioned table cell spanning two physical columns", () => {
  const raw = parseRawTableV2({
    schemaVersion: 2,
    page: 14,
    bbox: [10, 20, 210, 120],
    title: "指标表",
    extractionMethod: "lines",
    gridEvidence: {
      horizontalBoundaries: [20, 50, 80, 120],
      verticalBoundaries: [10, 80, 150, 210],
      lineCoverage: 1,
    },
    cells: [
      {
        text: "规模性指标",
        bbox: [80, 20, 210, 50],
        rowStart: 0,
        rowEnd: 1,
        colStart: 1,
        colEnd: 3,
        sourceOrder: [0],
      },
    ],
    ignoredFragments: [],
    warnings: [],
  });

  assert.equal(raw.schemaVersion, 2);
  assert.equal(raw.cells[0].colEnd - raw.cells[0].colStart, 2);
});
