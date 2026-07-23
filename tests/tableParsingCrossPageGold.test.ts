import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

test("table parsing gold: classification continuation rows keep source pages 17 and 18", async () => {
  const pdfPath = path.join(
    process.cwd(),
    ".data",
    "raw",
    "doc-1782580032729-x4hwnt"
  );
  assert.ok(fs.existsSync(pdfPath), `missing regression PDF: ${pdfPath}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(pdfPath));
  const expected = [
    { code: "U11", name: "供水用地", page: 17 },
    { code: "U12", name: "供电用地", page: 18 },
    { code: "U13", name: "供燃气用地", page: 18 },
    { code: "U14", name: "供热用地", page: 18 },
    { code: "U15", name: "电信用地", page: 18 },
    { code: "U16", name: "广播电视信号传输设施用地", page: 18 },
  ];

  for (const item of expected) {
    const row = blocks.find(
      (block) =>
        block.type === "table_row" &&
        block.rowCells?.[1] === item.code &&
        block.rowCells?.[2] === item.name
    );
    assert.ok(row, `missing classification row ${item.code} ${item.name}`);
    assert.equal(row.pageStart, item.page);
    assert.equal(row.pageEnd, item.page);
  }
});
