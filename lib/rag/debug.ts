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
