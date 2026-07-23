import test from "node:test";
import assert from "node:assert/strict";

import type { CanonicalTable } from "../lib/parse/canonicalTable.ts";
import { decideCanonicalContinuation } from "../lib/parse/canonicalContinuation.ts";

function table(
  page: number,
  title: string | undefined,
  headers: string[][],
  boundaries: number[]
): CanonicalTable {
  return {
    logicalTableId: `p${page}`,
    title,
    pageStart: page,
    pageEnd: page,
    sourceBBox: [boundaries[0], 0, boundaries.at(-1)!, 100],
    columns: headers.map((headerPath, index) => ({
      index,
      name: headerPath.at(-1)!,
      headerPath,
    })),
    rows: [],
    physicalBoundaries: {
      horizontal: [0, 50, 100],
      vertical: boundaries,
    },
    warnings: [],
  };
}

test("merges an explicit continuation only when leaf columns are compatible", () => {
  const previous = table(
    16,
    "医疗卫生类设施配置指标表",
    [["设施"], ["建筑面积"], ["用地面积"]],
    [0, 100, 200, 300]
  );
  const continuation = table(
    17,
    "续表",
    [["设施"], ["建筑面积"], ["用地面积"]],
    [0, 101, 201, 300]
  );
  const wider = table(
    17,
    "续表",
    [["设施"], ["类别"], ["建筑面积"], ["用地面积"]],
    [0, 75, 150, 225, 300]
  );

  assert.equal(decideCanonicalContinuation(previous, continuation).merge, true);
  assert.deepEqual(decideCanonicalContinuation(previous, wider), {
    merge: false,
    reason: "leaf_column_count_mismatch",
  });
});

test("untitled continuation requires compatible boundaries and header similarity", () => {
  const previous = table(
    17,
    "用地分类标准",
    [["代码"], ["名称"], ["含义"]],
    [0, 80, 180, 300]
  );
  const compatible = table(
    18,
    undefined,
    [["代码"], ["名称"], ["含义"]],
    [0, 82, 178, 300]
  );
  const shifted = table(
    18,
    undefined,
    [["代码"], ["名称"], ["含义"]],
    [0, 120, 220, 300]
  );

  assert.equal(decideCanonicalContinuation(previous, compatible).merge, true);
  assert.deepEqual(decideCanonicalContinuation(previous, shifted), {
    merge: false,
    reason: "column_boundary_mismatch",
  });
});
