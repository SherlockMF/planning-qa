import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeRawTable } from "../lib/parse/canonicalTable.ts";

test("paragraph fallback conserves ignored source fragments in visual order", () => {
  const result = canonicalizeRawTable({
    schemaVersion: 2,
    page: 31,
    bbox: [0, 0, 200, 90],
    extractionMethod: "text",
    gridEvidence: {
      horizontalBoundaries: [0, 30, 60, 90],
      verticalBoundaries: [0, 100, 200],
      lineCoverage: 0.5,
    },
    cells: [
      {
        text: "完整",
        bbox: [0, 0, 100, 30],
        rowStart: 0,
        rowEnd: 1,
        colStart: 0,
        colEnd: 1,
        sourceOrder: [0],
      },
      {
        text: "段落",
        bbox: [0, 60, 100, 90],
        rowStart: 2,
        rowEnd: 3,
        colStart: 0,
        colEnd: 1,
        sourceOrder: [2],
      },
    ],
    ignoredFragments: [
      {
        text: "说明",
        bbox: [0, 30, 100, 60],
        reason: "outside_detected_cell",
      },
    ],
    warnings: [],
  });

  assert.deepEqual(result, {
    kind: "paragraph_fallback",
    page: 31,
    text: "完整 说明 段落",
    warning: "insufficient_table_structure",
  });
});
