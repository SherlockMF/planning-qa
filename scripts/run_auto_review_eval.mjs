import fs from "node:fs";
import path from "node:path";

import { computeAutoReviewEval } from "../lib/audit/autoReviewEval.ts";
import { createAutoReviewProvider } from "../lib/audit/autoReviewProvider.ts";
import { runAutoReview } from "../lib/audit/runAutoReview.ts";

const ISSUE_TYPES = new Set([
  "reading_order_noise",
  "row_boundary_contamination",
  "column_misalignment",
  "merged_cell_scope_error",
  "missing_content",
  "source_mapping_error",
  "semantic_assignment_error",
  "other",
]);

try {
  const options = parseArguments(process.argv.slice(2));
  const corpusPath = path.resolve(options.corpusPath);
  const corpus = validateCorpus(JSON.parse(fs.readFileSync(corpusPath, "utf8")), corpusPath);
  const provider = options.mode === "hybrid" ? createAutoReviewProvider() : undefined;
  const documentRuns = [];

  for (const document of corpus.documents) {
    const labelsById = new Map(document.items.map((item) => [item.auditItemId, item]));
    const run = await runAutoReview({
      artifactId: `eval-${corpus.datasetVersion}-${document.documentId}`,
      items: document.items.map((item) => item.parsedItem),
    }, {
      provider,
      concurrency: positiveInteger(process.env.AUTO_REVIEW_CONCURRENCY, 2),
      renderPage: async (_pageNumber, item) => {
        const label = labelsById.get(item.auditItemId);
        if (!label) throw new Error(`missing_eval_label:${item.auditItemId}`);
        const imagePath = path.resolve(path.dirname(corpusPath), label.sourceImagePath);
        return {
          mimeType: mimeTypeFor(imagePath),
          base64: fs.readFileSync(imagePath).toString("base64"),
        };
      },
    });
    documentRuns.push({ documentId: document.documentId, run, gold: document.items });
  }

  const gold = documentRuns.flatMap((entry) => entry.gold);
  const items = documentRuns.flatMap((entry) => entry.run.items);
  const mode = combinedMode(documentRuns.map((entry) => entry.run.mode));
  const metrics = computeAutoReviewEval(gold, { mode, items });
  const generatedAt = new Date().toISOString();
  const summary = {
    datasetVersion: corpus.datasetVersion,
    generatedAt,
    provider: provider?.metadata.name ?? "deterministic_rules",
    model: provider?.metadata.model ?? null,
    ruleVersion: "v1",
    run: { mode, itemCount: items.length },
    metrics,
    byDocument: Object.fromEntries(documentRuns.map((entry) => [
      entry.documentId,
      computeAutoReviewEval(entry.gold, { mode: entry.run.mode, items: entry.run.items }),
    ])),
    cases: classifyCases(gold, items),
    gate: {
      meetsPilotGate: metrics.meetsPilotGate,
      label: mode === "rules_only" ? "rules_only baseline" : "hybrid pilot gate",
      thresholds: {
        severeRecall: ">=0.90",
        severeMissRate: "<=0.10",
        falsePositiveRate: "<=0.15",
        localizationAccuracy: ">=0.95",
        unavailableRate: "<=0.05",
        requiredMode: "hybrid",
      },
    },
  };

  const outputDir = path.join(
    process.cwd(),
    "debug",
    "auto-review-eval",
    generatedAt.replace(/[:.]/g, "-"),
  );
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "summary.md"), renderMarkdown(summary), "utf8");
  console.log(`Auto-review Eval report: ${outputDir}`);
  console.log(`Mode: ${mode}`);
  console.log(`Pilot gate: ${metrics.meetsPilotGate ? "PASS" : "FAIL"}`);
  if (!metrics.meetsPilotGate) process.exitCode = 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(args) {
  let corpusPath;
  let mode = "hybrid";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--mode") {
      mode = args[++index];
    } else if (!corpusPath) {
      corpusPath = args[index];
    } else {
      throw new Error(`unexpected_argument:${args[index]}`);
    }
  }
  if (!corpusPath) throw new Error("usage: npm.cmd run eval:auto-review -- <labels.json> [--mode hybrid|rules_only]");
  if (mode !== "hybrid" && mode !== "rules_only") throw new Error(`invalid_eval_mode:${mode}`);
  return { corpusPath, mode };
}

function validateCorpus(value, corpusPath) {
  if (!isRecord(value) || !nonEmptyString(value.datasetVersion) || !Array.isArray(value.documents)
    || value.documents.length === 0) {
    throw new Error("invalid_auto_review_eval_corpus");
  }
  const ids = new Set();
  for (const document of value.documents) {
    if (!isRecord(document) || !nonEmptyString(document.documentId)
      || !Array.isArray(document.items) || document.items.length === 0) {
      throw new Error("invalid_auto_review_eval_document");
    }
    for (const item of document.items) {
      validateCorpusItem(item, corpusPath, ids);
    }
  }
  return value;
}

function validateCorpusItem(item, corpusPath, ids) {
  if (!isRecord(item) || !nonEmptyString(item.auditItemId) || ids.has(item.auditItemId)) {
    throw new Error("invalid_or_duplicate_audit_item_id");
  }
  ids.add(item.auditItemId);
  if (!nonEmptyString(item.sourceImagePath)
    || !fs.existsSync(path.resolve(path.dirname(corpusPath), item.sourceImagePath))) {
    throw new Error(`missing_source_image:${item.auditItemId}`);
  }
  if (!isAuditReviewItem(item.parsedItem) || item.parsedItem.auditItemId !== item.auditItemId) {
    throw new Error(`invalid_parsed_item:${item.auditItemId}`);
  }
  if (item.trueStatus !== "issue" && item.trueStatus !== "clean") {
    throw new Error(`invalid_true_status:${item.auditItemId}`);
  }
  if (!["severe", "non_severe", "none"].includes(item.severity)) {
    throw new Error(`invalid_severity:${item.auditItemId}`);
  }
  if (!Array.isArray(item.issueTypes) || !item.issueTypes.every((type) => ISSUE_TYPES.has(type))) {
    throw new Error(`invalid_issue_types:${item.auditItemId}`);
  }
  if (item.trueStatus === "clean" && (item.severity !== "none" || item.issueTypes.length > 0)) {
    throw new Error(`inconsistent_clean_label:${item.auditItemId}`);
  }
  if (!isRecord(item.correctSource) || !positivePage(item.correctSource.pageStart)) {
    throw new Error(`invalid_correct_source:${item.auditItemId}`);
  }
}

function isAuditReviewItem(value) {
  return isRecord(value)
    && nonEmptyString(value.auditItemId)
    && typeof value.objectType === "string"
    && typeof value.title === "string"
    && typeof value.content === "string"
    && Array.isArray(value.warnings)
    && typeof value.selectedForReview === "boolean"
    && isRecord(value.source)
    && Array.isArray(value.source.blockIds)
    && Array.isArray(value.source.chunkIds);
}

function combinedMode(modes) {
  if (modes.every((mode) => mode === "hybrid")) return "hybrid";
  if (modes.every((mode) => mode === "rules_only")) return "rules_only";
  if (modes.every((mode) => mode === "unavailable")) return "unavailable";
  return "partial";
}

function classifyCases(gold, items) {
  const actualById = new Map(items.map((item) => [item.auditItemId, item]));
  const cases = { falseNegatives: [], falsePositives: [], unavailable: [] };
  for (const expected of gold) {
    const observed = actualById.get(expected.auditItemId);
    const detail = {
      auditItemId: expected.auditItemId,
      correctSource: expected.correctSource,
      actualSource: observed?.source,
    };
    if (!observed || observed.status === "unavailable"
      || observed.mode === "partial" || observed.mode === "unavailable") {
      cases.unavailable.push(detail);
    } else if (expected.trueStatus === "issue" && observed.status !== "suspected_issue") {
      cases.falseNegatives.push(detail);
    } else if (expected.trueStatus === "clean" && observed.status === "suspected_issue") {
      cases.falsePositives.push(detail);
    }
  }
  return cases;
}

function renderMarkdown(summary) {
  const metrics = summary.metrics;
  const issueRows = Object.entries(metrics.byIssueType).map(([issueType, detail]) =>
    `| ${issueType} | ${detail.tp} | ${detail.fp} | ${detail.fn} | ${detail.precision} | ${detail.recall} |`
  ).join("\n");
  return `# Automatic Review Eval\n\n`
    + `- Dataset: ${summary.datasetVersion}\n`
    + `- Generated: ${summary.generatedAt}\n`
    + `- Provider: ${summary.provider}\n`
    + `- Model: ${summary.model ?? "n/a"}\n`
    + `- Rule version: ${summary.ruleVersion}\n`
    + `- Mode: ${summary.run.mode}\n`
    + `- Gate label: ${summary.gate.label}\n`
    + `- Pilot gate: ${summary.gate.meetsPilotGate ? "PASS" : "FAIL"}\n\n`
    + `## Metrics\n\n`
    + `- Severe recall: ${metrics.severeRecall}\n`
    + `- Severe miss rate: ${metrics.severeMissRate}\n`
    + `- False-positive rate: ${metrics.falsePositiveRate}\n`
    + `- Localization accuracy: ${metrics.localizationAccuracy}\n`
    + `- Unavailable rate: ${metrics.unavailableRate}\n`
    + `- Confusion: TP=${metrics.confusion.tp}, FP=${metrics.confusion.fp}, TN=${metrics.confusion.tn}, FN=${metrics.confusion.fn}, unavailable=${metrics.confusion.unavailable}\n\n`
    + `## Issue types\n\n`
    + `| Type | TP | FP | FN | Precision | Recall |\n`
    + `| --- | ---: | ---: | ---: | ---: | ---: |\n`
    + `${issueRows}\n`;
}

function mimeTypeFor(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positivePage(value) {
  return Number.isInteger(value) && value >= 1;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
