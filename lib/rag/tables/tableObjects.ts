import type { Block } from "../../types";
import type {
  StructuredTableObject,
  StructuredTableRowObject,
} from "../objects";
import {
  pageSpanOf,
  sectionPathText,
  stableObjectId,
} from "../objects.ts";
import type { SectionTree } from "../sectionTree";
import { rowKeyOf } from "../tableModel.ts";
import { classifyTable } from "./classifyTable.ts";
import { flattenHeaders } from "./flattenHeaders.ts";
import { mergeContinuationTables } from "./mergeTables.ts";
import { normalizeFields } from "./normalizeCells.ts";

export function buildStructuredTableObjects(
  docId: string,
  blocks: Block[],
  sectionTree?: SectionTree
): StructuredTableObject[] {
  return mergeContinuationTables(blocks, sectionTree).map((merged, tableIndex) => {
    const headers = flattenHeaders(merged.model.headers, merged.model.headerPaths);
    const classification = classifyTable({
      title: merged.model.title,
      headers: merged.model.headers,
      rows: merged.model.rows,
      sectionPath: merged.sectionPath,
    });
    const tableNo = extractTableNo(merged.model.title);
    const tableTitle = extractTableTitle(merged.model.title);
    const tableObjectId = stableObjectId(docId, "structured_table", [
      merged.model.tableId,
      tableNo,
      tableTitle,
      tableIndex,
    ]);

    const rowObjects: StructuredTableRowObject[] = merged.model.rows.map(
      (row, rowIndex) => {
        const fields: Record<string, string> = {};
        headers.forEach((header, columnIndex) => {
          const value = (row[columnIndex] ?? "").trim();
          if (value) fields[header.name] = value;
        });
        const rowKey = rowKeyOf(row, headers.map((h) => h.name));
        return {
          id: stableObjectId(docId, "structured_table_row", [
            tableObjectId,
            rowIndex,
            rowKey,
          ]),
          docId,
          objectType: "structured_table_row",
          title: rowKey || tableTitle || tableNo,
          content: renderRowContent(fields),
          sectionPath: merged.sectionPath,
          sectionPathText: sectionPathText(merged.sectionPath),
          sourcePageStart: merged.pageStart,
          sourcePageEnd: merged.pageEnd,
          sourcePages: pageSpanOf(merged.pageStart, merged.pageEnd),
          sourceBlockIds: merged.sourceBlockIds,
          sourceTableId: merged.model.tableId,
          sourceRowIndex: rowIndex,
          parentObjectId: tableObjectId,
          tableObjectId,
          tableNo,
          tableTitle,
          tableType: classification.tableType,
          rowIndex,
          rowKey,
          fields,
          normalizedFields: normalizeFields(fields),
          keywords: [rowKey, tableNo, tableTitle].filter(Boolean) as string[],
          aliases: [rowKey].filter(Boolean) as string[],
          confidence: classification.confidence,
          warnings:
            classification.confidence < 0.55
              ? ["low_confidence_table_row"]
              : undefined,
          raw: row,
        };
      }
    );

    return {
      id: tableObjectId,
      docId,
      objectType: "structured_table",
      title: [tableNo, tableTitle].filter(Boolean).join(" ") || merged.model.title,
      content: [merged.model.title, merged.model.headers.join(" | ")]
        .filter(Boolean)
        .join("\n"),
      sectionPath: merged.sectionPath,
      sectionPathText: sectionPathText(merged.sectionPath),
      sourcePageStart: merged.pageStart,
      sourcePageEnd: merged.pageEnd,
      sourcePages: merged.pageSpan,
      sourceBlockIds: merged.sourceBlockIds,
      sourceTableId: merged.model.tableId,
      childObjectIds: rowObjects.map((row) => row.id),
      tableNo,
      tableTitle,
      tableType: classification.tableType,
      headers,
      normalizedHeaders: headers.map((h) => h.key),
      rows: rowObjects,
      pageSpan: merged.pageSpan,
      isContinuationMerged: merged.isContinuationMerged,
      keywords: [tableNo, tableTitle, classification.tableType].filter(Boolean) as string[],
      aliases: [tableNo, tableTitle].filter(Boolean) as string[],
      confidence: classification.confidence,
      warnings: merged.continuationWarnings.length
        ? merged.continuationWarnings
        : classification.confidence < 0.55
          ? ["low_confidence_table_classification"]
          : undefined,
      raw: {
        tableId: merged.model.tableId,
        headers: merged.model.headers,
        rowCount: merged.model.rows.length,
        matchedSignals: classification.matchedSignals,
      },
    };
  });
}

const TABLE_NO_RE =
  /^\s*(?:续表|表|附表)\s*([A-Za-z]?\d+(?:[—\-－.．][A-Za-z\d]+)*)/;

function extractTableNo(title?: string): string | undefined {
  return title?.match(TABLE_NO_RE)?.[1];
}

function extractTableTitle(title?: string): string | undefined {
  if (!title) return undefined;
  const no = title.match(TABLE_NO_RE)?.[0];
  return no ? title.slice(no.length).trim() || title.trim() : title.trim();
}

function renderRowContent(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}：${value}`)
    .join("。");
}
