import type { Block } from "../types.ts";
import {
  buildTableModelFromCanonical,
  canonicalizeRawTable,
  type CanonicalTable,
} from "./canonicalTable.ts";
import { decideCanonicalContinuation } from "./canonicalContinuation.ts";
import { parseRawTableV2, type RawTableV2 } from "./tableStructure.ts";

export function canonicalTablesToBlocks(values: unknown[]): Block[] {
  const rawTables = values.map(parseRawTableV2).sort((a, b) => a.page - b.page);
  const tables: CanonicalTable[] = [];
  const paragraphs: Block[] = [];

  for (const raw of rawTables) {
    const result = canonicalizeRawTable(raw);
    if (result.kind === "paragraph_fallback") {
      paragraphs.push({
        type: "paragraph",
        pageStart: raw.page,
        pageEnd: raw.page,
        bbox: raw.bbox,
        rawText: result.text,
        normalizedText: result.text,
      });
      continue;
    }
    const previous = tables.at(-1);
    if (previous && decideCanonicalContinuation(previous, result.table).merge) {
      previous.pageEnd = result.table.pageEnd;
      previous.rows.push(...result.table.rows);
      previous.warnings.push("continuation_merged");
      continue;
    }
    tables.push(result.table);
  }

  const blocks = [...paragraphs];
  for (const table of tables) blocks.push(...canonicalTableToBlocks(table));
  return blocks.sort((left, right) =>
    left.pageStart - right.pageStart || blockLane(left) - blockLane(right)
  );
}

function canonicalTableToBlocks(table: CanonicalTable): Block[] {
  const model = buildTableModelFromCanonical(table);
  const blocks: Block[] = [{
    type: "table",
    pageStart: table.pageStart,
    pageEnd: table.pageEnd,
    bbox: table.sourceBBox,
    rawText: model.markdown,
    normalizedText: [model.title, model.markdown].filter(Boolean).join("\n"),
    table: model,
  }];
  for (const row of table.rows) {
    const cells = row.cells.map((cell) => cell.value);
    blocks.push({
      type: "table_row",
      pageStart: row.sourcePage,
      pageEnd: row.sourcePage,
      rawText: cells.join("\t"),
      normalizedText: cells.filter(Boolean).join(" "),
      rowCells: cells,
    });
  }
  return blocks;
}

function blockLane(block: Block): number {
  return block.type === "paragraph" ? 0 : block.type === "table" ? 1 : 2;
}

export function isRawTableV2(value: unknown): value is RawTableV2 {
  return typeof value === "object"
    && value !== null
    && "schemaVersion" in value
    && value.schemaVersion === 2;
}
