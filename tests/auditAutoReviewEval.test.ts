import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { computeAutoReviewEval } from "../lib/audit/autoReviewEval.ts";
import type {
  AutoReviewItemResult,
  AutoReviewMode,
  AutoIssueType,
} from "../lib/audit/types.ts";

type GoldItem = {
  auditItemId: string;
  trueStatus: "issue" | "clean";
  severity: "severe" | "non_severe" | "none";
  issueTypes: AutoIssueType[];
  correctSource: { pageStart: number; tableId: string; rowIndex: number };
};

const issueTypes: AutoIssueType[] = [
  "reading_order_noise",
  "row_boundary_contamination",
  "missing_content",
  "column_misalignment",
];

function gold(
  auditItemId: string,
  trueStatus: GoldItem["trueStatus"],
  severity: GoldItem["severity"],
  issueType?: AutoIssueType,
): GoldItem {
  const index = Number(auditItemId.slice(1));
  return {
    auditItemId,
    trueStatus,
    severity,
    issueTypes: issueType ? [issueType] : [],
    correctSource: { pageStart: index, tableId: `table-${index}`, rowIndex: index },
  };
}

function actual(
  auditItemId: string,
  status: AutoReviewItemResult["status"],
  riskScore: number,
  predictedTypes: AutoIssueType[] = [],
  sourceMatches = true,
  mode: AutoReviewMode = "hybrid",
): AutoReviewItemResult {
  const index = Number(auditItemId.slice(1));
  return {
    auditItemId,
    status,
    mode,
    riskScore,
    riskLevel: riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low",
    issueTypes: predictedTypes,
    summary: status,
    ruleSignals: [],
    source: {
      pageStart: sourceMatches ? index : 999,
      tableId: `table-${index}`,
      rowIndex: index,
      blockIds: [],
      chunkIds: [],
    },
    reviewedAt: "2026-07-16T00:00:00.000Z",
  };
}

test("computes exact risk eval metrics, localization, and issue-type detail", () => {
  const goldItems = [
    gold("i1", "issue", "severe", issueTypes[0]),
    gold("i2", "issue", "severe", issueTypes[1]),
    gold("i3", "issue", "severe", issueTypes[2]),
    gold("i4", "issue", "non_severe", issueTypes[3]),
    gold("i5", "clean", "none"),
    gold("i6", "clean", "none"),
    gold("i7", "clean", "none"),
    gold("i8", "issue", "non_severe", "other"),
  ];
  const actualItems = [
    actual("i1", "suspected_issue", 90, [issueTypes[0]]),
    actual("i2", "suspected_issue", 80, ["missing_content"], false),
    actual("i3", "clean", 10),
    actual("i4", "suspected_issue", 60, [issueTypes[3]]),
    actual("i5", "suspected_issue", 50, ["other"]),
    actual("i6", "clean", 10),
    actual("i7", "clean", 0),
    actual("i8", "unavailable", 0, [], true, "partial"),
  ];

  const metrics = computeAutoReviewEval(goldItems, { mode: "hybrid", items: actualItems });

  assert.equal(metrics.severeRecall, 2 / 3);
  assert.equal(metrics.severeMissRate, 1 / 3);
  assert.equal(metrics.falsePositiveRate, 1 / 3);
  assert.equal(metrics.localizationAccuracy, 3 / 4);
  assert.equal(metrics.unavailableRate, 1 / 8);
  assert.deepEqual(metrics.confusion, { tp: 3, fp: 1, tn: 2, fn: 1, unavailable: 1 });
  assert.deepEqual(metrics.rawCounts, {
    total: 8,
    severe: 3,
    severeHighRisk: 2,
    clean: 3,
    localizedPredictions: 4,
    correctLocalizations: 3,
    unavailable: 1,
  });
  assert.deepEqual(metrics.byIssueType.reading_order_noise, {
    tp: 1, fp: 0, fn: 0, precision: 1, recall: 1,
  });
  assert.deepEqual(metrics.byIssueType.row_boundary_contamination, {
    tp: 0, fp: 0, fn: 1, precision: 0, recall: 0,
  });
  assert.deepEqual(metrics.byIssueType.missing_content, {
    tp: 0, fp: 1, fn: 1, precision: 0, recall: 0,
  });
  assert.equal(metrics.meetsPilotGate, false);
});

test("hybrid gate requires every threshold and rules-only can never pass", () => {
  const goldItems = [gold("i1", "issue", "severe", "reading_order_noise")];
  const items = [actual("i1", "suspected_issue", 90, ["reading_order_noise"])];

  assert.equal(computeAutoReviewEval(goldItems, { mode: "hybrid", items }).meetsPilotGate, true);
  assert.equal(computeAutoReviewEval(goldItems, { mode: "rules_only", items }).meetsPilotGate, false);
});

test("unavailable severe and clean items remain in their gold denominators", () => {
  const goldItems = [
    gold("i1", "issue", "severe", "missing_content"),
    gold("i2", "clean", "none"),
  ];
  const items = [
    actual("i1", "unavailable", 0, [], true, "partial"),
    actual("i2", "unavailable", 0, [], true, "partial"),
  ];

  const metrics = computeAutoReviewEval(goldItems, { mode: "partial", items });

  assert.equal(metrics.severeRecall, 0);
  assert.equal(metrics.severeMissRate, 1);
  assert.equal(metrics.falsePositiveRate, 0);
  assert.equal(metrics.rawCounts.severe, 1);
  assert.equal(metrics.rawCounts.clean, 1);
  assert.equal(metrics.unavailableRate, 1);
});

test("CLI validates a versioned corpus, labels rules-only as baseline, writes reports, and exits 2", () => {
  const workDir = mkdtempSync(join(tmpdir(), "auto-review-eval-"));
  const fixtureDir = join(workDir, "fixture");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, "page-1.png"), Buffer.from([0]));
  const parsedItem = {
    auditItemId: "i1",
    objectType: "section",
    title: "普通条文",
    content: "普通内容",
    warnings: [],
    selectedForReview: true,
    source: { pageStart: 1, blockIds: [], chunkIds: [] },
  };
  const corpusPath = join(fixtureDir, "gold.json");
  writeFileSync(corpusPath, JSON.stringify({
    datasetVersion: "test-v1",
    documents: [{
      documentId: "doc-1",
      items: [{
        auditItemId: "i1",
        partition: "blind",
        reviewer: "reviewer-1",
        reviewedAt: "2026-07-16T00:00:00.000Z",
        evidence: "人工核对原页，内容一致。",
        sourceImagePath: "page-1.png",
        sourceImageSha256: "6E340B9CFFB37A989CA544E6BB780A2C78901D3FB33738768511A30617AFA01D",
        parsedItem,
        trueStatus: "clean",
        severity: "none",
        issueTypes: [],
        correctSource: { pageStart: 1 },
      }],
    }],
  }));

  const scriptPath = fileURLToPath(new URL("../scripts/run_auto_review_eval.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    corpusPath,
    "--mode",
    "rules_only",
  ], { cwd: workDir, encoding: "utf8" });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const reportRoot = join(workDir, "debug", "auto-review-eval");
  const reportDir = join(reportRoot, readdirSync(reportRoot)[0]);
  const summary = JSON.parse(readFileSync(join(reportDir, "summary.json"), "utf8"));
  const markdown = readFileSync(join(reportDir, "summary.md"), "utf8");
  assert.equal(summary.datasetVersion, "test-v1");
  assert.equal(summary.run.mode, "rules_only");
  assert.equal(summary.gate.meetsPilotGate, false);
  assert.equal(summary.gate.label, "rules_only baseline");
  assert.match(markdown, /rules_only baseline/);
});

test("CLI rejects corpus items missing Task 9 review metadata", () => {
  const workDir = mkdtempSync(join(tmpdir(), "auto-review-eval-metadata-"));
  const fixtureDir = join(workDir, "fixture");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, "page-1.png"), Buffer.from([0]));
  const corpusPath = join(fixtureDir, "gold.json");
  writeFileSync(corpusPath, JSON.stringify({
    datasetVersion: "test-v1",
    documents: [{
      documentId: "doc-1",
      items: [{
        auditItemId: "i1",
        sourceImagePath: "page-1.png",
        parsedItem: {
          auditItemId: "i1",
          objectType: "section",
          title: "普通条文",
          content: "普通内容",
          warnings: [],
          selectedForReview: true,
          source: { pageStart: 1, blockIds: [], chunkIds: [] },
        },
        trueStatus: "clean",
        severity: "none",
        issueTypes: [],
        correctSource: { pageStart: 1 },
      }],
    }],
  }));

  const scriptPath = fileURLToPath(new URL("../scripts/run_auto_review_eval.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    corpusPath,
    "--mode",
    "rules_only",
  ], { cwd: workDir, encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /invalid_review_metadata:i1/);
});
