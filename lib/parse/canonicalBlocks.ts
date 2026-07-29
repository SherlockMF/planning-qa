import type { Block } from "../types.ts";
import {
  buildTableModelFromCanonical,
  canonicalizeRawTable,
  type CanonicalTable,
} from "./canonicalTable.ts";
import { decideCanonicalContinuation } from "./canonicalContinuation.ts";
import { parseRawTableV2, type RawTableV2 } from "./tableStructure.ts";

export function canonicalTablesToBlocks(values: unknown[]): Block[] {
  // 第一性原理：单表结构失败不得拖垮整篇入库。
  // 校验仍由 parseRawTableV2 严格执行；此处按表隔离，坏表降级为段落。
  const rawTables: RawTableV2[] = [];
  const paragraphs: Block[] = [];

  for (const value of values) {
    try {
      rawTables.push(parseRawTableV2(value));
    } catch (error) {
      const degraded = degradeUnparseableRawTable(value, error);
      if (degraded) paragraphs.push(degraded);
    }
  }
  rawTables.sort((a, b) => a.page - b.page);

  const tables: CanonicalTable[] = [];

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

function degradeUnparseableRawTable(value: unknown, error: unknown): Block | null {
  if (!isRecord(value)) return null;
  const page = Number(value.page);
  if (!Number.isInteger(page) || page < 1) return null;
  const reason = error instanceof Error ? error.message : String(error);
  const cellTexts = Array.isArray(value.cells)
    ? value.cells
        .map((cell) => (isRecord(cell) && typeof cell.text === "string" ? cell.text.trim() : ""))
        .filter(Boolean)
    : [];
  const text =
    cellTexts.join(" ").trim() ||
    (typeof value.title === "string" ? value.title.trim() : "") ||
    `表格结构降级（${reason}）`;
  const bbox =
    Array.isArray(value.bbox) &&
    value.bbox.length === 4 &&
    value.bbox.every((entry) => Number.isFinite(Number(entry)))
      ? (value.bbox.map(Number) as [number, number, number, number])
      : undefined;
  return {
    type: "paragraph",
    pageStart: page,
    pageEnd: page,
    bbox,
    rawText: text,
    normalizedText: text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
