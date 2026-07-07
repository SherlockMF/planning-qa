// ============================================================================
// 检索装配：row hit → TableSlice（P0，spec 第十三章）
// ----------------------------------------------------------------------------
// 检索结果不能只把 chunk 丢给 LLM。命中表格行后，先按 tableId 归并，回查
// RagTable 截取真实行，组装成 TableSlice 供前端以真实表格渲染。
//   - 同一张表命中的多行 → 合并为一个 TableSlice（不碎成多张）；
//   - 命中 table_full 但未命中具体行 → 在该表 rows 内二次检索再截取。
// ============================================================================

import type { RetrievedChunk, TableSlice } from "@/lib/types";
import { getRagTable } from "@/lib/db/ragTables";
import { getTableSlice } from "./tableSlice";
import { shouldSuppressHighConfidenceTableSlice } from "./ragTable";
import { tokenize } from "./bm25";

const ROW_CHUNK_TYPES = new Set([
  "table_row",
  "code",
  "requirement",
  "deliverable",
]);

const MAX_SLICE_ROWS = 20;
/** table_full 命中但无行命中时，二次行检索取多少行。 */
const SECONDARY_ROW_LIMIT = 8;
/**
 * 相对显著性阈值：只有得分达到「本次最高命中分」该比例的表格命中，才装配为
 * 表格展示。避免某个仅靠通用 2-gram（如「平方米」「住宅」）蹭进 Top-N 的边缘
 * 表格行，给非表格问题强行挂上一张无关表格。
 */
const REL_SIGNIFICANCE = 0.6;

/**
 * 把检索命中装配为 TableSlice[]。
 * @param hits 检索 Top-N（已重排，带 rerankScore）。
 * @param query 用户问题（用于列选择与二次行检索）。
 */
export async function assembleTableSlices(
  hits: RetrievedChunk[],
  query: string
): Promise<TableSlice[]> {
  // 显著性门槛：相对本次最高命中分。低于门槛的表格命中视为「蹭词」，不展示表格。
  const topScore = hits.reduce((m, h) => Math.max(m, h.rerankScore), 0);
  const threshold = topScore * REL_SIGNIFICANCE;
  const significant = (h: RetrievedChunk) => h.rerankScore >= threshold;

  // tableId 仅文档内唯一，必须用 docId__tableId 作为归并键，避免跨文档同名表混淆。
  const keyOf = (docId: string, tableId: string) => `${docId}__${tableId}`;
  interface Group {
    docId: string;
    tableId: string;
    rowIds: string[];
  }

  // 1) 直接命中的表格行，按 (docId, tableId) 归并 rowIds（保留首次出现顺序）
  const groups = new Map<string, Group>();
  for (const h of hits) {
    const c = h.chunk;
    if (!ROW_CHUNK_TYPES.has(c.chunkType) || !c.tableId || !c.rowId) continue;
    if (!significant(h)) continue;
    const key = keyOf(c.documentId, c.tableId);
    const g = groups.get(key) ?? { docId: c.documentId, tableId: c.tableId, rowIds: [] };
    if (!g.rowIds.includes(c.rowId)) g.rowIds.push(c.rowId);
    groups.set(key, g);
  }

  // 2) 命中 table_full 但该表尚无行命中 → 二次行检索（同样要求显著）
  for (const h of hits) {
    const c = h.chunk;
    if (c.chunkType !== "table_full" || !c.tableId) continue;
    const key = keyOf(c.documentId, c.tableId);
    if (groups.has(key) || !significant(h)) continue;
    const rowIds = await secondaryRowSearch(c.tableId, c.documentId, query);
    if (rowIds.length) groups.set(key, { docId: c.documentId, tableId: c.tableId, rowIds });
  }

  // 3) 逐表生成 TableSlice
  const slices: TableSlice[] = [];
  for (const g of groups.values()) {
    const slice = await getTableSlice({
      tableId: g.tableId,
      docId: g.docId,
      rowIds: g.rowIds,
      query,
      maxRows: MAX_SLICE_ROWS,
      columnMode: "relevant",
    });
    if (slice && !shouldSuppressHighConfidenceTableSlice(slice.rows, slice.warnings)) {
      slices.push(slice);
    }
  }
  return slices;
}

/** 在单张表的行内做轻量 token 重叠检索，返回最相关的若干 rowId。 */
async function secondaryRowSearch(
  tableId: string,
  docId: string,
  query: string
): Promise<string[]> {
  const table = await getRagTable(tableId, docId);
  if (!table) return [];

  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];

  const scored = table.rows
    .filter(
      (r) =>
        r.rowType === "data" &&
        !shouldSuppressHighConfidenceTableSlice([r])
    )
    .map((r) => {
      const rTokens = tokenize(`${r.rowKey ?? ""} ${r.searchText}`);
      let score = 0;
      for (const t of rTokens) if (qTokens.has(t)) score++;
      return { rowId: r.rowId, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SECONDARY_ROW_LIMIT);

  return scored.map((x) => x.rowId);
}
