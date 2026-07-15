import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReviewSummary,
  defaultReviewFilter,
  filterReviewItems,
  isReviewReadOnly,
  nextProblemItemId,
  sortReviewItems,
  type ReviewViewItem,
} from "../lib/audit/reviewViewModel.ts";
import type {
  AuditReviewItem,
  AutoReviewItemResult,
  AutoReviewRun,
  HumanReviewRound,
} from "../lib/audit/types.ts";

test("separates automatic and human review summary", () => {
  const reviewItems = Array.from({ length: 8 }, (_, index) => item(`focus-${index + 1}`, {
    selectedForReview: true,
  }));
  const autoRun = run(reviewItems.map((entry, index) => result(entry, {
    status: index < 3 ? "suspected_issue" : "clean",
    riskScore: index < 3 ? 70 - index : 10,
  })));
  const round = humanRound({
    reviewerUserId: "user-admin",
    items: reviewItems.slice(0, 5).map((entry, index) => ({
      auditItemId: entry.auditItemId,
      status: index === 0 ? "issue" : "passed",
      issueTypes: index === 0 ? ["column_misalignment"] : [],
      comment: index === 0 ? "列值错位" : "",
      reviewedAt: "2026-07-16T03:00:00.000Z",
    })),
  });

  assert.deepEqual(buildReviewSummary({
    reviewItems,
    autoRun,
    round,
    humanReviewerName: "王磊",
  }), {
    autoReviewedBy: "Auto Review Agent v1",
    humanReviewer: "王磊",
    focusCompleted: 5,
    focusTotal: 8,
    autoSuspectedCount: 3,
    humanConfirmedCount: 1,
    automaticConclusion: "发现疑似问题，待人工确认",
    humanConclusion: "审核中",
  });
});

test("defaults to problems and keeps incomplete automatic review explicit", () => {
  const withIssues = run([result(item("problem"), { status: "suspected_issue", riskScore: 70 })]);
  const clean = run([result(item("clean"), { status: "clean", riskScore: 5 })]);
  const incomplete = run([
    result(item("unavailable"), { status: "unavailable", mode: "partial", riskScore: 0 }),
  ], { status: "partial", unavailableCount: 1 });

  assert.equal(defaultReviewFilter(withIssues), "problems");
  assert.equal(defaultReviewFilter(clean), "focus");
  assert.equal(buildReviewSummary({
    reviewItems: [item("unavailable")],
    autoRun: incomplete,
  }).automaticConclusion, "自动审核未完整完成");
});

test("filters problem, focus, unreviewed, and all memberships", () => {
  const { viewItems, round } = viewFixture();

  assert.deepEqual(ids(filterReviewItems(viewItems, round, "problems")), ["problem-high", "problem-medium"]);
  assert.deepEqual(ids(filterReviewItems(viewItems, round, "focus")), ["problem-high", "focus-clean"]);
  assert.deepEqual(ids(filterReviewItems(viewItems, round, "unreviewed")), ["problem-high", "focus-clean", "unavailable"]);
  assert.deepEqual(ids(filterReviewItems(viewItems, round, "all")), [
    "problem-high",
    "problem-medium",
    "focus-clean",
    "unavailable",
    "ordinary",
  ]);
});

test("sorts by risk then page, table, row, and jumps to highest-risk unreviewed problem", () => {
  const { viewItems, round } = viewFixture();
  const shuffled = [viewItems[4], viewItems[1], viewItems[3], viewItems[2], viewItems[0]];

  assert.deepEqual(ids(sortReviewItems(shuffled)), [
    "problem-high",
    "unavailable",
    "problem-medium",
    "focus-clean",
    "ordinary",
  ]);
  assert.equal(nextProblemItemId(shuffled, round), "problem-high");
});

test("treats finalized rounds as fully read-only", () => {
  assert.equal(isReviewReadOnly(humanRound({ finalizedAt: "2026-07-16T04:00:00.000Z", status: "passed" })), true);
  assert.equal(isReviewReadOnly(humanRound({ status: "draft" })), false);
});

function viewFixture(): { viewItems: ReviewViewItem[]; round: HumanReviewRound } {
  const entries = [
    view("problem-high", { selectedForReview: true, pageStart: 3, tableId: "table-b", rowIndex: 2 }, { status: "suspected_issue", riskScore: 85 }),
    view("problem-medium", { pageStart: 1, tableId: "table-a", rowIndex: 1 }, { status: "suspected_issue", riskScore: 50 }),
    view("focus-clean", { selectedForReview: true, pageStart: 2, tableId: "table-a", rowIndex: 3 }, { status: "clean", riskScore: 10 }),
    view("unavailable", { pageStart: 1, tableId: "table-z", rowIndex: 1 }, { status: "unavailable", mode: "partial", riskScore: 60 }),
    view("ordinary", { pageStart: 2, tableId: "table-z", rowIndex: 4 }, { status: "clean", riskScore: 10 }),
  ];
  const round = humanRound({
    items: ["problem-medium", "ordinary"].map((auditItemId) => ({
      auditItemId,
      status: "passed",
      issueTypes: [],
      comment: "",
      reviewedAt: "2026-07-16T03:00:00.000Z",
    })),
  });
  return { viewItems: entries, round };
}

function view(
  auditItemId: string,
  itemOptions: Partial<AuditReviewItem> & { pageStart?: number; tableId?: string; rowIndex?: number },
  resultOptions: Partial<AutoReviewItemResult>,
): ReviewViewItem {
  const entry = item(auditItemId, {
    selectedForReview: itemOptions.selectedForReview,
    source: {
      pageStart: itemOptions.pageStart,
      tableId: itemOptions.tableId,
      rowIndex: itemOptions.rowIndex,
      blockIds: [],
      chunkIds: [],
    },
  });
  return { item: entry, automatic: result(entry, resultOptions) };
}

function item(auditItemId: string, options: Partial<AuditReviewItem> = {}): AuditReviewItem {
  return {
    auditItemId,
    objectType: "structured_table_row",
    title: auditItemId,
    content: `${auditItemId} content`,
    warnings: [],
    selectedForReview: false,
    source: { blockIds: [], chunkIds: [] },
    ...options,
  };
}

function result(entry: AuditReviewItem, options: Partial<AutoReviewItemResult> = {}): AutoReviewItemResult {
  return {
    auditItemId: entry.auditItemId,
    status: "clean",
    mode: "hybrid",
    riskScore: 0,
    riskLevel: "low",
    issueTypes: [],
    summary: "未发现疑似问题",
    ruleSignals: [],
    source: entry.source,
    reviewedAt: "2026-07-16T01:00:00.000Z",
    ...options,
  };
}

function run(
  items: AutoReviewItemResult[],
  summary: Partial<AutoReviewRun["summary"]> = {},
): AutoReviewRun {
  return {
    runId: "run-1",
    artifactId: "artifact-1",
    mode: items.some((entry) => entry.mode === "partial") ? "partial" : "hybrid",
    provider: { name: "Auto Review Agent v1", model: "glm-4v-flash" },
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T01:00:00.000Z",
    items,
    summary: {
      status: "completed",
      reviewedCount: items.length,
      suspectedCount: items.filter((entry) => entry.status === "suspected_issue").length,
      unavailableCount: items.filter((entry) => entry.status === "unavailable").length,
      ...summary,
    },
  };
}

function humanRound(options: Partial<HumanReviewRound> = {}): HumanReviewRound {
  return {
    reviewId: "review-1",
    artifactId: "artifact-1",
    status: "draft",
    samplingPlan: { requiredItemIds: [], lowRiskSampleItemIds: [] },
    items: [],
    ...options,
  };
}

function ids(items: ReviewViewItem[]): string[] {
  return items.map(({ item: entry }) => entry.auditItemId);
}
