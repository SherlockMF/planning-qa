// ============================================================================
// 题库导入解析
// ----------------------------------------------------------------------------
// 从粘贴文本或上传的 CSV / TSV / Markdown 表格中解析题目，自动识别列：
//   序号 / 问题 / 标准答案 / 答案来源（→ 正确文件）
// 识别策略：
//   1. 自动判定分隔符（制表符 > 竖线 > 逗号）；
//   2. 首行若含表头关键词 → 按列名映射；否则按位置（序号?,问题,标准答案,答案来源）；
//   3. 问题为空的行跳过。
// 纯函数、无副作用，便于单测；UI 仅负责读取文件文本与展示预览。
// ============================================================================

export type ImportField = "seq" | "question" | "standardAnswer" | "correctFile";

export interface ParsedRow {
  seq?: string;
  question: string;
  standardAnswer: string;
  correctFile: string;
}

export interface ImportResult {
  rows: ParsedRow[];
  /** 是否识别到表头行 */
  headerDetected: boolean;
  /** 列序 → 字段映射（按检测到的列顺序） */
  columnMap: (ImportField | null)[];
  delimiter: "tab" | "pipe" | "comma" | "xlsx";
  warnings: string[];
}

/** 归一化表头单元格，用于关键词匹配。 */
function normalizeHeader(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/[\s:：()（）.。、_\-]/g, "");
}

/** 将单个表头单元格分类到字段；无法识别返回 null。顺序即优先级。 */
export function classifyHeader(cell: string): ImportField | null {
  const n = normalizeHeader(cell);
  if (!n) return null;
  if (/标准答案|参考答案|正确答案|standardanswer/.test(n)) return "standardAnswer";
  if (/答案来源|来源|出处|依据|引用文件|正确文件|来源文件|source|reference|file/.test(n))
    return "correctFile";
  if (/问题|题目|提问|试题|question/.test(n) || n === "问") return "question";
  if (/序号|编号|题号|序列|^no$|^index$|^id$|^序$/.test(n)) return "seq";
  if (/答案|answer/.test(n)) return "standardAnswer";
  return null;
}

/** 解析一行为单元格数组（comma 分隔时支持双引号转义）。 */
function splitLine(line: string, delimiter: "tab" | "pipe" | "comma"): string[] {
  if (delimiter === "tab") return line.split("\t");
  if (delimiter === "pipe")
    return line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|");
  // comma：支持 "..." 包裹（内部逗号与 "" 转义）
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function detectDelimiter(lines: string[]): "tab" | "pipe" | "comma" {
  const sample = lines.slice(0, 5).join("\n");
  if (sample.includes("\t")) return "tab";
  if (/\|/.test(sample)) return "pipe";
  return "comma";
}

/** markdown 表格分隔行，如 | --- | :---: | */
function isMarkdownSeparator(cells: string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c) || c.trim() === "")
  );
}

const FIELD_ORDER: ImportField[] = [
  "seq",
  "question",
  "standardAnswer",
  "correctFile",
];

/** 解析导入文本。 */
export function parseEvaluationImport(raw: string): ImportResult {
  const warnings: string[] = [];
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) {
    return {
      rows: [],
      headerDetected: false,
      columnMap: [],
      delimiter: "comma",
      warnings: ["内容为空"],
    };
  }

  const delimiter = detectDelimiter(lines);

  const rawRows = lines.map((l) => splitLine(l, delimiter).map((c) => c.trim()));

  return parseRowsToEvaluation(rawRows, delimiter);
}

/**
 * 从已拆分的二维单元格解析题目（供 XLSX 等非文本来源复用）。
 * 与 parseEvaluationImport 共享表头识别与列映射逻辑。
 */
export function parseRowsToEvaluation(
  rawRows0: string[][],
  delimiter: ImportResult["delimiter"] = "xlsx"
): ImportResult {
  const warnings: string[] = [];
  const rawRows = rawRows0
    .map((r) => r.map((c) => (c ?? "").toString().trim()))
    .filter((cells) => cells.some((c) => c !== "") && !isMarkdownSeparator(cells));

  if (rawRows.length === 0) {
    return {
      rows: [],
      headerDetected: false,
      columnMap: [],
      delimiter,
      warnings: ["未解析到有效行"],
    };
  }

  // 判定首行是否为表头：至少识别出「问题」或「标准答案」其一
  const firstRowFields = rawRows[0].map(classifyHeader);
  const headerDetected =
    firstRowFields.includes("question") ||
    firstRowFields.includes("standardAnswer");

  let columnMap: (ImportField | null)[];
  let dataRows: string[][];

  if (headerDetected) {
    columnMap = dedupeColumnMap(firstRowFields, warnings);
    dataRows = rawRows.slice(1);
  } else {
    columnMap = positionalColumnMap(rawRows);
    dataRows = rawRows;
  }

  const rows: ParsedRow[] = [];
  for (const cells of dataRows) {
    const row: ParsedRow = {
      question: "",
      standardAnswer: "",
      correctFile: "",
    };
    columnMap.forEach((field, idx) => {
      if (!field) return;
      const val = cells[idx] ?? "";
      if (field === "seq") row.seq = val;
      else row[field] = val;
    });
    if (!row.question.trim()) continue;
    rows.push(row);
  }

  if (rows.length === 0) warnings.push("未解析到任何题目（问题列均为空）");

  return { rows, headerDetected, columnMap, delimiter, warnings };
}

/** 同字段重复映射时仅保留首个，并告警。 */
function dedupeColumnMap(
  fields: (ImportField | null)[],
  warnings: string[]
): (ImportField | null)[] {
  const seen = new Set<ImportField>();
  return fields.map((f) => {
    if (!f) return null;
    if (seen.has(f)) {
      warnings.push(`重复的列「${f}」已忽略`);
      return null;
    }
    seen.add(f);
    return f;
  });
}

/** 无表头时按位置映射。首列全为数字编号则视为序号。 */
function positionalColumnMap(rows: string[][]): (ImportField | null)[] {
  const colCount = Math.max(...rows.map((r) => r.length));
  const firstColIsSeq =
    colCount >= 3 &&
    rows.every((r) => /^\d+(?:[.\-]\d+)*$/.test((r[0] ?? "").trim()));

  const fieldsInOrder: ImportField[] = firstColIsSeq
    ? FIELD_ORDER
    : ["question", "standardAnswer", "correctFile"];

  return Array.from({ length: colCount }, (_, i) => fieldsInOrder[i] ?? null);
}
