import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const PDF = path.join(
  process.cwd(),
  ".data",
  "raw",
  "doc-1782564480335-lkrbih"
);

test("python extractor emits versioned cell geometry for line tables", () => {
  const result = spawnSync("py", ["scripts/extract_tables.py", PDF], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  const tables = JSON.parse(result.stdout);
  const table = tables.find(
    (candidate: { page?: number; strategy?: string }) =>
      candidate.page === 7 && candidate.strategy === "lines"
  );

  assert.equal(table.schemaVersion, 2);
  assert.equal(table.extractionMethod, "lines");
  assert.ok(table.cells.length > 0);
  assert.ok(table.cells.some(
    (cell: { colStart: number; colEnd: number }) =>
      cell.colEnd - cell.colStart > 1
  ));
  assert.ok(table.gridEvidence.verticalBoundaries.length > 2);
  assert.ok(Array.isArray(table.ignoredFragments));
});
