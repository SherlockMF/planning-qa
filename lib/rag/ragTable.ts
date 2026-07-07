// ============================================================================
// RagTable 合成（P0）
// ----------------------------------------------------------------------------
// 把切分阶段已产出的 table_full + table_row/code chunk 反向组装为 RagTable
// 一级对象，并给每个 row chunk 注入稳定 rowId，建立「chunk ↔ RagTable.rows」绑定。
//
// 设计取舍（P0）：复用现有 TableModel/chunk 已有的结构化字段（tableHeaders、
// fields、rowKey、页码），不触碰坐标级解析。解析质量提升属 P1/P2。
//   - table_full chunk：提供 tableId / 表名 / 表头；
//   - table_row|code chunk：提供 cells(fields)、rowKey、searchText(content)、页码。
// cells 是最终展示唯一数据源；chunk.content 仅用于检索。
// ============================================================================

import type {
  Chunk,
  RagTable,
  TableColumn,
  TableRow,
  TableType,
} from "@/lib/types";
import { classifyEvidenceQuality } from "./evidenceQuality.ts";
import type {
  KnowledgeObject,
  StructuredTableObject,
  StructuredTableRowObject,
} from "@/lib/rag/objects";

// ── tableType 分类（P0 基础版，按表名 + 表头 + 行内信号；P1 增强） ──

// 代码型 rowKey：用地/分类代码（A21/R2/G1）或纯数字代码（0701/090203）。
// 必须整体像代码，避免把指标值（如 1700 平方米）误判为代码。
const RE_CODE_ROWKEY = /(?:^|[\s、，,])(?:[A-Za-z]\d{1,3}|\d{4,6})(?=$|[\s、，,])/;
const RE_INDICATOR_TITLE = /(指标表|配置指标|配建指标|规模指标|控制指标)/;
const RE_INDICATOR_HEADER =
  /(建筑面积|用地面积|千人指标|服务规模|一般规模|容积率|建筑高度|建筑规模|层级)/;
const RE_REQUIREMENT_TITLE =
  /(配置要求|布局要求|布局引导|管控要求|技术要求|审查要求|使用说明)/;
const RE_REQUIREMENT_HEADER = /(配置要求|详细配置要求|管控要求|要求内容)/;
const RE_CODE_TITLE = /(用地分类|类别代码|用途分类|分类和代码|代码表)/;
// "内容"/"名称" 过泛（"服务内容"亦含"内容"），改用代码表特有强信号
const RE_CODE_HEADER = /(类别代码|用地代码|主类|中类|小类|代码分类)/;
const RE_DELIVERABLE_TITLE =
  /(成果要求|图纸要求|图纸目录|附表|附件|清单|数据库|提交要求|申报材料|审查材料)/;
const RE_DELIVERABLE_HEADER =
  /(成果名称|图纸名称|主要内容|图纸要素|比例尺|格式要求|材料名称)/;
const RE_LEGEND_HEADER = /(图例|颜色|rgb|图面要素|符号|线型)/i;

/**
 * 判定表格语义类型。优先级：code > requirement > deliverable > legend > indicator。
 * indicator 放最后，因为它的表头信号（建筑面积/层级）最泛，避免抢占更专的类型。
 */
export function classifyTableType(
  title: string | undefined,
  headers: string[],
  rowKeySurface: string
): TableType {
  const t = title ?? "";
  const h = headers.join(" ");

  // 代码表：标题/表头命中分类代码信号，且 rowKey 本身就是代码（而非指标数值）
  if (
    (RE_CODE_TITLE.test(t) || RE_CODE_HEADER.test(h)) &&
    RE_CODE_ROWKEY.test(rowKeySurface)
  ) {
    return "code_table";
  }
  if (RE_REQUIREMENT_TITLE.test(t) || RE_REQUIREMENT_HEADER.test(h)) {
    return "requirement_table";
  }
  if (RE_DELIVERABLE_TITLE.test(t) || RE_DELIVERABLE_HEADER.test(h)) {
    return "deliverable_table";
  }
  if (RE_LEGEND_HEADER.test(h)) {
    return "legend_table";
  }
  if (RE_INDICATOR_TITLE.test(t) || RE_INDICATOR_HEADER.test(h)) {
    return "indicator_table";
  }
  return "generic_table";
}

// ── 列构建：从合并后的单层表头解析 headerPath / unit / canonicalName ──

/** 从表头文本提取单位，如 "建筑面积(平方米/处)" → "平方米/处"。 */
function extractUnit(header: string): string | undefined {
  const m = header.match(/[（(]([^）)]+)[）)]\s*$/);
  if (!m) return undefined;
  const inner = m[1].trim();
  // 仅当括号内像单位（含 米/平方米/% /处/户/座 等）才认定为单位
  if (/(米|平方米|%|％|处|户|座|个|人|元|份|m²|㎡|\/)/.test(inner)) return inner;
  return undefined;
}

/** 规范名：去单位括号、去标点空白、小写，用于字段匹配/列选择。 */
export function canonicalize(header: string): string {
  return header
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s\-—－/、，,。．.:：|]+/g, "")
    .toLowerCase();
}

function buildColumns(headers: string[]): TableColumn[] {
  const seen = new Map<string, number>();
  return headers.map((raw, i) => {
    const header = raw.trim() || `列${i + 1}`;
    // flatten 路径：切分阶段用 "-" 连接多级表头
    const headerPath = header
      .replace(/[（(][^）)]*[）)]/g, "")
      .split("-")
      .map((s) => s.trim())
      .filter(Boolean);
    // 保证 header 唯一（重名补序号，满足「建筑面积/建筑面积」不可重复）
    let uniq = header;
    const n = seen.get(header) ?? 0;
    if (n > 0) uniq = `${header}#${n + 1}`;
    seen.set(header, n + 1);
    return {
      columnId: `col_${i}`,
      header: uniq,
      canonicalName: canonicalize(header),
      headerPath: headerPath.length ? headerPath : [header],
      unit: extractUnit(header),
      originalIndex: i,
    };
  });
}

// ── 页码残片清理（P1 #8）──

/**
 * 是否为页码残片：仅由数字 + 空格 + 破折号构成，且呈「破折号包裹/前后缀」式
 * （如 "— 15 —"、"— 5 1 —"）。要求前导或末尾是破折号，避免误删 "40-50" 这类
 * 区间值；数字位 ≤4，避免误删大数值。
 */
export function isPageFragment(v: string): boolean {
  const t = (v ?? "").trim();
  if (!t || !/^[\d\s—\-－]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 4) return false;
  return /^[—\-－]/.test(t) || /[—\-－]$/.test(t);
}

function cleanCells(cells: Record<string, string>): {
  cells: Record<string, string>;
  removed: boolean;
} {
  const out: Record<string, string> = {};
  let removed = false;
  for (const [k, v] of Object.entries(cells)) {
    if (isPageFragment(v)) {
      removed = true;
      continue; // 丢弃页码残片单元格
    }
    out[k] = v;
  }
  return { cells: out, removed };
}

function classifyTableRowQuality(
  cells: Record<string, string>,
  fallbackText: string,
  chunkType: Chunk["chunkType"] = "table_row"
): Pick<TableRow, "lowFidelity" | "extractionWarnings" | "evidenceCategories"> {
  const warnings = new Set<string>();
  const categories = new Set<string>();
  for (const text of [...Object.values(cells), fallbackText]) {
    if (!text.trim()) continue;
    const quality = classifyEvidenceQuality({ chunkType, text });
    for (const warning of quality.warnings) warnings.add(warning);
    for (const category of quality.categories) categories.add(category);
  }

  if (warnings.size === 0) return {};
  return {
    lowFidelity: true,
    extractionWarnings: [...warnings],
    evidenceCategories: [...categories],
  };
}

function addQualityWarnings(
  warnings: Set<string>,
  quality: Pick<TableRow, "lowFidelity" | "extractionWarnings">
): void {
  if (!quality.lowFidelity && !(quality.extractionWarnings?.length)) return;
  warnings.add("low_fidelity_table");
  for (const warning of quality.extractionWarnings ?? []) warnings.add(warning);
}

function applyRowQualityToChunk(
  chunk: Chunk,
  row: Pick<TableRow, "lowFidelity" | "extractionWarnings" | "evidenceCategories">
): void {
  if (!row.lowFidelity && !(row.extractionWarnings?.length)) return;
  chunk.lowFidelity = true;
  chunk.extractionWarnings = row.extractionWarnings;
  chunk.evidenceCategories = row.evidenceCategories;
}

export function shouldSuppressHighConfidenceTableSlice(
  rows: Pick<TableRow, "lowFidelity" | "extractionWarnings">[],
  tableWarnings: string[] = []
): boolean {
  if (
    tableWarnings.includes("low_fidelity_table") ||
    tableWarnings.includes("scrambled_numeric_unit") ||
    tableWarnings.includes("noisy_extraction_text")
  ) {
    return true;
  }
  return rows.some((row) => row.lowFidelity || (row.extractionWarnings?.length ?? 0) > 0);
}

// ── code 行判定（P1 #4：续写归并）──

const CODE_TOKEN_RE = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]\d{1,3}|\d{4,6})(?:$|[^A-Za-z0-9])/;

/** 文本是否含代码 token（A21 / 080301 等）。 */
export function hasCodeToken(s: string | undefined): boolean {
  return CODE_TOKEN_RE.test(s ?? "");
}

/**
 * 该行是否带有代码（code 字段、rowKey、或任一单元格含代码 token）。
 * 关键：代码常落在「类别代码」列的单元格里，而非 rowKey/code 字段，
 * 因此必须连同 cells 一起判断，否则会把合法代码行误判为续写行而错误合并。
 */
export function rowHasCode(
  code: string | undefined,
  rowKey: string | undefined,
  cellValues: string[] = []
): boolean {
  if (code && code.trim()) return true;
  if (hasCodeToken(rowKey)) return true;
  return cellValues.some((v) => hasCodeToken(v));
}

// ── 行类型判定 ──

const RE_SUMMARY = /^(小计|合计|总计|共计|总和)/;
const RE_NOTE = /^(注[:：]?|备注|说明[:：])/;

function classifyRowType(rowKey: string | undefined, content: string): TableRow["rowType"] {
  const k = (rowKey ?? "").trim();
  if (RE_SUMMARY.test(k) || RE_SUMMARY.test(content)) return "summary";
  if (RE_NOTE.test(k) || RE_NOTE.test(content)) return "note";
  return "data";
}

// ── 主入口：从 chunk 合成 RagTable，并回填 rowId/tableType/rowType ──

const ROW_CHUNK_TYPES = new Set(["table_row", "code", "indicator", "requirement", "deliverable"]);

export function buildRagTablesFromObjects(
  objects: KnowledgeObject[],
  docTitle: string,
  chunks: Chunk[] = []
): RagTable[] {
  const tables = objects.filter(
    (obj): obj is StructuredTableObject => obj.objectType === "structured_table"
  );
  const rowsByTable = new Map<string, StructuredTableRowObject[]>();
  for (const row of objects) {
    if (row.objectType !== "structured_table_row") continue;
    const key = tableKey(row.sourceTableId ?? row.tableObjectId ?? "");
    const list = rowsByTable.get(key) ?? [];
    list.push(row);
    rowsByTable.set(key, list);
  }

  const ragTables: RagTable[] = [];
  for (const table of tables) {
    const tableId = table.sourceTableId ?? table.id;
    const objectRows = (table.rows.length ? table.rows : rowsByTable.get(tableKey(tableId)) ?? [])
      .slice()
      .sort((a, b) => a.rowIndex - b.rowIndex);
    if (!objectRows.length) continue;

    const headers = table.headers.map((header) => header.name);
    const columns = buildColumns(headers.length ? headers : deriveHeadersFromObjects(objectRows));
    const tableType = tableTypeFromStructured(table.tableType);
    const tableWarnings = new Set(table.warnings ?? []);
    const rows: TableRow[] = objectRows.map((row, index) => {
      const cells = normalizeCells(row.fields, columns);
      const rowId = `${table.docId}_${tableId}_row_${row.rowIndex ?? index}`;
      const quality = classifyTableRowQuality(cells, row.content, "table_row");
      addQualityWarnings(tableWarnings, quality);
      return {
        rowId,
        tableId,
        rowIndex: row.rowIndex ?? index,
        rowType: classifyRowType(row.rowKey, row.content),
        rowKey: row.rowKey,
        aliases: row.aliases,
        cells,
        pageStart: row.sourcePageStart ?? table.sourcePageStart ?? 0,
        pageEnd: row.sourcePageEnd ?? table.sourcePageEnd ?? row.sourcePageStart ?? 0,
        searchText: row.content,
        ...quality,
      };
    });

    for (const chunk of chunks) {
      if ((chunk.tableId ?? chunk.sourceTableId) !== tableId) continue;
      chunk.tableType = chunk.tableType ?? tableType;
      chunk.tableTitle = chunk.tableTitle ?? table.tableTitle ?? table.title;
      chunk.tableHeaders = chunk.tableHeaders ?? columns.map((column) => column.header);
      const sourceRow =
        chunk.sourceRowIndex != null
          ? rows.find((row) => row.rowIndex === chunk.sourceRowIndex)
          : undefined;
      const rowMatch =
        sourceRow ??
        rows.find((row) => row.rowKey && chunk.rowKey && chunk.rowKey.includes(row.rowKey));
      if (rowMatch && ROW_CHUNK_TYPES.has(chunk.chunkType)) {
        chunk.rowId = rowMatch.rowId;
        chunk.rowType = rowMatch.rowType;
        applyRowQualityToChunk(chunk, rowMatch);
      }
    }

    ragTables.push({
      tableId,
      docId: table.docId,
      docTitle,
      tableTitle: table.tableTitle ?? table.title ?? "未命名表格",
      tableType,
      sectionPath: table.sectionPath,
      pageStart: Math.min(...rows.map((row) => row.pageStart || Infinity)),
      pageEnd: Math.max(...rows.map((row) => row.pageEnd || 0)),
      columns,
      rows,
      markdownFull: renderMarkdown(columns.map((column) => column.header), rows),
      confidence: table.confidence,
      warnings: [...tableWarnings],
    });
  }
  return ragTables;
}

/**
 * 从一组 chunk（可跨多文档/多表）合成 RagTable[]，并就地回填 row chunk 的
 * rowId / tableType / rowType。按 (documentId, tableId) 分组。
 *
 * 注意：这是「就地变更」——传入的 chunk 对象会被加上 rowId 等字段，调用方
 * 应在入库前调用，使 chunk 与 RagTable 共享同一 rowId。
 */
export function buildRagTablesFromChunks(
  chunks: Chunk[],
  docTitleOf: (documentId: string) => string
): RagTable[] {
  // 分组键：documentId + tableId
  const groups = new Map<string, Chunk[]>();
  for (const c of chunks) {
    if (!c.tableId) continue;
    const key = `${c.documentId}__${c.tableId}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const tables: RagTable[] = [];
  for (const [, group] of groups) {
    const full = group.find((c) => c.chunkType === "table_full");
    const rowCandidates = group.filter((c) => ROW_CHUNK_TYPES.has(c.chunkType));
    const rowChunks = rowCandidates.filter(
      (c) => !c.objectType || c.objectType === "structured_table_row"
    );
    const derivedRowChunks = rowCandidates.filter(
      (c) => c.objectType && c.objectType !== "structured_table_row"
    );
    if (rowChunks.length === 0) continue; // 无数据行，跳过（仅整表无意义）

    const sample = full ?? rowChunks[0];
    const docId = sample.documentId;
    const tableId = sample.tableId!;
    const tableTitle = sample.tableTitle ?? full?.docTitle ?? "未命名表格";
    const headers = sample.tableHeaders ?? deriveHeaders(rowChunks);
    const columns = buildColumns(headers);

    const warnings = new Set<string>();
    // 表头质量告警
    if (columns.some((c) => /#\d+$/.test(c.header))) warnings.add("duplicate_headers");
    if (columns.some((c) => /^列\d+$/.test(c.header))) warnings.add("missing_headers");

    // 预判 tableType（code 续写归并需在建行前知道类型）
    const preKeySurface = rowChunks.map((rc) => rc.rowKey ?? "").join("、");
    const tableType = classifyTableType(tableTitle, headers, preKeySurface);

    // 行：按 chunk 文档顺序构建；code_table 的悬挂续写行并入上一 code 行。
    const rows: TableRow[] = [];
    let rowIdx = 0;
    for (const rc of rowChunks) {
      const { cells, removed } = cleanCells(normalizeCells(rc.fields ?? {}, columns));
      if (removed) warnings.add("page_footer_removed");

      // code_table：无 code 主键的续写行 → 并入上一 data 行（内容续接），
      // 并把该 chunk 的 rowId 指向上一行，保证命中续写 chunk 仍能回查到合并后的行。
      const prev = rows[rows.length - 1];
      if (
        tableType === "code_table" &&
        prev &&
        prev.rowType === "data" &&
        !rowHasCode(rc.code, rc.rowKey, Object.values(cells))
      ) {
        const extra = rc.content.trim();
        if (extra) {
          prev.searchText += " " + extra;
          const contentCol =
            columns.find((c) => /内容|说明|定义|备注/.test(c.header)) ??
            columns[columns.length - 1];
          if (contentCol) {
            prev.cells[contentCol.header] = `${prev.cells[contentCol.header] ?? ""}${extra}`.trim();
          }
        }
        rc.rowId = prev.rowId;
        rc.rowType = "header_continuation";
        rc.tableType = tableType;
        warnings.add("code_continuation_merged");
        continue;
      }

      const rowId = `${docId}_${tableId}_row_${rowIdx}`;
      const rowType = classifyRowType(rc.rowKey, rc.content);
      const quality = classifyTableRowQuality(cells, rc.content, "table_row");
      rc.rowId = rowId;
      rc.rowType = rowType;
      rc.tableType = tableType;
      applyRowQualityToChunk(rc, quality);

      if (!rc.rowKey || !rc.rowKey.trim()) warnings.add("row_key_missing");
      if (Object.values(cells).some((v) => v.length > 60)) warnings.add("long_text_cell");
      const filledRatio = columns.length ? Object.keys(cells).length / columns.length : 1;
      if (filledRatio < 0.5) warnings.add("too_many_empty_cells");
      addQualityWarnings(warnings, quality);

      rows.push({
        rowId,
        tableId,
        rowIndex: rowIdx,
        rowType,
        rowKey: rc.rowKey,
        aliases: rc.aliases,
        cells,
        pageStart: rc.pageStart ?? sample.pageStart ?? 0,
        pageEnd: rc.pageEnd ?? sample.pageEnd ?? 0,
        searchText: rc.content,
        ...quality,
      });
      rowIdx++;
    }

    if (rows.length === 0) continue;

    for (const dc of derivedRowChunks) {
      const sourceRow =
        dc.sourceRowIndex != null
          ? rows.find((row) => row.rowIndex === dc.sourceRowIndex)
          : undefined;
      const fallbackRow =
        sourceRow ??
        rows.find((row) => row.rowKey && dc.rowKey && dc.rowKey.includes(row.rowKey));
      if (!fallbackRow) {
        warnings.add("derived_object_row_binding_missing");
        continue;
      }
      dc.rowId = fallbackRow.rowId;
      dc.rowType = fallbackRow.rowType;
      dc.tableType = tableType;
      dc.tableHeaders = dc.tableHeaders ?? headers;
      dc.tableTitle = dc.tableTitle ?? tableTitle;
      applyRowQualityToChunk(dc, fallbackRow);
    }

    // 回填 tableType 到尚未赋值的 chunk（table_full 等）
    for (const c of group) if (!c.tableType) c.tableType = tableType;

    const confidence = 1 - Math.min(0.5, warnings.size * 0.1);
    if (confidence < 0.6) warnings.add("low_confidence_table");

    tables.push({
      tableId,
      docId,
      docTitle: sample.docTitle ?? docTitleOf(docId),
      tableTitle,
      tableType,
      sectionPath: sample.sectionPath ? sample.sectionPath.split(" / ") : [],
      pageStart: Math.min(...rows.map((r) => r.pageStart || Infinity)),
      pageEnd: Math.max(...rows.map((r) => r.pageEnd || 0)),
      columns,
      rows,
      markdownFull: full?.content ?? "",
      confidence,
      warnings: [...warnings],
    });
  }

  return tables;
}

function tableKey(id: string): string {
  return id.trim();
}

function deriveHeadersFromObjects(rows: StructuredTableRowObject[]): string[] {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  return headers;
}

function tableTypeFromStructured(type: StructuredTableObject["tableType"]): TableType {
  switch (type) {
    case "classification_code_table":
      return "code_table";
    case "indicator_table":
      return "indicator_table";
    case "requirement_table":
      return "requirement_table";
    case "deliverable_table":
    case "checklist_table":
      return "deliverable_table";
    default:
      return "generic_table";
  }
}

function renderMarkdown(headers: string[], rows: TableRow[]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((header) => row.cells[header] ?? "").join(" | ")} |`),
  ].join("\n");
}

/** 无 table_full 时，从行 chunk 的 fields 推断列名（取并集，保序）。 */
function deriveHeaders(rowChunks: Chunk[]): string[] {
  const headers: string[] = [];
  for (const rc of rowChunks) {
    for (const h of Object.keys(rc.fields ?? {})) {
      if (!headers.includes(h)) headers.push(h);
    }
  }
  return headers;
}

/** 把 fields(原始 header→值) 映射到 columns.header（唯一化后）键。 */
function normalizeCells(
  fields: Record<string, string>,
  columns: TableColumn[]
): Record<string, string> {
  const cells: Record<string, string> = {};
  // fields 的键是原始 header；columns[i].headerPath/originalIndex 对应同序
  const keys = Object.keys(fields);
  for (const col of columns) {
    // 优先按原始 header（去唯一化后缀）匹配
    const baseHeader = col.header.replace(/#\d+$/, "");
    if (fields[baseHeader] != null) {
      cells[col.header] = fields[baseHeader];
    } else if (keys[col.originalIndex] != null) {
      cells[col.header] = fields[keys[col.originalIndex]];
    }
  }
  // 兜底：fields 里有但未映射的键，直接保留
  for (const k of keys) {
    if (!Object.values(columns).some((c) => c.header.replace(/#\d+$/, "") === k)) {
      cells[k] = fields[k];
    }
  }
  return cells;
}
