import { cn } from "@/lib/utils";
import { TABLE_LINE_MARKER } from "@/lib/parse/extractText";

// ============================================================================
// 表格/文本智能渲染
// ----------------------------------------------------------------------------
// 新切分管线产出的 table_full chunk 内容是「表名 + GFM markdown 表格」：
//     表 — 综合服务类设施配置指标表
//     | 层级 | 编号 | 设施名称 | ... |
//     | --- | --- | --- | ... |
//     | 项目级 | 1 | 物业服务用房 | ... |
// 因此渲染优先识别 markdown 表格；同时兼容旧数据的 [[T]] 标记 / \t 分隔结构。
// 普通文本（含 table_row 的自然语言展开句）按段落渲染。
// ============================================================================

// ── markdown 表格解析 ──

function splitPipeCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** 是否为 markdown 表格行（含竖线分隔）。 */
function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && (t.match(/\|/g)?.length ?? 0) >= 1;
}

/** 是否为 markdown 分隔行（| --- | :--: |）。 */
function isSeparatorRow(line: string): boolean {
  const cells = splitPipeCells(line);
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")))
  );
}

interface MarkdownTable {
  header?: string[];
  rows: string[][];
}

/** 把一组连续竖线行解析为表格（首行作表头，剥掉分隔行）。 */
function parsePipeBlock(lines: string[]): MarkdownTable {
  const dataLines = lines.filter((l) => !isSeparatorRow(l));
  const hasSeparator = lines.some(isSeparatorRow);
  const rows = dataLines.map(splitPipeCells);
  if (hasSeparator && rows.length > 0) {
    return { header: rows[0], rows: rows.slice(1) };
  }
  return { rows };
}

type Segment =
  | { kind: "table"; table: MarkdownTable }
  | { kind: "text"; text: string };

/** 把整段文本切成「markdown 表格段」与「文本段」。 */
function segmentMarkdown(text: string): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let pipeBuf: string[] = [];
  let textBuf: string[] = [];

  const flushPipe = () => {
    if (pipeBuf.length >= 2) {
      segments.push({ kind: "table", table: parsePipeBlock(pipeBuf) });
    } else if (pipeBuf.length) {
      textBuf.push(...pipeBuf);
    }
    pipeBuf = [];
  };
  const flushText = () => {
    const t = textBuf.join("\n").trim();
    if (t) segments.push({ kind: "text", text: t });
    textBuf = [];
  };

  for (const line of lines) {
    if (isPipeRow(line)) {
      if (textBuf.length) flushText();
      pipeBuf.push(line);
    } else {
      if (pipeBuf.length) flushPipe();
      textBuf.push(line);
    }
  }
  flushPipe();
  flushText();
  return segments;
}

function hasMarkdownTable(text: string): boolean {
  return segmentMarkdown(text).some(
    (s) => s.kind === "table" && (s.table.header || s.table.rows.length > 0)
  );
}

// ── 旧结构（\t / [[T]]）检测，向后兼容 ──

function hasTabStructure(text: string): boolean {
  if (text.includes(TABLE_LINE_MARKER)) return true;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const rows = lines.map((l) => l.split("\t"));
  const multiColRows = rows.filter((r) => r.length > 1);
  if (multiColRows.length < 3) return false;
  const colCounts = multiColRows.map((r) => r.length);
  const maxC = Math.max(...colCounts);
  const minC = Math.min(...colCounts);
  if (maxC < 2 || maxC - minC > 1) return false;
  let maxRun = 0,
    cur = 0;
  for (const r of rows) {
    if (r.length > 1) {
      cur++;
      if (cur > maxRun) maxRun = cur;
    } else cur = 0;
  }
  return maxRun >= 3;
}

// ── 渲染 ──

function Grid({ table }: { table: MarkdownTable }) {
  const colCount = Math.max(
    table.header?.length ?? 0,
    ...table.rows.map((r) => r.length),
    1
  );
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        {table.header && (
          <thead>
            <tr className="bg-sky-100/70">
              {Array.from({ length: colCount }).map((_, j) => (
                <th
                  key={j}
                  className="border border-sky-200 px-2 py-1 text-left font-medium text-slate-700"
                >
                  {table.header![j] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="even:bg-sky-50/40">
              {Array.from({ length: colCount }).map((_, j) => (
                <td
                  key={j}
                  className="border border-sky-200 px-2 py-1 align-top text-slate-700"
                >
                  {r[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 旧 \t / [[T]] 结构渲染（向后兼容）。 */
function TabGrid({ text }: { text: string }) {
  const clean = text.replace(
    new RegExp(`\\${TABLE_LINE_MARKER}`, "g"),
    ""
  );
  const rows = clean
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t").map((c) => c.trim().replace(/\s{2,}/g, " ")));
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((r, i) =>
            r.length === 1 ? (
              <tr key={i}>
                <td
                  colSpan={cols}
                  className="border border-sky-200 bg-sky-100/70 px-2 py-1 font-medium text-slate-700"
                >
                  {r[0]}
                </td>
              </tr>
            ) : (
              <tr key={i} className="even:bg-sky-50/40">
                {Array.from({ length: cols }).map((_, j) => (
                  <td
                    key={j}
                    className="border border-sky-200 px-2 py-1 align-top text-slate-700"
                  >
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TableBlock({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  // 1) markdown 表格（新管线 table_full）：可能含表名标题 + 多张表，混排渲染
  if (hasMarkdownTable(text)) {
    const segments = segmentMarkdown(text);
    return (
      <div className={cn("space-y-2", className)}>
        {segments.map((seg, i) =>
          seg.kind === "table" ? (
            <Grid key={i} table={seg.table} />
          ) : (
            <div
              key={i}
              className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700"
            >
              {seg.text}
            </div>
          )
        )}
      </div>
    );
  }

  // 2) 旧 \t / [[T]] 结构（历史数据 / DOCX）
  if (hasTabStructure(text)) {
    return (
      <div className={className}>
        <TabGrid text={text} />
      </div>
    );
  }

  // 3) 普通文本（含 table_row 自然语言句）
  const clean = text.replace(new RegExp(`\\${TABLE_LINE_MARKER}`, "g"), "");
  return (
    <div
      className={cn(
        "whitespace-pre-wrap text-sm leading-relaxed text-slate-700",
        className
      )}
    >
      {clean}
    </div>
  );
}

/**
 * 文本是否包含表格结构（决定是否套用表格容器/徽标）。
 * 新管线：markdown 表格；向后兼容：[[T]] 标记 / \t 结构。
 */
export function hasTableStructure(text: string): boolean {
  return hasMarkdownTable(text) || hasTabStructure(text);
}
