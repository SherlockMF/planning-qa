import test from "node:test";
import assert from "node:assert/strict";

import { tablesToBlocks } from "../lib/parse/tablesSidecar.ts";

test("sidecar treats V2 cells as truth when no legacy row matrix is present", () => {
  const blocks = tablesToBlocks([
    {
      schemaVersion: 2,
      page: 1,
      bbox: [0, 0, 200, 60],
      title: "指标表",
      strategy: "lines",
      extractionMethod: "lines",
      gridEvidence: {
        horizontalBoundaries: [0, 30, 60],
        verticalBoundaries: [0, 100, 200],
        lineCoverage: 1,
      },
      cells: [
        {
          text: "设施",
          bbox: [0, 0, 100, 30],
          rowStart: 0,
          rowEnd: 1,
          colStart: 0,
          colEnd: 1,
          sourceOrder: [0],
        },
        {
          text: "面积",
          bbox: [100, 0, 200, 30],
          rowStart: 0,
          rowEnd: 1,
          colStart: 1,
          colEnd: 2,
          sourceOrder: [1],
        },
        {
          text: "卫生站",
          bbox: [0, 30, 100, 60],
          rowStart: 1,
          rowEnd: 2,
          colStart: 0,
          colEnd: 1,
          sourceOrder: [2],
        },
        {
          text: "350",
          bbox: [100, 30, 200, 60],
          rowStart: 1,
          rowEnd: 2,
          colStart: 1,
          colEnd: 2,
          sourceOrder: [3],
        },
      ],
      ignoredFragments: [],
      warnings: [],
      fill: 1,
      scanned: false,
    },
  ] as any);

  const table = blocks.find((block) => block.type === "table");
  assert.deepEqual(table?.table?.headers, ["设施", "面积"]);
  assert.deepEqual(table?.table?.rows, [["卫生站", "350"]]);
});
