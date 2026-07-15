import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createArtifactStore, writeArtifactAtomic } from "../lib/audit/artifactStore.ts";
import {
  createReviewRound,
  finalizeReviewRound,
  saveReviewDraft,
} from "../lib/audit/reviewRounds.ts";
import type {
  AuditManifest,
  AuditReviewItem,
  AutoReviewRun,
  HumanReviewItem,
  HumanReviewRound,
} from "../lib/audit/types.ts";

function reviewItem(auditItemId: string, selectedForReview = false): AuditReviewItem {
  return {
    auditItemId,
    objectType: "plain_section",
    title: auditItemId,
    content: "内容",
    warnings: [],
    selectedForReview,
    selectionReason: selectedForReview ? "table_coverage" : undefined,
    source: { blockIds: [], chunkIds: [] },
  };
}

async function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rounds-"));
  let nextId = 2;
  const store = createArtifactStore({
    rootDir,
    docId: "doc-1",
    now: () => "2026-07-16T01:00:00.000Z",
    createReviewId: () => `review-${nextId++}`,
  });
  const manifest: AuditManifest = {
    artifactId: "artifact-1",
    docId: "doc-1",
    documentFileName: "pilot.pdf",
    sourceFileSha256: "source-hash",
    createdAt: "2026-07-16T00:00:00.000Z",
    files: {},
    reviewItems: [
      reviewItem("high"),
      reviewItem("focus", true),
      reviewItem("partial"),
      reviewItem("low-a"),
      reviewItem("low-b"),
    ],
  };
  const autoReview: AutoReviewRun = {
    runId: "run-1",
    artifactId: "artifact-1",
    mode: "partial",
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:00:01.000Z",
    items: [
      autoResult("high", 80, "hybrid", "suspected_issue"),
      autoResult("focus", 10, "hybrid", "clean"),
      autoResult("partial", 0, "partial", "unavailable"),
      autoResult("low-a", 10, "hybrid", "clean"),
      autoResult("low-b", 10, "hybrid", "clean"),
    ],
    summary: { status: "partial", reviewedCount: 4, suspectedCount: 1, unavailableCount: 1 },
  };
  const initialReview: HumanReviewRound = {
    reviewId: "review-1",
    artifactId: "artifact-1",
    status: "pending",
    samplingPlan: {
      requiredItemIds: ["focus", "high", "low-a", "partial"],
      lowRiskSampleItemIds: ["low-a"],
    },
    items: [],
  };
  await writeArtifactAtomic(store, {
    manifest,
    reviewMarkdown: "# 审核",
    reviewHtml: "<p>审核</p>",
    autoReview,
    initialReview,
  });
  return { rootDir, store };
}

function autoResult(
  auditItemId: string,
  riskScore: number,
  mode: "hybrid" | "partial",
  status: "clean" | "suspected_issue" | "unavailable",
): AutoReviewRun["items"][number] {
  return {
    auditItemId,
    status,
    mode,
    riskScore,
    riskLevel: riskScore >= 70 ? "high" : "low",
    issueTypes: status === "suspected_issue" ? ["other"] : [],
    summary: status,
    ruleSignals: [],
    source: { blockIds: [], chunkIds: [] },
    reviewedAt: "2026-07-16T00:00:01.000Z",
  };
}

function passed(auditItemId: string): HumanReviewItem {
  return {
    auditItemId,
    status: "passed",
    issueTypes: [],
    comment: "",
    reviewedAt: "2026-07-16T01:00:00.000Z",
  };
}

test("validates item IDs, issue detail, required completion, and reviewer ownership", async () => {
  const { store } = await fixture();
  await assert.rejects(
    () => saveReviewDraft(store, "artifact-1", "review-1", "manager-a", [passed("unknown")]),
    /invalid_audit_item/,
  );
  await assert.rejects(
    () => saveReviewDraft(store, "artifact-1", "review-1", "manager-a", [{
      ...passed("high"), status: "issue", issueTypes: [], comment: "",
    }]),
    /issue_details_required/,
  );

  const draft = await saveReviewDraft(
    store,
    "artifact-1",
    "review-1",
    "manager-a",
    [passed("high")],
  );
  assert.equal(draft.status, "draft");
  assert.equal(draft.reviewerUserId, "manager-a");
  assert.equal(draft.startedAt, "2026-07-16T01:00:00.000Z");
  await assert.rejects(
    () => saveReviewDraft(store, "artifact-1", "review-1", "manager-b", [passed("high")]),
    /review_owned_by_another_user/,
  );
  await assert.rejects(
    () => finalizeReviewRound(store, "artifact-1", "review-1", "manager-a", [passed("high")]),
    /required_items_incomplete/,
  );
});

test("finalizes with a derived status, rejects overwrite, and creates an immutable re-review chain", async () => {
  const { store } = await fixture();
  const completeItems: HumanReviewItem[] = [
    passed("high"),
    { ...passed("focus"), status: "issue", issueTypes: ["column_misalignment"], comment: "列值错位" },
    passed("partial"),
    passed("low-a"),
  ];
  const finalized = await finalizeReviewRound(
    store,
    "artifact-1",
    "review-1",
    "manager-a",
    completeItems,
  );
  assert.equal(finalized.status, "issues_found");
  assert.equal(finalized.finalizedAt, "2026-07-16T01:00:00.000Z");
  await assert.rejects(
    () => saveReviewDraft(store, "artifact-1", finalized.reviewId, "manager-a", completeItems),
    /review_finalized/,
  );

  const second = await createReviewRound(
    store,
    "artifact-1",
    "manager-a",
    finalized.reviewId,
  );
  assert.equal(second.parentReviewId, finalized.reviewId);
  assert.notEqual(second.reviewId, finalized.reviewId);
  assert.equal(second.artifactId, finalized.artifactId);
  assert.equal(second.status, "pending");
  assert.equal(second.reviewerUserId, undefined);
  assert.notDeepEqual(second.samplingPlan.lowRiskSampleItemIds, []);
});

test("blocks submission when an immutable static file fails its hash check", async () => {
  const { rootDir, store } = await fixture();
  fs.writeFileSync(path.join(rootDir, "doc-1", "artifact-1", "auto-review.json"), "{}");
  await assert.rejects(
    () => saveReviewDraft(store, "artifact-1", "review-1", "manager-a", [passed("high")]),
    /artifact_integrity_failed/,
  );
});
