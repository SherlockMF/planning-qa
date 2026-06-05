import type {
  DeliverableRequirementObject,
  IndicatorItemObject,
  KnowledgeObject,
  RegulationClauseObject,
  StructuredTableRowObject,
} from "../objects";
import type { Chunk } from "../../types";

export function renderTableSubset(objects: KnowledgeObject[]): string {
  const rows = objects.filter(
    (obj): obj is StructuredTableRowObject => obj.objectType === "structured_table_row"
  );
  if (!rows.length) return "";

  const groups = new Map<string, StructuredTableRowObject[]>();
  for (const row of rows) {
    const key = `${row.sourceTableId ?? row.tableObjectId}|${row.tableNo ?? ""}|${row.tableTitle ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const sections: string[] = [];
  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => a.rowIndex - b.rowIndex);
    const first = groupRows[0];
    const headers = selectHeaders(groupRows);
    const title = [first.tableNo ? `表${first.tableNo}` : undefined, first.tableTitle]
      .filter(Boolean)
      .join(" ");
    const pageText =
      first.sourcePageStart && first.sourcePageEnd
        ? `第${first.sourcePageStart}-${first.sourcePageEnd}页`
        : "";
    const lines = [
      `### ${title || "表格子集"}${pageText ? `（${pageText}）` : ""}`,
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...groupRows.map((row) => `| ${headers.map((h) => escapeCell(row.fields[h] ?? "")).join(" | ")} |`),
    ];
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

export function renderClauseContext(clause: RegulationClauseObject): string {
  return [
    `条文：${clause.clauseNo ?? clause.title ?? clause.id}`,
    `约束等级：${clause.normativeLevel ?? "unknown"}`,
    clause.sectionPathText ? `章节：${clause.sectionPathText}` : undefined,
    clause.sourcePageStart ? `来源页码：第${clause.sourcePageStart}-${clause.sourcePageEnd ?? clause.sourcePageStart}页` : undefined,
    clause.content,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderIndicatorContext(item: IndicatorItemObject): string {
  const values = item.indicatorValues
    .map((value) => value.raw)
    .filter(Boolean)
    .join("；");
  return [
    `指标对象：${item.itemName}`,
    item.indicatorName ? `指标名称：${item.indicatorName}` : undefined,
    values ? `指标值：${values}` : undefined,
    item.unit ? `单位：${item.unit}` : undefined,
    item.level ? `适用层级：${item.level}` : undefined,
    item.serviceScale ? `服务规模：${item.serviceScale}` : undefined,
    item.sourceTableId ? `来源表格：${item.sourceTableId}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderDeliverableContext(item: DeliverableRequirementObject): string {
  return [
    `成果项：${item.itemTitle}`,
    item.deliverableType ? `成果类型：${item.deliverableType}` : undefined,
    item.mandatory != null ? `是否必选：${item.mandatory ? "是" : "否"}` : undefined,
    item.stage ? `阶段：${item.stage}` : undefined,
    `要求：${item.requirementText}`,
    item.sectionPathText ? `来源章节：${item.sectionPathText}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderChunkAnswerContext(chunk: Chunk): string | undefined {
  switch (chunk.objectType) {
    case "classification_code":
      return lines([
        "【结构化分类代码】",
        chunk.code ? `代码：${chunk.code}` : undefined,
        chunk.parentCode ? `父级代码：${chunk.parentCode}` : undefined,
        chunk.rowKey ? `名称：${chunk.rowKey.replace(chunk.code ?? "", "").trim() || chunk.rowKey}` : undefined,
        chunk.tableTitle ? `来源表格：${chunk.tableTitle}` : undefined,
        renderFields(chunk.fields),
      ]);
    case "indicator_item":
      return lines([
        "【结构化指标项】",
        chunk.itemName || chunk.rowKey ? `指标对象：${chunk.itemName ?? chunk.rowKey}` : undefined,
        chunk.tableTitle ? `来源表格：${chunk.tableTitle}` : undefined,
        renderFields(chunk.fields),
      ]);
    case "regulation_clause":
      return lines([
        "【结构化条文】",
        chunk.clauseNo ? `条文：${chunk.clauseNo}` : undefined,
        chunk.normativeLevel ? `约束等级：${chunk.normativeLevel}` : undefined,
        chunk.sectionPath ? `章节：${chunk.sectionPath}` : undefined,
      ]);
    case "requirement":
      return lines([
        "【结构化要求】",
        chunk.normativeLevel ? `约束等级：${chunk.normativeLevel}` : undefined,
        chunk.sectionPath ? `章节：${chunk.sectionPath}` : undefined,
      ]);
    case "deliverable_requirement":
    case "drawing_requirement":
      return lines([
        chunk.objectType === "drawing_requirement" ? "【结构化图纸要求】" : "【结构化成果要求】",
        chunk.mandatory != null ? `是否必选：${chunk.mandatory ? "是" : "否"}` : undefined,
        chunk.tableTitle ? `来源表格：${chunk.tableTitle}` : undefined,
        renderFields(chunk.fields),
      ]);
    case "checklist_item":
      return lines([
        "【结构化清单项】",
        chunk.rowKey ? `事项：${chunk.rowKey}` : undefined,
        chunk.mandatory != null ? `是否必选：${chunk.mandatory ? "是" : "否"}` : undefined,
        renderFields(chunk.fields),
      ]);
    case "procedure_step":
      return lines(["【结构化流程步骤】", chunk.rowKey ? `步骤：${chunk.rowKey}` : undefined]);
    case "definition":
      return lines(["【结构化定义】", chunk.rowKey ? `术语：${chunk.rowKey}` : undefined]);
    case "structured_table_row":
      return lines([
        "【结构化表格行】",
        chunk.tableTitle ? `来源表格：${chunk.tableTitle}` : undefined,
        chunk.rowKey ? `行主键：${chunk.rowKey}` : undefined,
        renderFields(chunk.fields),
      ]);
    default:
      return undefined;
  }
}

function selectHeaders(rows: StructuredTableRowObject[]): string[] {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  if (headers.length <= 8) return headers;
  const important = headers.filter((header) =>
    /代码|编号|名称|类别|层级|指标|面积|数量|要求|内容|说明|服务规模|服务半径/.test(header)
  );
  return (important.length ? important : headers).slice(0, 8);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function renderFields(fields: Record<string, string> | undefined): string | undefined {
  if (!fields) return undefined;
  const pairs = Object.entries(fields)
    .filter(([, value]) => value.trim())
    .slice(0, 16)
    .map(([key, value]) => `${key}：${value.trim()}`);
  return pairs.length ? pairs.join("\n") : undefined;
}

function lines(values: Array<string | undefined>): string | undefined {
  const out = values.filter((value): value is string => Boolean(value && value.trim()));
  return out.length > 1 ? out.join("\n") : undefined;
}
