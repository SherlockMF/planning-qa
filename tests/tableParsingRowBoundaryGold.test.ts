import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

test("table parsing gold: page 42 keeps row 15 service scale separate", async () => {
  const pdfPath = path.join(
    process.cwd(),
    ".data",
    "raw",
    "doc-1782564480335-lkrbih"
  );
  assert.ok(fs.existsSync(pdfPath), `missing regression PDF: ${pdfPath}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(pdfPath));
  const row = blocks.find(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 42 &&
      block.rowCells?.[1] === "15" &&
      block.rowCells?.[2] === "综合通信机房"
  );

  assert.ok(row, "missing page 42 row 15 for 综合通信机房");
  assert.equal(row.rowCells?.[8], "1000—5000户");
});
