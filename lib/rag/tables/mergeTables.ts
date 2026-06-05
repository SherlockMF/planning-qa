import type { Block, TableModel } from "../../types";
import { toMarkdown } from "../tableModel.ts";
import { blockIdAt, type SectionTree } from "../sectionTree.ts";
import { detectContinuation } from "./detectContinuation.ts";

export interface MergedTable {
  model: TableModel;
  pageStart: number;
  pageEnd: number;
  pageSpan: number[];
  sourceBlockIds: string[];
  isContinuationMerged: boolean;
  continuationWarnings: string[];
  sectionPath: string[];
}

export function mergeContinuationTables(
  blocks: Block[],
  sectionTree?: SectionTree
): MergedTable[] {
  const tables = blocks
    .map((block, index) => ({ block, index }))
    .filter((item) => item.block.type === "table" && item.block.table);

  const merged: MergedTable[] = [];
  for (const item of tables) {
    const model = item.block.table!;
    const current: MergedTable = {
      model,
      pageStart: item.block.pageStart,
      pageEnd: item.block.pageEnd,
      pageSpan: pageSpan(item.block.pageStart, item.block.pageEnd),
      sourceBlockIds: [blockIdAt(item.index)],
      isContinuationMerged: false,
      continuationWarnings: [],
      sectionPath: sectionTree?.blockSectionMap[blockIdAt(item.index)] ?? [],
    };

    const previous = merged[merged.length - 1];
    if (previous) {
      const decision = detectContinuation(
        { model: previous.model, pageEnd: previous.pageEnd },
        { model: current.model, pageStart: current.pageStart }
      );
      if (decision.isContinuation) {
        previous.model = {
          ...previous.model,
          rows: [...previous.model.rows, ...dropRepeatedHeaderRows(previous.model, current.model)],
          markdown: toMarkdown(
            previous.model.headers,
            [...previous.model.rows, ...dropRepeatedHeaderRows(previous.model, current.model)]
          ),
        };
        previous.pageEnd = Math.max(previous.pageEnd, current.pageEnd);
        previous.pageSpan = pageSpan(previous.pageStart, previous.pageEnd);
        previous.sourceBlockIds.push(...current.sourceBlockIds);
        previous.isContinuationMerged = true;
        previous.continuationWarnings.push(...decision.warnings);
        continue;
      }
    }

    merged.push(current);
  }
  return merged;
}

function dropRepeatedHeaderRows(previous: TableModel, current: TableModel): string[][] {
  return current.rows.filter((row) => {
    const joined = row.map((cell) => cell.trim()).join("|");
    const header = previous.headers.map((h) => h.trim()).join("|");
    return joined !== header;
  });
}

function pageSpan(start: number, end: number): number[] {
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}
