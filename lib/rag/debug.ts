import fs from "fs";
import path from "path";
import type { Block, DocProfile } from "../types";
import type { DraftChunk } from "./chunk.ts";
import type { KnowledgeObject, StructuredTableObject } from "./objects";
import type { SectionTree } from "./sectionTree";
import { buildExactIndex, type ExactIndexEntry } from "./retrieval/exactIndex.ts";
import type { SourceVersionInfo } from "./version";

export interface RagPipelineDebugPayload {
  docId: string;
  blocks: Block[];
  cleanedBlocks: Block[];
  profile?: DocProfile;
  sectionTree?: SectionTree;
  knowledgeObjects?: KnowledgeObject[];
  retrievalChunks?: DraftChunk[];
  warnings?: string[];
  versionInfo?: SourceVersionInfo;
}

export function writeRagPipelineDebug(payload: RagPipelineDebugPayload): string | undefined {
  if (process.env.DEBUG_RAG === "0") return undefined;
  const dir = path.join(process.cwd(), "debug", payload.docId);
  fs.mkdirSync(dir, { recursive: true });

  const objects = payload.knowledgeObjects ?? [];
  const exactIndex = buildExactIndex(objects);
  const tables = objects.filter(
    (obj): obj is StructuredTableObject => obj.objectType === "structured_table"
  );

  writeJson(path.join(dir, "01_blocks.json"), payload.blocks);
  writeJson(path.join(dir, "02_cleaned_blocks.json"), payload.cleanedBlocks);
  writeJson(path.join(dir, "03_doc_profile.json"), payload.profile ?? {});
  writeJson(path.join(dir, "04_section_tree.json"), payload.sectionTree ?? {});
  writeJson(path.join(dir, "05_raw_tables.json"), rawTablePreview(payload.blocks));
  writeJson(path.join(dir, "06_merged_tables.json"), tables);
  writeJson(path.join(dir, "07_table_classification.json"), tableClassificationPreview(tables));
  writeJson(path.join(dir, "08_knowledge_objects.json"), objects);
  writeJson(path.join(dir, "09_retrieval_chunks.json"), payload.retrievalChunks ?? []);
  writeJson(path.join(dir, "10_exact_index.json"), exactIndex);
  fs.writeFileSync(
    path.join(dir, "11_retrieval_preview.md"),
    renderRetrievalPreview(objects, exactIndex),
    "utf8"
  );
  writeJson(path.join(dir, "warnings.json"), {
    warnings: payload.warnings ?? [],
    versionInfo: payload.versionInfo,
  });
  return dir;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function rawTablePreview(blocks: Block[]) {
  return blocks
    .filter((block) => block.type === "table" && block.table)
    .map((block) => ({
      pageStart: block.pageStart,
      pageEnd: block.pageEnd,
      tableId: block.table?.tableId,
      title: block.table?.title,
      headers: block.table?.headers,
      rowCount: block.table?.rows.length,
    }));
}

function tableClassificationPreview(tables: StructuredTableObject[]) {
  return tables.map((table) => ({
    id: table.id,
    tableNo: table.tableNo,
    tableTitle: table.tableTitle,
    tableType: table.tableType,
    confidence: table.confidence,
    warnings: table.warnings,
    pageSpan: table.pageSpan,
    rows: table.rows.length,
  }));
}

function renderRetrievalPreview(
  objects: KnowledgeObject[],
  exactIndex: ExactIndexEntry[]
): string {
  const groups = new Map<string, KnowledgeObject[]>();
  for (const obj of objects) {
    const group = groups.get(obj.objectType) ?? [];
    group.push(obj);
    groups.set(obj.objectType, group);
  }

  const preferred = [
    "regulation_clause",
    "definition",
    "classification_code",
    "indicator_item",
    "requirement",
    "deliverable_requirement",
    "drawing_requirement",
    "checklist_item",
    "procedure_step",
    "structured_table",
    "plain_section",
  ];
  const lines = ["# Retrieval Preview", ""];
  for (const type of preferred) {
    const items = groups.get(type) ?? [];
    if (!items.length) continue;
    lines.push(`## ${type} (${items.length})`, "");
    for (const item of items.slice(0, 5)) {
      lines.push(
        `- ${item.title ?? item.id} | page=${item.sourcePageStart ?? "?"}-${item.sourcePageEnd ?? item.sourcePageStart ?? "?"} | confidence=${item.confidence.toFixed(2)}`
      );
      lines.push(`  - source: ${sourceOf(item)}`);
      lines.push(`  - reason: ${reasonOf(item)}`);
      if (item.warnings?.length) lines.push(`  - warnings: ${item.warnings.join(", ")}`);
      lines.push(`  - ${item.content.slice(0, 160).replace(/\n/g, " ")}`);
    }
    lines.push("");
  }
  lines.push(`## exact_index (${exactIndex.length})`);
  for (const entry of exactIndex.slice(0, 30)) {
    lines.push(`- ${entry.key} -> ${entry.objectType}/${entry.field} (${entry.boost})`);
  }
  return lines.join("\n");
}

function sourceOf(item: KnowledgeObject): string {
  return [
    item.sourceBlockIds?.length ? `blocks=${item.sourceBlockIds.join(",")}` : undefined,
    item.sourceTableId ? `table=${item.sourceTableId}` : undefined,
    item.sourceRowIndex != null ? `row=${item.sourceRowIndex}` : undefined,
    item.sectionPathText ? `section=${item.sectionPathText}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ") || "unknown";
}

function reasonOf(item: KnowledgeObject): string {
  switch (item.objectType) {
    case "regulation_clause":
      return [
        item.clauseNo ? `clauseNo=${item.clauseNo}` : "clause pattern",
        item.normativeLevel ? `normative=${item.normativeLevel}` : undefined,
        item.obligationKeywords?.length ? `keywords=${item.obligationKeywords.join(",")}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
    case "classification_code":
      return `code=${item.code} | name=${item.name}`;
    case "indicator_item":
      return [
        `item=${item.itemName}`,
        item.indicatorValues.length ? `values=${item.indicatorValues.map((value) => value.raw).join(",")}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ");
    case "structured_table":
      return `tableType=${item.tableType} | headers=${item.headers.map((header) => header.name).join("|")}`;
    case "structured_table_row":
      return `rowKey=${item.rowKey ?? ""} | fields=${Object.keys(item.fields).join("|")}`;
    case "definition":
      return `term=${item.term}`;
    case "deliverable_requirement":
      return `deliverableType=${item.deliverableType} | mandatory=${String(item.mandatory)}`;
    case "drawing_requirement":
      return `drawing=${item.drawingName ?? ""} | mandatory=${String(item.mandatory)}`;
    case "checklist_item":
      return `list=${item.listName ?? ""} | item=${item.itemTitle ?? ""}`;
    case "procedure_step":
      return `procedure=${item.procedureName ?? ""} | step=${item.stepNo ?? ""}`;
    default:
      return item.keywords?.length ? `keywords=${item.keywords.slice(0, 8).join(",")}` : "fallback";
  }
}
