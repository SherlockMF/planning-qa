import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";

interface ParagraphGold {
  id: string;
  documentId: string;
  page: number;
  expectation: "paragraph";
  requiredText: string[];
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "tests", "fixtures", "table-parsing", "gold-v1.json"),
    "utf8"
  )
) as { cases: ParagraphGold[] };

for (const gold of fixture.cases) {
  test(`table parsing gold: ${gold.id}`, async () => {
    const pdfPath = path.join(process.cwd(), ".data", "raw", gold.documentId);
    assert.ok(fs.existsSync(pdfPath), `missing regression PDF: ${pdfPath}`);

    const blocks = await extractBlocksWithTables(fs.readFileSync(pdfPath));
    const pageBlocks = blocks.filter((block) =>
      block.pageStart <= gold.page && block.pageEnd >= gold.page
    );
    assert.equal(
      pageBlocks.some((block) => block.type === "table"),
      false,
      `page ${gold.page} must not publish a pseudo-table`
    );
    const text = pageBlocks
      .filter((block) => block.type === "paragraph" || block.type === "list_item")
      .map((block) => block.normalizedText)
      .join(" ");
    for (const required of gold.requiredText) {
      assert.match(text, new RegExp(required));
    }
  });
}
