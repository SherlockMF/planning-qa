import test from "node:test";
import assert from "node:assert/strict";

import { tablesToBlocks } from "../lib/parse/tablesSidecar.ts";

test("sidecar builds TableModel from explicit V2 cell spans", () => {
  const blocks = tablesToBlocks([
    {
      schemaVersion: 2,
      page: 1,
      bbox: [0, 0, 300, 90],
      title: "指标表",
      rows: [
        ["设施名称", "规模性指标", null],
        [null, "建筑面积", "用地面积"],
        ["卫生站", "350", "1000"],
      ],
      strategy: "lines",
      extractionMethod: "lines",
      gridEvidence: {
        horizontalBoundaries: [0, 30, 60, 90],
        verticalBoundaries: [0, 100, 200, 300],
        lineCoverage: 1,
      },
      cells: [
        {
          text: "设施名称",
          bbox: [0, 0, 100, 60],
          rowStart: 0,
          rowEnd: 2,
          colStart: 0,
          colEnd: 1,
          sourceOrder: [0],
        },
        {
          text: "规模性指标",
          bbox: [100, 0, 300, 30],
          rowStart: 0,
          rowEnd: 1,
          colStart: 1,
          colEnd: 3,
          sourceOrder: [1],
        },
        {
          text: "建筑面积",
          bbox: [100, 30, 200, 60],
          rowStart: 1,
          rowEnd: 2,
          colStart: 1,
          colEnd: 2,
          sourceOrder: [2],
        },
        {
          text: "用地面积",
          bbox: [200, 30, 300, 60],
          rowStart: 1,
          rowEnd: 2,
          colStart: 2,
          colEnd: 3,
          sourceOrder: [3],
        },
        {
          text: "卫生站",
          bbox: [0, 60, 100, 90],
          rowStart: 2,
          rowEnd: 3,
          colStart: 0,
          colEnd: 1,
          sourceOrder: [4],
        },
        {
          text: "350",
          bbox: [100, 60, 200, 90],
          rowStart: 2,
          rowEnd: 3,
          colStart: 1,
          colEnd: 2,
          sourceOrder: [5],
        },
        {
          text: "1000",
          bbox: [200, 60, 300, 90],
          rowStart: 2,
          rowEnd: 3,
          colStart: 2,
          colEnd: 3,
          sourceOrder: [6],
        },
      ],
      ignoredFragments: [],
      warnings: [],
      fill: 1,
      scanned: false,
    },
  ] as any);

  const table = blocks.find((block) => block.type === "table");
  assert.deepEqual(table?.table?.headerPaths, [
    ["设施名称"],
    ["规模性指标", "建筑面积"],
    ["规模性指标", "用地面积"],
  ]);
  assert.deepEqual(table?.table?.rows, [["卫生站", "350", "1000"]]);
});
