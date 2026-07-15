import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import process from "node:process";

import { createAutoReviewProvider } from "../lib/audit/autoReviewProvider.ts";
import { computeAutoReviewEval } from "../lib/audit/autoReviewEval.ts";
import { runAutoReview } from "../lib/audit/runAutoReview.ts";

const labelsPath = process.argv[2];
if (!labelsPath) throw new Error("usage: npm.cmd run eval:auto-review -- <labels.json>");

const absoluteLabelsPath = resolve(labelsPath);
const labels = JSON.parse(await readFile(absoluteLabelsPath, "utf8"));
validateLabels(labels);

const provider = createAutoReviewProvider();
const byItemId = new Map(labels.items.map((entry) => [entry.auditItemId, entry]));
const run = await runAutoReview({
  artifactId: `eval-${labels.datasetVersion}`,
  items: labels.items.map((entry) => entry.parsedItem),
}, {
  provider,
  concurrency: positiveInteger(process.env.AUTO_REVIEW_CONCURRENCY, 2),
  renderPage: async (_pageNumber, item) => {
    const label = byItemId.get(item.auditItemId);
    const imagePath = resolve(dirname(absoluteLabelsPath), label.sourceImagePath);
    return {
      mimeType: mimeTypeFor(imagePath),
      base64: (await readFile(imagePath)).toString("base64"),
    };
  },
});
const metrics = computeAutoReviewEval(labels.items, run);
const generatedAt = new Date().toISOString();
const report = {
  datasetVersion: labels.datasetVersion,
  generatedAt,
  rulesVersion: "auto-review-risk-v1",
  provider: run.provider,
  run,
  metrics,
};
const outputDirectory = resolve(
  "debug",
  "auto-review-eval",
  generatedAt.replace(/[:.]/g, "-"),
);
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "summary.md"), renderMarkdown(report), "utf8");

console.log(`mode=${run.mode} gate=${metrics.meetsPilotGate} output=${outputDirectory}`);
if (!metrics.meetsPilotGate) process.exitCode = 2;

function validateLabels(value) {
  if (!value || typeof value !== "object") throw new Error("invalid_auto_review_labels");
  if (typeof value.datasetVersion !== "string" || !value.datasetVersion.trim()) {
    throw new Error("invalid_auto_review_dataset_version");
  }
  if (!Array.isArray(value.documents) || !Array.isArray(value.items)) {
    throw new Error("invalid_auto_review_dataset_collections");
  }
  const documentIds = new Set(value.documents.map((document) => document?.documentId));
  if ([...documentIds].some((documentId) => typeof documentId !== "string" || !documentId)) {
    throw new Error("invalid_auto_review_documents");
  }
  for (const item of value.items) {
    if (!item || typeof item !== "object"
      || typeof item.auditItemId !== "string"
      || !documentIds.has(item.documentId)
      || typeof item.sourceImagePath !== "string"
      || !item.parsedItem
      || item.parsedItem.auditItemId !== item.auditItemId
      || !["clean", "issue"].includes(item.trueStatus)
      || !["severe", "non_severe", "none"].includes(item.severity)
      || !Array.isArray(item.issueTypes)
      || !item.correctSourceLocation
      || typeof item.correctSourceLocation !== "object") {
      throw new Error(`invalid_auto_review_label:${item?.auditItemId ?? "unknown"}`);
    }
  }
}

function renderMarkdown(report) {
  const { metrics, run } = report;
  const modeLabel = run.mode === "rules_only" ? "rules_only baseline" : run.mode;
  return `# Automatic Review Eval\n\n`
    + `- Dataset: ${report.datasetVersion}\n`
    + `- Mode: ${modeLabel}\n`
    + `- Provider: ${run.provider?.name ?? "none"}\n`
    + `- Model: ${run.provider?.model ?? "none"}\n`
    + `- Generated: ${report.generatedAt}\n`
    + `- Pilot gate: ${metrics.meetsPilotGate ? "PASS" : "FAIL"}\n\n`
    + `## Metrics\n\n`
    + `- Severe recall: ${metrics.severeRecall}\n`
    + `- Severe miss rate: ${metrics.severeMissRate}\n`
    + `- False positive rate: ${metrics.falsePositiveRate}\n`
    + `- Localization accuracy: ${metrics.localizationAccuracy}\n`
    + `- Unavailable rate: ${metrics.unavailableRate}\n\n`
    + `## Confusion matrix\n\n    ${JSON.stringify(metrics.confusion)}\n\n`
    + `## Issue types\n\n${indentJson(metrics.issueTypes)}\n\n`
    + `## Documents\n\n${indentJson(metrics.byDocument)}\n\n`
    + `## Findings\n\n${indentJson(metrics.findings)}\n`;
}

function indentJson(value) {
  return JSON.stringify(value, null, 2).split("\n").map((line) => `    ${line}`).join("\n");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mimeTypeFor(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}
