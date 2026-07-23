import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { parseRawTableV2 } from "../lib/parse/tableStructure.ts";

const PDF = path.join(
  process.cwd(),
  ".data",
  "raw",
  "doc-1782564480335-lkrbih"
);

test("every versioned python table satisfies the TypeScript contract", () => {
  const result = spawnSync("py", ["scripts/extract_tables.py", PDF], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  assert.equal(result.status, 0, result.stderr);
  const tables = JSON.parse(result.stdout).filter(
    (candidate: { schemaVersion?: number }) => candidate.schemaVersion === 2
  );
  assert.ok(tables.length > 0);
  for (const table of tables) parseRawTableV2(table);
});
