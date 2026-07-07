import fs from "node:fs";
import path from "node:path";

import { extractBlocksWithTables } from "../lib/parse/tablesSidecar.ts";
import { buildChunksWithObjects } from "../lib/rag/chunk.ts";
import { writeRagPipelineDebug } from "../lib/rag/debug.ts";
import { summarizeParseQuality } from "../lib/rag/eval/parseQualityMetrics.ts";
import { runNumericObjectEval } from "../lib/rag/eval/runEval.ts";

// 用法：node --experimental-strip-types scripts/run_real_pdf_eval.mjs <pdf1> [pdf2] ...
// 不传参数时使用此默认列表（按需填入本地 PDF 路径）
const DEFAULT_PDFS = [];

const pdfs = process.argv.slice(2);
const inputs = pdfs.length ? pdfs : DEFAULT_PDFS;
const outDir = path.join(process.cwd(), "debug", "real-pdf-eval");
fs.mkdirSync(outDir, { recursive: true });

const summary = [];

for (const pdfPath of inputs) {
  const startedAt = Date.now();
  const fileName = path.basename(pdfPath);
  const docId = stableDocId(fileName);
  const doc = {
    id: docId,
    fileName,
    city: "北京",
    fileType: "其他",
    enabled: true,
    status: "indexed",
    createdAt: new Date(0).toISOString(),
  };

  try {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`file_not_found: ${pdfPath}`);
    }
    const buffer = fs.readFileSync(pdfPath);
    const blocks = await extractBlocksWithTables(buffer);
    const parseQuality = summarizeParseQuality(blocks);
    const result = buildChunksWithObjects(doc, { blocks });
    const numericObjectEval = runNumericObjectEval(result.knowledgeObjects);
    const debugDir = writeRagPipelineDebug({
      docId,
      blocks: result.blocks,
      cleanedBlocks: result.cleanedBlocks,
      profile: result.profile,
      sectionTree: result.sectionTree,
      knowledgeObjects: result.knowledgeObjects,
      retrievalChunks: result.drafts,
      versionInfo: result.versionInfo,
      warnings: [
        ...result.warnings,
        ...(result.fallbackUsed ? ["fallback_to_legacy_chunkBlocks"] : []),
      ],
    });

    summary.push({
      fileName,
      pdfPath,
      docId,
      ok: true,
      debugDir,
      elapsedMs: Date.now() - startedAt,
      blockCount: blocks.length,
      cleanedBlockCount: result.cleanedBlocks.length,
      retrievalChunkCount: result.drafts.length,
      objectCount: result.knowledgeObjects.length,
      objectTypes: countBy(result.knowledgeObjects.map((obj) => obj.objectType)),
      parseQuality,
      numericObjectEval,
      numericObjectEvalPassCount: numericObjectEval.filter((item) => item.pass)
        .length,
      numericObjectEvalTotal: numericObjectEval.length,
      tableTypes: countBy(
        result.knowledgeObjects
          .filter((obj) => obj.objectType === "structured_table")
          .map((obj) => obj.tableType)
      ),
      fallbackUsed: result.fallbackUsed,
      warnings: result.warnings,
    });
  } catch (error) {
    summary.push({
      fileName,
      pdfPath,
      docId,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: String(error),
    });
  }
}

const summaryPath = path.join(outDir, "summary.json");
const markdownPath = path.join(outDir, "summary.md");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
fs.writeFileSync(markdownPath, renderMarkdown(summary), "utf8");

console.log(summaryPath);
console.log(markdownPath);

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = value || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function stableDocId(fileName) {
  let hash = 2166136261;
  for (const ch of fileName) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `real-${base || "pdf"}-${(hash >>> 0).toString(36)}`;
}

function renderMarkdown(rows) {
  const lines = [
    "# Real PDF RAG Eval",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "| File | OK | Objects | Chunks | Tables | Quality | Numeric | Key object types | Debug |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const keyTypes = row.objectTypes
      ? [
          "classification_code",
          "indicator_item",
          "regulation_clause",
          "definition",
          "requirement",
          "deliverable_requirement",
          "drawing_requirement",
          "checklist_item",
          "procedure_step",
        ]
          .map((type) => (row.objectTypes[type] ? `${type}:${row.objectTypes[type]}` : undefined))
          .filter(Boolean)
          .join("<br>")
      : row.error;
    lines.push(
      [
        row.fileName,
        row.ok ? "yes" : "no",
        row.objectCount ?? 0,
        row.retrievalChunkCount ?? 0,
        row.objectTypes?.structured_table ?? 0,
        renderQuality(row.parseQuality),
        renderNumeric(row.numericObjectEval),
        keyTypes || "",
        row.debugDir ?? "",
      ]
        .map((cell) => String(cell).replace(/\|/g, "\\|"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |")
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderNumeric(rows) {
  if (!rows) return "";
  const pass = rows.filter((row) => row.pass).length;
  const failed = rows
    .filter((row) => !row.pass)
    .map((row) => row.query)
    .slice(0, 3)
    .join("<br>");
  return failed ? `${pass}/${rows.length}<br>${failed}` : `${pass}/${rows.length}`;
}

function renderQuality(q) {
  if (!q) return "";
  return [
    `emptyHeader:${formatPct(q.emptyHeaderRatio)}`,
    `untitled:${q.untitledTableCount}/${q.tableCount}`,
    `lowFidelityCells:${q.lowFidelityCellCount}`,
  ].join("<br>");
}

function formatPct(value) {
  return `${Math.round((value ?? 0) * 1000) / 10}%`;
}
