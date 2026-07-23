import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

test("table parsing gold: page 14 preserves six independent merged-cell rows", async () => {
  const pdfPath = path.join(
    process.cwd(),
    ".data",
    "raw",
    "doc-1782564681224-w8e22z"
  );
  assert.ok(fs.existsSync(pdfPath), `missing regression PDF: ${pdfPath}`);

  const blocks = await extractBlocksWithTables(fs.readFileSync(pdfPath));
  const table = blocks.find(
    (block) =>
      block.type === "table" &&
      block.pageStart === 14 &&
      block.table?.rows.some((row) => row[0] === "更新维护要求")
  )?.table;
  assert.ok(table, "missing page 14 implementation-requirements table");
  assert.deepEqual(table.headers, [
    "高质量、精细化引导要求",
    "管控分区、建筑风貌、色彩、第五立面、街道空间绿色空间等。智慧城市、绿色建筑、综合节能等。",
  ]);
  assert.deepEqual(table.rows.slice(2), [
    ["土地整理及供应", "土地整理、土地供应方式、征地拆迁安置等内容"],
    ["实施时序安排", "实施时序、项目清单等"],
    ["实施建议", "实施举措、建议、应对方案等"],
    ["综合效益评估", "社会、经济、生态、可持续发展等方面的贡献价值"],
    ["实施资金测算", "成本测算、收益测算等"],
    ["经济可行性分析", "项目损益、资金来源、平衡方案等"],
  ]);
});
