import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";
import { buildStructuredTableObjects } from "../lib/rag/tables/tableObjects.ts";

// de37669 起抽表层保留单元格内视觉行换行（复杂规模分档解析依赖行分隔，禁止无缝拼接）。
// 本文件 gold 锁「内容 + 阅读顺序 + 列对齐」，与格内换行无关，文本比对前拍平空白。
const flat = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, "");

// 表头单元格同样保留换行，flattenHeaders 会把换行转成空格（如「用地面积 (平方米)」），
// 故按拍平后的表头名取字段、返回拍平后的值。
function fieldOf(
  row: { fields: Record<string, string> },
  name: string
): string {
  const hit = Object.entries(row.fields).find(([key]) => flat(key) === name);
  return flat(hit?.[1]);
}

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
      flat(block.rowCells?.[0]) === "指标使用说明" &&
      flat(block.rowCells?.[1]) === "社区卫生服务站"
  );

  assert.ok(target?.rowCells, "expected page 18 社区卫生服务站指标使用说明 row");
  const cell = target.rowCells[2] ?? "";

  for (const expected of [
    "15分钟步行范围内",
    "1个社区卫生服务站",
    "社区卫生服务中心的可不再设置",
    "85%",
    // de37669 后清洗逐行进行，跨行的孤儿编号（句尾「3.。」）不再回填进句子；
    // 只锁内容与顺序，不锁该视觉残迹。
    "85%。具体科室按照主管部门要求设置",
  ]) {
    assert.match(flat(cell), new RegExp(expected));
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
  assert.equal(flat(target.rowCells[3]), "6岁以下");
  assert.equal(flat(target.rowCells[17]), "0.96万人");

  const next = blocks.find(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 12 &&
      block.rowCells?.[2] === "托幼" &&
      block.rowCells?.[4] === "12"
  );
  assert.equal(flat(next?.rowCells?.[17]), "1.44万人");

  for (const badText of ["0万.9人6", "1万.4人4", "6-岁12"]) {
    assert.doesNotMatch(target.normalizedText, new RegExp(badText));
  }
});

test("keeps page 17 community health center service-scale column aligned", async () => {
  assert.ok(fs.existsSync(TARGET_PDF), `missing regression PDF: ${TARGET_PDF}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(TARGET_PDF));
  const table = blocks.find(
    (block) =>
      block.type === "table" &&
      block.pageStart === 17 &&
      block.table?.title == null &&
      block.table?.headers.includes("服务规模")
  );

  assert.ok(table?.table, "expected page 17 continuation indicator table");
  assert.equal(table.table.headers.length, 10);
  assert.deepEqual(table.table.headers.slice(0, 5), [
    "层级",
    "编号",
    "设施名称",
    "",
    "服务内容",
  ]);

  const rows = blocks.filter(
    (block) =>
      block.type === "table_row" &&
      block.pageStart === 17 &&
      flat(block.rowCells?.[2]) === "社区卫生服务中心"
  );

  assert.equal(rows.length, 3);
  assert.equal(rows[0].rowCells?.[3], "A类");
  assert.equal(rows[0].rowCells?.[8], "75");
  assert.equal(flat(rows[0].rowCells?.[9]), "每个街道1处,大于7万人街道适用");
  assert.equal(flat(rows[1].rowCells?.[9]), "每个街道1处,5-7万人(含)街道适用");
  assert.equal(flat(rows[2].rowCells?.[9]), "每个街道1处,小于5万人(含)街道适用");
  assert.notEqual(rows[0].rowCells?.[9], "75");
  const subtotal = blocks.find(
    (block) =>
      block.type === "table_row"
      && block.pageStart === 17
      && block.rowCells?.[0] === "小计"
  );
  assert.equal(subtotal?.rowCells?.[2], "");
});

test("does not merge page 17 wider continuation rows into page 16 narrower headers", async () => {
  assert.ok(fs.existsSync(TARGET_PDF), `missing regression PDF: ${TARGET_PDF}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(TARGET_PDF));
  const tables = buildStructuredTableObjects("doc-1782564480335-lkrbih", blocks);
  const target = tables.find(
    (table) =>
      table.sourcePageStart === 17 &&
      table.headers.length === 10 &&
      table.rows.some((row) => flat(row.fields["设施名称"]) === "社区卫生服务中心")
  );

  assert.ok(target, "expected page 17 table to stay separate with 10 columns");
  const row = target.rows.find(
    (item) =>
      flat(item.fields["设施名称"]) === "社区卫生服务中心" &&
      item.fields["列4"] === "A类"
  );

  assert.ok(row, "expected A类 community health center row");
  assert.equal(fieldOf(row, "服务规模"), "每个街道1处,大于7万人街道适用");
  assert.equal(fieldOf(row, "用地面积(平方米)"), "75");
});
