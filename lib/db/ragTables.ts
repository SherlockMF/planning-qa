// ============================================================================
// RagTable 数据访问层（P0）
// ----------------------------------------------------------------------------
// RagTable 是表格一级对象，独立于 chunk 存储，是最终展示与结构化回查的数据源。
// 与 chunks 一样走内存 store + 磁盘持久化；接真实 DB 时替换实现即可。
// ============================================================================

import type { RagTable } from "@/lib/types";
import { ensureSeeded, getStore } from "./store";
import { saveRagTables, saveChunks } from "./persist";
import { buildRagTablesFromChunks } from "@/lib/rag/ragTable";

/** 全部 RagTable。 */
export async function listRagTables(): Promise<RagTable[]> {
  await ensureSeeded();
  return getStore().ragTables;
}

/**
 * 取单张表。tableId 仅在「同一文档内」唯一（sidecar 的 tbl-N 按文档重置），
 * 因此必须配合 docId 消歧，否则跨文档同名 tableId 会命中错误的表。
 * 不传 docId 时退化为按 tableId 首个匹配（仅供单文档/测试场景）。
 */
export async function getRagTable(
  tableId: string,
  docId?: string
): Promise<RagTable | undefined> {
  await ensureSeeded();
  const tables = getStore().ragTables;
  if (docId) {
    return tables.find((t) => t.tableId === tableId && t.docId === docId);
  }
  return tables.find((t) => t.tableId === tableId);
}

/** 用某文档新解析出的表替换该文档旧表（支持重新解析）。 */
export function replaceRagTablesForDoc(docId: string, tables: RagTable[]): void {
  const store = getStore();
  store.ragTables = store.ragTables.filter((t) => t.docId !== docId);
  store.ragTables.push(...tables);
  saveRagTables(store.ragTables);
}

/**
 * 从当前全部 chunk 重新合成 RagTable（不重新解析 PDF）。
 * 用于把升级后的合成逻辑（页码清理 / 续写归并 / 告警）应用到既有数据。
 * 会就地回填 chunk.rowId/tableType 并落盘。
 */
export async function rebuildAllRagTables(): Promise<number> {
  await ensureSeeded();
  const store = getStore();
  const titleOf = (id: string) => {
    const d = store.documents.find((x) => x.id === id);
    return d ? d.fileName.replace(/\.(pdf|docx|txt|md)$/i, "") : id;
  };
  const tables = buildRagTablesFromChunks(store.chunks, titleOf);
  store.ragTables = tables;
  saveRagTables(tables);
  saveChunks(store.chunks); // rowId/tableType 回填落盘
  return tables.length;
}
