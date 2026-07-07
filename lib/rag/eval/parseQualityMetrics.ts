import type { Block } from "@/lib/types";
import { detectExtractionWarnings } from "../evidenceQuality.ts";

export interface ParseQualityMetrics {
  tableCount: number;
  rowCount: number;
  headerCellCount: number;
  emptyHeaderCellCount: number;
  emptyHeaderRatio: number;
  untitledTableCount: number;
  untitledTableRatio: number;
  lowFidelityCellCount: number;
  lowFidelityTableCount: number;
  lowFidelityWarnings: Record<string, number>;
}

export function summarizeParseQuality(blocks: Block[]): ParseQualityMetrics {
  const tables = blocks.filter((b) => b.type === "table" && b.table);
  let rowCount = 0;
  let headerCellCount = 0;
  let emptyHeaderCellCount = 0;
  let untitledTableCount = 0;
  let lowFidelityCellCount = 0;
  let lowFidelityTableCount = 0;
  const lowFidelityWarnings: Record<string, number> = {};

  for (const block of tables) {
    const table = block.table!;
    rowCount += table.rows.length;
    headerCellCount += table.headers.length;
    emptyHeaderCellCount += table.headers.filter((h) => h.trim() === "").length;
    if (!table.title?.trim()) untitledTableCount++;

    let tableHasLowFidelity = false;
    for (const cell of table.rows.flat()) {
      const warnings = detectExtractionWarnings({
        chunkType: "table_row",
        text: cell,
      });
      if (warnings.length === 0) continue;
      lowFidelityCellCount++;
      tableHasLowFidelity = true;
      for (const warning of warnings) {
        lowFidelityWarnings[warning] = (lowFidelityWarnings[warning] ?? 0) + 1;
      }
    }
    if (tableHasLowFidelity) lowFidelityTableCount++;
  }

  return {
    tableCount: tables.length,
    rowCount,
    headerCellCount,
    emptyHeaderCellCount,
    emptyHeaderRatio: ratio(emptyHeaderCellCount, headerCellCount),
    untitledTableCount,
    untitledTableRatio: ratio(untitledTableCount, tables.length),
    lowFidelityCellCount,
    lowFidelityTableCount,
    lowFidelityWarnings,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}
