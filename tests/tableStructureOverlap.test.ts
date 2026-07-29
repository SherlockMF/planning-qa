import test from "node:test";
import assert from "node:assert/strict";

import { canonicalTablesToBlocks } from "../lib/parse/canonicalBlocks.ts";
import { parseRawTableV2 } from "../lib/parse/tableStructure.ts";

test("rejects two source cells occupying the same physical slot", () => {
  const value = overlappingRawTableFixture();

  assert.throws(() => parseRawTableV2(value), /overlapping_raw_table_cells/);
});

test("canonicalTablesToBlocks degrades overlapping tables instead of failing the document", () => {
  const blocks = canonicalTablesToBlocks([
    overlappingRawTableFixture(),
    {
      schemaVersion: 2,
      page: 15,
      bbox: [10, 20, 210, 120],
      extractionMethod: "lines",
      gridEvidence: {
        horizontalBoundaries: [20, 50, 80],
        verticalBoundaries: [10, 80, 150],
        lineCoverage: 1,
      },
      cells: [
        {
          text: "设施名称",
          bbox: [10, 20, 80, 50],
          rowStart: 0,
          rowEnd: 1,
          colStart: 0,
          colEnd: 1,
          sourceOrder: [0],
        },
        {
          text: "社区卫生服务中心",
          bbox: [80, 20, 150, 50],
          rowStart: 0,
          rowEnd: 1,
          colStart: 1,
          colEnd: 2,
          sourceOrder: [1],
        },
      ],
      ignoredFragments: [],
      warnings: [],
    },
  ]);

  assert.ok(blocks.some((block) => block.type === "paragraph" && /A|B/.test(block.normalizedText)));
  assert.ok(blocks.some((block) => block.type === "table" || block.type === "table_row"));
});

function overlappingRawTableFixture() {
  return {
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
}
