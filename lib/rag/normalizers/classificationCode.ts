import type {
  ClassificationCodeObject,
  StructuredTableObject,
  StructuredTableRowObject,
} from "../objects";
import { sectionPathText, stableObjectId } from "../objects.ts";

const CODE_VALUE_RE = /^[A-Za-z]\d{1,4}$|^\d{2,8}$|^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$|^[A-Za-z]-?\d{1,4}$/;

export function extractClassificationCodeObjects(
  docId: string,
  tables: StructuredTableObject[]
): ClassificationCodeObject[] {
  const out: ClassificationCodeObject[] = [];
  for (const table of tables) {
    const rows = table.rows;
    if (!looksLikeClassificationTable(table)) continue;
    const codes = new Set(rows.map((row) => codeOf(row)).filter(Boolean) as string[]);

    for (const row of rows) {
      const code = codeOf(row);
      const name = fieldByHeader(row.fields, /名称|类别名称|项目名称/) ?? row.rowKey;
      if (!code || !name || !CODE_VALUE_RE.test(code)) continue;
      const parentCode = inferParentCode(code, codes);
      const warnings = parentCode || codeLevel(code) <= 1 ? undefined : ["parent_code_not_in_same_table"];

      out.push({
        id: stableObjectId(docId, "classification_code", [table.id, code, name]),
        docId,
        objectType: "classification_code",
        title: `${code} ${name}`,
        content: row.content,
        sectionPath: row.sectionPath,
        sectionPathText: sectionPathText(row.sectionPath),
        sourcePageStart: row.sourcePageStart,
        sourcePageEnd: row.sourcePageEnd,
        sourcePages: row.sourcePages,
        sourceBlockIds: row.sourceBlockIds,
        sourceTableId: row.sourceTableId,
        sourceRowIndex: row.rowIndex,
        parentObjectId: row.id,
        code,
        name,
        parentCode,
        codeLevel: codeLevel(code),
        description: fieldByHeader(row.fields, /内容|含义|说明|范围|定义/),
        tableObjectId: table.id,
        fields: row.fields,
        keywords: [code, name, table.tableNo, table.tableTitle].filter(Boolean) as string[],
        aliases: [code, name].filter(Boolean),
        confidence: warnings ? 0.76 : 0.9,
        warnings,
        raw: row.raw,
      });
    }
  }
  return out;
}

function looksLikeClassificationTable(table: StructuredTableObject): boolean {
  if (table.tableType === "classification_code_table") return true;
  const headers = table.headers.map((h) => h.name).join(" ");
  return /代码|编号|分类代码|类别代码/.test(headers) && /名称/.test(headers);
}

function codeOf(row: StructuredTableRowObject): string | undefined {
  const explicit = fieldByHeader(row.fields, /代码|编号|分类代码|类别代码/);
  const raw = explicit ?? row.rowKey;
  return raw?.match(/[A-Za-z]\d{1,4}|\d{2,8}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[A-Za-z]-?\d{1,4}/)?.[0];
}

function fieldByHeader(
  fields: Record<string, string>,
  re: RegExp
): string | undefined {
  for (const [key, value] of Object.entries(fields)) {
    if (re.test(key) && value.trim()) return value.trim();
  }
  return undefined;
}

function inferParentCode(code: string, codes: Set<string>): string | undefined {
  if (/^[A-Za-z]\d{2,}$/.test(code)) {
    for (let len = code.length - 1; len >= 2; len--) {
      const candidate = code.slice(0, len);
      if (codes.has(candidate)) return candidate;
    }
  }
  if (/^\d{4,}$/.test(code)) {
    for (const len of [code.length - 2, code.length - 4, 2]) {
      if (len > 0) {
        const candidate = code.slice(0, len);
        if (codes.has(candidate)) return candidate;
      }
    }
  }
  if (/^[A-Za-z]-\d+/.test(code)) {
    const prefix = code.split("-")[0];
    if (codes.has(prefix)) return prefix;
  }
  return undefined;
}

function codeLevel(code: string): number {
  if (/^[A-Za-z]\d+$/.test(code)) return code.replace(/^[A-Za-z]/, "").length;
  if (/^\d+$/.test(code)) return Math.ceil(code.length / 2);
  if (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/.test(code)) return 1;
  return code.split("-").length;
}
