export type KnowledgeObject =
  | RegulationClauseObject
  | ClauseExplanationObject
  | DefinitionObject
  | StructuredTableObject
  | StructuredTableRowObject
  | IndicatorItemObject
  | ClassificationCodeObject
  | RequirementObject
  | DeliverableRequirementObject
  | DrawingRequirementObject
  | ChecklistItemObject
  | ProcedureStepObject
  | ReferenceBasisObject
  | PlainSectionObject;

export type KnowledgeObjectType = KnowledgeObject["objectType"];

export type NormativeLevel =
  | "must"
  | "shall"
  | "should"
  | "may"
  | "encouraged"
  | "forbidden"
  | "informative"
  | "unknown";

export type ClauseNormativeLevel =
  | "must"
  | "shall"
  | "should"
  | "may"
  | "informative"
  | "unknown";

export type StructuredTableType =
  | "classification_code_table"
  | "indicator_table"
  | "requirement_table"
  | "deliverable_table"
  | "checklist_table"
  | "comparison_table"
  | "statistics_table"
  | "unknown_table";

export interface BaseKnowledgeObject {
  id: string;
  docId: string;
  objectType: string;

  title?: string;
  content: string;

  sectionPath: string[];
  sectionPathText: string;

  sourcePageStart?: number;
  sourcePageEnd?: number;
  sourcePages?: number[];

  sourceBlockIds?: string[];
  sourceTableId?: string;
  sourceRowIndex?: number;

  parentObjectId?: string;
  childObjectIds?: string[];
  prevObjectId?: string;
  nextObjectId?: string;

  keywords?: string[];
  aliases?: string[];

  confidence: number;
  warnings?: string[];

  raw?: unknown;
}

export interface RegulationClauseObject extends BaseKnowledgeObject {
  objectType: "regulation_clause";
  clauseNo?: string;
  clauseTitle?: string;
  normativeLevel?: ClauseNormativeLevel;
  obligationKeywords?: string[];
}

export interface ClauseExplanationObject extends BaseKnowledgeObject {
  objectType: "clause_explanation";
  clauseNo?: string;
  relatedObjectId?: string;
}

export interface DefinitionObject extends BaseKnowledgeObject {
  objectType: "definition";
  term: string;
  definition: string;
  aliases?: string[];
}

export interface TableHeader {
  raw: string;
  name: string;
  key: string;
  path: string[];
  unit?: string;
  originalIndex: number;
}

export interface NormalizedCellValue {
  raw: string;
  kind?:
    | "number"
    | "range"
    | "percentage"
    | "empty"
    | "not_applicable"
    | "text"
    | "unknown";
  min?: number;
  max?: number;
  value?: number;
  unit?: string;
  comparator?: ">=" | "<=" | ">" | "<" | "=" | "range" | "unknown";
  qualifiers?: string[];
}

export interface NormalizedIndicatorValue {
  raw: string;
  min?: number;
  max?: number;
  value?: number;
  unit?: string;
  comparator?: ">=" | "<=" | ">" | "<" | "=" | "range" | "unknown";
}

export interface StructuredTableObject extends BaseKnowledgeObject {
  objectType: "structured_table";
  tableNo?: string;
  tableTitle?: string;
  tableType: StructuredTableType;
  headers: TableHeader[];
  normalizedHeaders: string[];
  rows: StructuredTableRowObject[];
  pageSpan: number[];
  isContinuationMerged: boolean;
}

export interface StructuredTableRowObject extends BaseKnowledgeObject {
  objectType: "structured_table_row";
  tableObjectId: string;
  tableNo?: string;
  tableTitle?: string;
  tableType?: StructuredTableType;
  rowIndex: number;
  rowKey?: string;
  fields: Record<string, string>;
  normalizedFields: Record<string, NormalizedCellValue>;
}

export interface IndicatorItemObject extends BaseKnowledgeObject {
  objectType: "indicator_item";
  category?: string;
  level?: string;
  itemName: string;
  indicatorName?: string;
  indicatorValues: NormalizedIndicatorValue[];
  serviceScale?: string;
  unit?: string;
  fields: Record<string, string>;
  tableObjectId?: string;
}

export interface ClassificationCodeObject extends BaseKnowledgeObject {
  objectType: "classification_code";
  code: string;
  name: string;
  parentCode?: string;
  codeLevel?: number;
  description?: string;
  tableObjectId?: string;
  fields: Record<string, string>;
}

export interface RequirementObject extends BaseKnowledgeObject {
  objectType: "requirement";
  requirementText: string;
  subject?: string;
  action?: string;
  condition?: string;
  normativeLevel: NormativeLevel;
}

export interface DeliverableRequirementObject extends BaseKnowledgeObject {
  objectType: "deliverable_requirement";
  deliverableType?: "text" | "drawing" | "table" | "list" | "database" | "appendix" | "unknown";
  stage?: string;
  itemNo?: string;
  itemTitle: string;
  requirementText: string;
  mandatory?: boolean;
}

export interface DrawingRequirementObject extends BaseKnowledgeObject {
  objectType: "drawing_requirement";
  drawingName?: string;
  drawingType?: string;
  requirementText: string;
  mandatory?: boolean;
  relatedSection?: string;
}

export interface ChecklistItemObject extends BaseKnowledgeObject {
  objectType: "checklist_item";
  listName?: string;
  itemNo?: string;
  itemTitle?: string;
  itemText: string;
  mandatory?: boolean;
}

export interface ProcedureStepObject extends BaseKnowledgeObject {
  objectType: "procedure_step";
  procedureName?: string;
  stepNo?: string;
  stepText: string;
  actor?: string;
  output?: string;
}

export interface ReferenceBasisObject extends BaseKnowledgeObject {
  objectType: "reference_basis";
  basisText: string;
  basisTitle?: string;
}

export interface PlainSectionObject extends BaseKnowledgeObject {
  objectType: "plain_section";
}

export function stableObjectId(
  docId: string,
  objectType: string,
  parts: Array<string | number | undefined>
): string {
  const seed = [docId, objectType, ...parts.map((p) => String(p ?? ""))]
    .join("|")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${objectType}-${(hash >>> 0).toString(36)}`;
}

export function sectionPathText(sectionPath: string[]): string {
  return sectionPath.filter(Boolean).join(" / ");
}

export function pageSpanOf(start?: number, end?: number): number[] | undefined {
  if (!start && !end) return undefined;
  const from = start ?? end ?? 0;
  const to = end ?? start ?? from;
  const pages: number[] = [];
  for (let p = from; p <= to; p++) pages.push(p);
  return pages;
}
