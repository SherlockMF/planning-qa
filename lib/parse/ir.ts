// ============================================================================
// Document IR（中间表示）— 需求 1
// ----------------------------------------------------------------------------
// 把 PDF 重建后的逐页文本行（含 \t 列分隔与 [[T]] 表格标记）解析为结构化 Block：
//   heading / paragraph / list_item / table / table_row / page_break / image_page
// 每个 block 保留 pageStart/pageEnd/rawText/normalizedText，表格块带结构化 TableModel。
// chunk 阶段以 Block[] 为输入，不再面对裸字符串。
// ============================================================================

import type { Block, TableModel } from "../types";
import { extractPdfPages } from "./extractText.ts";
import { detectHeading, detectTableCaption, isContinuedTable } from "../rag/headings.ts";
import { buildTableModel } from "../rag/tableModel.ts";
import { scoreTableRegion, shouldKeepAsTable } from "../rag/tableConfidence.ts";

const TABLE_MARK = "[[T]]";

/** 去除行内标记并压缩多余空白，得到归一化文本。 */
function normalize(line: string): string {
  return line
    .replace(/\[\[T\]\]/g, "")
    .replace(/\[\[page:\d+\]\]/g, "")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 列表项标记：一、 / 1、 / 1. / （1） / (1) / ① / -、• */
const LIST_MARKER_RE =
  /^\s*(?:[一二三四五六七八九十百]+[、．.]|\d+[、．.]|[（(]\s*\d+\s*[)）]|[①-⑳]|[-•·])\s*/;

function detectListMarker(line: string): string | null {
  const raw = line.replace(/^\[\[T\]\]/, "");
  const m = LIST_MARKER_RE.exec(raw);
  return m ? m[0].trim() : null;
}

/** 是否为纯页码行（如 "— 12 —" "第 12 页" "12"）。 */
function isPageNumberLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[—\-－\s]*\d{1,4}[—\-－\s]*$/.test(t)) return true;
  if (/^第?\s*\d{1,4}\s*页$/.test(t)) return true;
  return false;
}

interface RawPageLine {
  text: string;
  pageNo: number;
  isTable: boolean;
}

/**
 * 预处理：重新校验每段 [[T]] 连续行（P1，spec 第五章）。
 * 用置信度评分取代旧的「一票否决」：只有「分数极低 且 无 tableType 且 无稳定
 * 二维结构」才清除标记回退为段落 —— 避免误杀配置要求表/成果表/代码定义表
 * （它们数字少、单元格长、含标点，会被旧规则全部否决）。
 */
function untagSpuriousTables(flat: RawPageLine[]): void {
  let i = 0;
  while (i < flat.length) {
    if (!flat[i].isTable) {
      i++;
      continue;
    }
    let j = i;
    const run: RawPageLine[] = [];
    while (j < flat.length && flat[j].isTable) {
      run.push(flat[j]);
      j++;
    }
    const cellRows = run.map((l) =>
      l.text.replace(/^\[\[T\]\]/, "").split("\t").map((c) => c.trim())
    );
    const conf = scoreTableRegion(cellRows);
    if (!shouldKeepAsTable(conf)) {
      for (const l of run) {
        l.isTable = false;
        l.text = l.text.replace(/^\[\[T\]\]/, "");
      }
    }
    i = j;
  }
}

/**
 * 从 PDF buffer 提取 Block[]。
 * 流程：逐页取重建文本行 → 跨页拼平为带页码的行序列 → 聚合表格块 → 分类其余行。
 */
export async function extractBlocks(buffer: Buffer): Promise<Block[]> {
  const pages = await extractPdfPages(buffer);

  // 1. 拼平为带页码、带表格标记的行序列；空文本页标记为 image_page。
  const flat: RawPageLine[] = [];
  const blocks: Block[] = [];
  let tableSeq = 0;

  for (const page of pages) {
    if (page.lines.length === 0) {
      blocks.push({
        type: "image_page",
        pageStart: page.pageNo,
        pageEnd: page.pageNo,
        rawText: "",
        normalizedText: "",
      });
      // 用一个占位 page_break 维持顺序
      flat.push({ text: "", pageNo: page.pageNo, isTable: false });
      continue;
    }
    for (const line of page.lines) {
      flat.push({
        text: line,
        pageNo: page.pageNo,
        isTable: line.startsWith(TABLE_MARK),
      });
    }
  }

  // 1b. 校验表格标记：清除被误标为表格的散文段。
  untagSpuriousTables(flat);

  // 2. 顺序扫描：连续 isTable 行聚合为 table 块；其余行分类。
  let i = 0;
  let pendingTableTitle: string | undefined;
  let prevTableModel: TableModel | undefined;

  while (i < flat.length) {
    const cur = flat[i];

    // image_page 占位（空行且该页只有占位）：已在上面 push 过 block，跳过
    if (cur.text === "") {
      i++;
      continue;
    }

    const norm = normalize(cur.text);

    // 跳过纯页码行（页码单独由 block.pageStart 记录，不进正文）
    if (isPageNumberLine(norm)) {
      i++;
      continue;
    }

    // 表格标题行：记下来，留给紧随的表格块作为 title
    const caption = detectTableCaption(cur.text);
    if (caption && !cur.isTable) {
      pendingTableTitle = caption;
      blocks.push({
        type: "heading",
        pageStart: cur.pageNo,
        pageEnd: cur.pageNo,
        rawText: cur.text,
        normalizedText: norm,
        level: 8,
        headingPattern: "table-caption",
      });
      i++;
      continue;
    }

    // 表格块：聚合连续 isTable 行
    if (cur.isTable) {
      const startPage = cur.pageNo;
      const tableLines: string[] = [];
      let endPage = cur.pageNo;
      let j = i;
      while (j < flat.length && flat[j].isTable) {
        tableLines.push(flat[j].text.replace(/^\[\[T\]\]/, ""));
        endPage = flat[j].pageNo;
        j++;
      }

      const continued = isContinuedTable(cur.text) || /续表/.test(pendingTableTitle ?? "");
      tableSeq += 1;
      const tableId =
        continued && prevTableModel ? prevTableModel.tableId : `table-${tableSeq}`;

      const model = buildTableModel(tableLines, {
        tableId,
        title: pendingTableTitle,
        inheritHeaders: continued ? prevTableModel?.headers : undefined,
      });
      prevTableModel = model;
      pendingTableTitle = undefined;

      // table 块
      blocks.push({
        type: "table",
        pageStart: startPage,
        pageEnd: endPage,
        rawText: tableLines.join("\n"),
        normalizedText: model.markdown,
        table: model,
      });
      // 每行展开为 table_row 块
      for (const row of model.rows) {
        blocks.push({
          type: "table_row",
          pageStart: startPage,
          pageEnd: endPage,
          rawText: row.join("\t"),
          normalizedText: row.join(" "),
          rowCells: row,
          table: model,
        });
      }

      i = j;
      continue;
    }

    // 标题
    const heading = detectHeading(cur.text);
    if (heading) {
      blocks.push({
        type: "heading",
        pageStart: cur.pageNo,
        pageEnd: cur.pageNo,
        rawText: cur.text,
        normalizedText: norm,
        level: heading.level,
        headingPattern: heading.pattern,
      });
      i++;
      continue;
    }

    // 列表项
    const listMarker = detectListMarker(cur.text);
    if (listMarker) {
      blocks.push({
        type: "list_item",
        pageStart: cur.pageNo,
        pageEnd: cur.pageNo,
        rawText: cur.text,
        normalizedText: norm,
        listMarker,
      });
      i++;
      continue;
    }

    // 普通段落（与相邻续行合并：下一行非标题/非列表/非表格且较短时视为同段）
    let paraText = norm;
    const paraStart = cur.pageNo;
    let paraEnd = cur.pageNo;
    let k = i + 1;
    while (k < flat.length) {
      const nxt = flat[k];
      if (nxt.text === "" || nxt.isTable) break;
      const nNorm = normalize(nxt.text);
      if (
        isPageNumberLine(nNorm) ||
        detectHeading(nxt.text) ||
        detectListMarker(nxt.text) ||
        detectTableCaption(nxt.text)
      )
        break;
      // 段落结束判据：上一行以句末标点结尾则不再续接
      if (/[。；！？]$/.test(paraText)) break;
      paraText += nNorm;
      paraEnd = nxt.pageNo;
      k++;
    }
    blocks.push({
      type: "paragraph",
      pageStart: paraStart,
      pageEnd: paraEnd,
      rawText: paraText,
      normalizedText: paraText,
    });
    i = k;
  }

  return blocks;
}
