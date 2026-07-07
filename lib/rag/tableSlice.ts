// ============================================================================
// TableSlice 截取 + 列选择（P0）
// ----------------------------------------------------------------------------
// 检索命中若干 table_row/code/requirement/deliverable chunk 后，根据
// tableId + rowId 回查 RagTable，截取相关行（按原表 rowIndex 排序）与相关列，
// 生成 TableSlice。最终展示只来自 RagTable.rows[].cells，不用 chunk.content。
// ============================================================================

import type { RagTable, TableColumn, TableRow, TableSlice } from "@/lib/types";
import { getRagTable } from "@/lib/db/ragTables";
import { canonicalize } from "./ragTable";

export interface GetTableSliceParams {
  tableId: string;
  /** 文档 id：tableId 仅文档内唯一，必须配合 docId 回查正确的表。 */
  docId?: string;
  rowIds: string[];
  query?: string;
  maxRows?: number;
  columnMode?: "relevant" | "all";
}

/** 用户要求看「完整表格 / 全部字段 / 原表」的意图。 */
const WANT_ALL_COLUMNS_RE = /完整表格|全部字段|所有字段|整张表|原表|全表|完整字段/;

/**
 * 回查 RagTable 并按 rowIds 截取切片。
 *  - 行：保持原表 rowIndex 顺序（不按检索分数）；
 *  - 列：默认按 query + tableType 选相关列，columnMode="all" 展示全列；
 *  - 页码：覆盖被选中行的真实范围。
 * 表不存在或无命中行时返回 null（调用方跳过）。
 */
export async function getTableSlice(
  params: GetTableSliceParams
): Promise<TableSlice | null> {
  const { tableId, docId, rowIds, query, maxRows = 20, columnMode = "relevant" } = params;
  const table = await getRagTable(tableId, docId);
  if (!table) return null;

  const idSet = new Set(rowIds);
  // 按原表行序筛选（filter 保序，天然按 rowIndex 升序）
  let selected = table.rows.filter((r) => idSet.has(r.rowId));
  if (selected.length === 0) return null;
  if (selected.length > maxRows) selected = selected.slice(0, maxRows);

  const wantAll =
    columnMode === "all" || (query ? WANT_ALL_COLUMNS_RE.test(query) : false);
  const columns = wantAll
    ? table.columns
    : selectRelevantColumns({ query: query ?? "", table, selectedRows: selected });

  const pageStart = Math.min(...selected.map((r) => r.pageStart || Infinity));
  const pageEnd = Math.max(...selected.map((r) => r.pageEnd || 0));
  const citationText = buildCitationText(table, pageStart, pageEnd);

  return {
    type: "table_slice",
    tableId: table.tableId,
    tableTitle: table.tableTitle,
    sourceDocTitle: table.docTitle,
    pageStart: Number.isFinite(pageStart) ? pageStart : table.pageStart,
    pageEnd,
    warnings: table.warnings,
    columns,
    rows: selected,
    selectedRowIds: selected.map((r) => r.rowId),
    citationText,
  };
}

function buildCitationText(table: RagTable, ps: number, pe: number): string {
  const page =
    Number.isFinite(ps) && pe
      ? ps === pe
        ? `第${ps}页`
        : `第${ps}-${pe}页`
      : "";
  return [table.docTitle, table.tableTitle, page].filter(Boolean).join(" ");
}

// ── ColumnSelector ──

export interface SelectColumnsParams {
  query: string;
  table: RagTable;
  selectedRows: TableRow[];
}

/** 各 tableType 的默认保留列（按 canonicalName 子串匹配）。 */
const TYPE_DEFAULT_COLS: Record<string, RegExp> = {
  indicator_table: /层级|编号|名称|对象|服务规模/,
  requirement_table: /名称|对象|要求类型|配置要求类型|详细配置要求/,
  code_table: /代码|名称|上级|父|内容|类别/,
  deliverable_table: /名称|内容|格式|备注|要素/,
  legend_table: /要素|图例|颜色|要求/,
  generic_table: /名称|对象|编号/,
};

/**
 * 根据问题截取相关列。规则（spec 第十四章）：
 *  1. 必保留 rowKey 列；
 *  2. 问题中出现的字段必保留；
 *  3. 叠加 tableType 默认列；
 *  4. 相关列 < 2 则回退展示全列。
 * 始终按 originalIndex 排序，避免列序错乱。
 */
export function selectRelevantColumns(params: SelectColumnsParams): TableColumn[] {
  const { query, table, selectedRows } = params;
  const cols = table.columns;
  if (cols.length <= 2) return cols;

  const qCanon = canonicalize(query);
  const keep = new Set<string>();

  // 1) rowKey 所在列：值等于某行 rowKey 的列，或表头像名称/代码
  const rowKeyVals = new Set(
    selectedRows.map((r) => (r.rowKey ?? "").trim()).filter(Boolean)
  );
  for (const c of cols) {
    const looksLikeKey = /名称|代码|类别|对象|要素|项目|编号/.test(c.header);
    const holdsKey = selectedRows.some((r) => rowKeyVals.has((r.cells[c.header] ?? "").trim()));
    if (looksLikeKey || holdsKey) keep.add(c.columnId);
  }

  // 2) 问题命中的字段列（canonicalName 或 headerPath 任一段出现在问题中）
  for (const c of cols) {
    if (!c.canonicalName) continue;
    if (qCanon.includes(c.canonicalName) || c.canonicalName.includes(qCanon)) {
      keep.add(c.columnId);
      continue;
    }
    if (c.headerPath.some((seg) => seg && query.includes(seg))) keep.add(c.columnId);
  }

  // 3) tableType 默认列
  const def = TYPE_DEFAULT_COLS[table.tableType] ?? TYPE_DEFAULT_COLS.generic_table;
  for (const c of cols) {
    if (def.test(c.header)) keep.add(c.columnId);
  }

  const result = cols.filter((c) => keep.has(c.columnId));
  // 4) 相关列太少 → 回退全列
  if (result.length < 2) return cols;
  return result.sort((a, b) => a.originalIndex - b.originalIndex);
}
