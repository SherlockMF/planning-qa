import type {
  IndicatorItemObject,
  NormalizedIndicatorValue,
  StructuredTableObject,
  StructuredTableRowObject,
} from "../objects";
import { sectionPathText, stableObjectId } from "../objects.ts";

const INDICATOR_HEADER_RE =
  /指标|规模|面积|数量|比例|服务半径|服务规模|人口|户数|容积率|绿地率|高度|密度|单位/;
const ITEM_HEADER_RE = /设施名称|项目名称|指标名称|事项名称|名称|对象/;
const LEVEL_HEADER_RE = /层级|等级|级别|类别|分类/;
const SERVICE_SCALE_RE = /服务规模|服务范围|服务半径/;

export function extractIndicatorItemObjects(
  docId: string,
  tables: StructuredTableObject[]
): IndicatorItemObject[] {
  const out: IndicatorItemObject[] = [];
  for (const table of tables) {
    if (!looksLikeIndicatorTable(table)) continue;
    for (const row of table.rows) {
      const itemName = fieldByHeader(row.fields, ITEM_HEADER_RE) ?? row.rowKey;
      const indicatorValues = valuesOf(row);
      if (!itemName || indicatorValues.length === 0) continue;
      const category = fieldByHeader(row.fields, /类别|分类/);
      const level = fieldByHeader(row.fields, LEVEL_HEADER_RE);
      const serviceScale = fieldByHeader(row.fields, SERVICE_SCALE_RE);

      out.push({
        id: stableObjectId(docId, "indicator_item", [table.id, row.rowIndex, itemName]),
        docId,
        objectType: "indicator_item",
        title: itemName,
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
        category,
        level,
        itemName,
        indicatorName: indicatorNameOf(row),
        indicatorValues,
        serviceScale,
        unit: indicatorValues.find((v) => v.unit)?.unit,
        fields: row.fields,
        tableObjectId: table.id,
        keywords: [itemName, category, level, table.tableNo, table.tableTitle].filter(Boolean) as string[],
        aliases: [itemName].filter(Boolean),
        confidence: table.tableType === "indicator_table" ? 0.88 : 0.68,
        warnings: table.tableType === "indicator_table" ? undefined : ["indicator_from_numeric_row"],
        raw: row.raw,
      });
    }
  }
  return out;
}

function looksLikeIndicatorTable(table: StructuredTableObject): boolean {
  if (table.tableType === "indicator_table") return true;
  return table.headers.some((h) => INDICATOR_HEADER_RE.test(h.name));
}

function valuesOf(row: StructuredTableRowObject): NormalizedIndicatorValue[] {
  const values: NormalizedIndicatorValue[] = [];
  for (const [header, cell] of Object.entries(row.normalizedFields)) {
    if (!INDICATOR_HEADER_RE.test(header) && cell.kind === "text") continue;
    if (cell.value == null && cell.min == null && cell.max == null) continue;
    values.push({
      raw: cell.raw,
      min: cell.min,
      max: cell.max,
      value: cell.value,
      unit: cell.unit,
      comparator: cell.comparator,
    });
  }
  return values;
}

function indicatorNameOf(row: StructuredTableRowObject): string | undefined {
  return Object.keys(row.fields).find((header) => INDICATOR_HEADER_RE.test(header));
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
