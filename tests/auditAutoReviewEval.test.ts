import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeAutoReviewEval } from "../lib/audit/autoReviewEval.ts";
import type {
  AuditReviewItem,
  AutoReviewItemResult,
  AutoReviewRun,
} from "../lib/audit/types.ts";

type GoldItem = Parameters<typeof computeAutoReviewEval>[0][number];

function gold(
  auditItemId: string,
  trueStatus: "clean" | "issue",
  severity: "severe" | "non_severe" | "none",
  issueTypes: GoldItem["issueTypes"] = [],
): GoldItem {
  return {
    auditItemId,
    documentId: "doc-1",
    trueStatus,
    severity,
    issueTypes,
    correctSourceLocation: { pageStart: 1, tableId: "table-1", rowIndex: 0 },
  };
}

function actual(
  auditItemId: string,
  status: AutoReviewItemResult["status"],
  riskScore: number,
  issueTypes: AutoReviewItemResult["issueTypes"] = [],
  source = { pageStart: 1, tableId: "table-1", rowIndex: 0, blockIds: [], chunkIds: [] },
): AutoReviewItemResult {
  return {
    auditItemId,
    status,
    mode: status === "unavailable" ? "partial" : "hybrid",
    riskScore,
    riskLevel: riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low",
    issueTypes,
    summary: status,
    ruleSignals: [],
    source,
    reviewedAt: "2026-07-16T00:00:00.000Z",
    ...(status === "unavailable" ? { unavailableReason: "provider_error" } : {}),
  };
}

function run(items: AutoReviewItemResult[], mode: AutoReviewRun["mode"] = "hybrid"): AutoReviewRun {
  return {
    runId: "run-1",
    artifactId: "artifact-1",
    mode,
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:00:01.000Z",
    items,
    summary: {
      status: mode === "hybrid" ? "completed" : "unavailable",
      reviewedCount: items.filter((item) => item.status !== "unavailable").length,
      suspectedCount: items.filter((item) => item.status === "suspected_issue").length,
      unavailableCount: items.filter((item) => item.status === "unavailable").length,
    },
  };
}

test("computeAutoReviewEval returns exact 8-item matrix and unrounded rates", () => {
  const labels = [
    gold("severe-tp-1", "issue", "severe", ["reading_order_noise"]),
    gold("severe-tp-2", "issue", "severe", ["row_boundary_contamination"]),
    gold("severe-fn", "issue", "severe", ["column_misalignment"]),
    gold("normal-tp", "issue", "non_severe", ["semantic_assignment_error"]),
    gold("clean-fp", "clean", "none"),
    gold("clean-tn-1", "clean", "none"),
    gold("clean-tn-2", "clean", "none"),
    gold("unavailable", "issue", "non_severe", ["missing_content"]),
  ];
  const metrics = computeAutoReviewEval(labels, run([
    actual("severe-tp-1", "suspected_issue", 90, ["reading_order_noise"]),
    actual("severe-tp-2", "suspected_issue", 75, ["row_boundary_contamination"]),
    actual("severe-fn", "clean", 20),
    actual("normal-tp", "suspected_issue", 55, ["semantic_assignment_error"]),
    actual("clean-fp", "suspected_issue", 45, ["other"]),
    actual("clean-tn-1", "clean", 10),
    actual("clean-tn-2", "clean", 5),
    actual("unavailable", "unavailable", 0),
  ]));

  assert.equal(metrics.severeRecall, 2 / 3);
  assert.equal(metrics.severeMissRate, 1 / 3);
  assert.equal(metrics.falsePositiveRate, 1 / 3);
  assert.equal(metrics.unavailableRate, 1 / 8);
  assert.equal(metrics.localizationAccuracy, 1);
  assert.deepEqual(metrics.confusion, { tp: 3, fp: 1, tn: 2, fn: 1, unavailable: 1 });
  assert.deepEqual(metrics.issueTypes.reading_order_noise, { tp: 1, fp: 0, fn: 0 });
  assert.deepEqual(metrics.issueTypes.missing_content, { tp: 0, fp: 0, fn: 1 });
  assert.deepEqual(metrics.findings.falseNegatives.map((item) => item.auditItemId), ["severe-fn"]);
  assert.deepEqual(metrics.findings.falsePositives.map((item) => item.auditItemId), ["clean-fp"]);
  assert.deepEqual(metrics.findings.unavailable.map((item) => item.auditItemId), ["unavailable"]);
  assert.deepEqual(metrics.findings.falsePositives[0].source, {
    pageStart: 1,
    tableId: "table-1",
    rowIndex: 0,
    blockIds: [],
    chunkIds: [],
  });
  assert.equal(metrics.meetsPilotGate, false);
});

test("pilot gate requires every threshold and hybrid mode", () => {
  const labels = [gold("severe", "issue", "severe", ["missing_content"]), gold("clean", "clean", "none")];
  const items = [
    actual("severe", "suspected_issue", 80, ["missing_content"]),
    actual("clean", "clean", 5),
  ];
  assert.equal(computeAutoReviewEval(labels, run(items, "hybrid")).meetsPilotGate, true);
  assert.equal(computeAutoReviewEval(labels, run(items, "rules_only")).meetsPilotGate, false);
});

test("eval CLI writes JSON and Markdown reports and exits 2 for rules-only baseline", () => {
  const directory = mkdtempSync(join(tmpdir(), "auto-review-eval-"));
  try {
    const labelsPath = join(directory, "labels.json");
    const parsedItem: AuditReviewItem = {
      auditItemId: "item-1",
      objectType: "section",
      title: "普通段落",
      content: "普通内容",
      warnings: [],
      selectedForReview: true,
      source: { pageStart: 1, blockIds: [], chunkIds: [] },
    };
    writeFileSync(labelsPath, JSON.stringify({
      datasetVersion: "test-v1",
      documents: [{ documentId: "doc-1", fileName: "fixture.pdf" }],
      items: [{
        auditItemId: "item-1",
        documentId: "doc-1",
        sourceImagePath: "unused.png",
        parsedItem,
        trueStatus: "issue",
        severity: "severe",
        issueTypes: ["missing_content"],
        correctSourceLocation: { pageStart: 1 },
      }],
    }), "utf8");

    const script = fileURLToPath(new URL("../scripts/run_auto_review_eval.mjs", import.meta.url));
    let exitStatus: number | undefined;
    let stderr = "";
    try {
      execFileSync(process.execPath, ["--experimental-strip-types", script, labelsPath], {
        cwd: directory,
        env: { ...process.env, AUTO_REVIEW_ENABLED: "0" },
        stdio: "pipe",
      });
    } catch (error) {
      const executionError = error as { status?: number; stderr?: Buffer };
      exitStatus = executionError.status;
      stderr = executionError.stderr?.toString("utf8") ?? "";
    }
    assert.equal(exitStatus, 2, stderr);

    const outputRoot = join(directory, "debug", "auto-review-eval");
    const reportDirectory = join(outputRoot, readdirSync(outputRoot)[0]);
    const summary = JSON.parse(readFileSync(join(reportDirectory, "summary.json"), "utf8"));
    assert.equal(summary.run.mode, "rules_only");
    assert.equal(summary.metrics.meetsPilotGate, false);
    const markdown = readFileSync(join(reportDirectory, "summary.md"), "utf8");
    assert.match(markdown, /rules_only baseline/);
    assert.match(markdown, /## Findings/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
