import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

const TARGET_PDF = path.join(
  process.cwd(),
  ".data",
  "raw",
  "doc-1782564480335-lkrbih"
);

test("keeps reading order inside the page 18 community clinic requirement cell", async () => {
  assert.ok(fs.existsSync(TARGET_PDF), `missing regression PDF: ${TARGET_PDF}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(TARGET_PDF));
  const target = blocks.find(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 18 &&
      block.rowCells?.[0] === "指标使用说明" &&
      block.rowCells?.[1] === "社区卫生服务站"
  );

  assert.ok(target?.rowCells, "expected page 18 社区卫生服务站指标使用说明 row");
  const cell = target.rowCells[2] ?? "";

  for (const expected of [
    "15分钟步行范围内",
    "1个社区卫生服务站",
    "社区卫生服务中心的可不再设置",
    "85%",
    "85%。3.具体科室",
  ]) {
    assert.match(cell, new RegExp(expected));
  }

  for (const badText of [
    "社区卫生1服5务中心",
    "2 1 ,15",
    "2. 、 、85%具",
  ]) {
    assert.doesNotMatch(cell, new RegExp(badText));
  }
});

test("keeps numeric units together inside the page 12 education indicator table", async () => {
  assert.ok(fs.existsSync(TARGET_PDF), `missing regression PDF: ${TARGET_PDF}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(TARGET_PDF));
  const target = blocks.find(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 12 &&
      block.rowCells?.[2] === "托幼" &&
      block.rowCells?.[4] === "8"
  );

  assert.ok(target?.rowCells, "expected page 12 托幼 8班 row");
  assert.equal(target.rowCells[3], "6岁以下");
  assert.equal(target.rowCells[17], "0.96万人");

  const next = blocks.find(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 12 &&
      block.rowCells?.[2] === "托幼" &&
      block.rowCells?.[4] === "12"
  );
  assert.equal(next?.rowCells?.[17], "1.44万人");

  for (const badText of ["0万.9人6", "1万.4人4", "6-岁12"]) {
    assert.doesNotMatch(target.normalizedText, new RegExp(badText));
  }
});
