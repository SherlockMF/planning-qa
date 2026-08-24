import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

// de37669 起抽表层保留单元格内视觉行换行（复杂规模分档解析依赖行分隔，禁止无缝拼接）。
// 本 gold 锁「分类码/名称内容 + 行级页码归属」，与格内换行无关，故拍平空白后比对。
const flat = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, "");

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
        flat(block.rowCells?.[1]) === item.code &&
        flat(block.rowCells?.[2]) === item.name
    );
    assert.ok(row, `missing classification row ${item.code} ${item.name}`);
    assert.equal(row.pageStart, item.page);
    assert.equal(row.pageEnd, item.page);
  }
});
