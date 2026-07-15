import { createHash } from "node:crypto";

import {
  readArtifact,
  reviewFile,
  writeJsonAtomic,
  type ArtifactStore,
} from "./artifactStore.ts";
import type {
  AuditReviewItem,
  AutoIssueType,
  AutoReviewItemResult,
  HumanReviewItem,
  HumanReviewRound,
} from "./types.ts";

const ISSUE_TYPES = new Set<AutoIssueType>([
  "reading_order_noise",
  "row_boundary_contamination",
  "column_misalignment",
  "merged_cell_scope_error",
  "missing_content",
  "source_mapping_error",
  "semantic_assignment_error",
  "other",
]);

export async function createReviewRound(
  store: ArtifactStore,
  artifactId: string,
  _requesterUserId?: string,
  parentReviewId?: string,
): Promise<HumanReviewRound> {
  const artifact = await requireIntactArtifact(store, artifactId);
  const parent = parentReviewId
    ? artifact.reviewRounds.find((round) => round.reviewId === parentReviewId)
    : undefined;
  if (parentReviewId && !parent) throw new Error("parent_review_not_found");
  if (parent && !parent.finalizedAt) throw new Error("parent_review_not_finalized");

  const reviewId = store.createReviewId();
  const reviewItems = artifact.manifest.reviewItems ?? [];
  const samplingPlan = buildSamplingPlan(
    reviewItems,
    artifact.autoReview.items,
    reviewId,
    parent?.samplingPlan.lowRiskSampleItemIds.length ?? 1,
  );
  const round: HumanReviewRound = {
    reviewId,
    artifactId,
    parentReviewId,
    status: "pending",
    samplingPlan,
    items: [],
  };
  await writeJsonAtomic(reviewFile(store, artifactId, reviewId), round, true);
  return round;
}

export async function saveReviewDraft(
  store: ArtifactStore,
  artifactId: string,
  reviewId: string,
  reviewerUserId: string,
  items: HumanReviewItem[],
): Promise<HumanReviewRound> {
  const { round, reviewItems } = await loadWritableRound(store, artifactId, reviewId, reviewerUserId);
  validateHumanItems(items, reviewItems);
  const now = store.now();
  const updated: HumanReviewRound = {
    ...round,
    reviewerUserId: round.reviewerUserId ?? reviewerUserId,
    status: "draft",
    startedAt: round.startedAt ?? now,
    updatedAt: now,
    items,
  };
  await writeJsonAtomic(reviewFile(store, artifactId, reviewId), updated);
  return updated;
}

export async function finalizeReviewRound(
  store: ArtifactStore,
  artifactId: string,
  reviewId: string,
  reviewerUserId: string,
  items: HumanReviewItem[],
): Promise<HumanReviewRound> {
  const { round, reviewItems } = await loadWritableRound(store, artifactId, reviewId, reviewerUserId);
  validateHumanItems(items, reviewItems);
  const completedIds = new Set(items.map((item) => item.auditItemId));
  if (round.samplingPlan.requiredItemIds.some((itemId) => !completedIds.has(itemId))) {
    throw new Error("required_items_incomplete");
  }
  const now = store.now();
  const finalized: HumanReviewRound = {
    ...round,
    reviewerUserId: round.reviewerUserId ?? reviewerUserId,
    status: items.some((item) => item.status === "issue") ? "issues_found" : "passed",
    startedAt: round.startedAt ?? now,
    updatedAt: now,
    finalizedAt: now,
    items,
  };
  await writeJsonAtomic(reviewFile(store, artifactId, reviewId), finalized);
  return finalized;
}

export function buildSamplingPlan(
  items: AuditReviewItem[],
  results: AutoReviewItemResult[],
  reviewId: string,
  lowRiskSampleSize: number,
): HumanReviewRound["samplingPlan"] {
  const resultById = new Map(results.map((result) => [result.auditItemId, result]));
  const required = new Set<string>();
  for (const item of items) {
    const result = resultById.get(item.auditItemId);
    if (
      item.selectedForReview && item.selectionReason !== "stable_sample"
      || result?.riskLevel === "high"
      || result?.mode === "partial"
      || result?.mode === "unavailable"
      || result?.status === "unavailable"
    ) {
      required.add(item.auditItemId);
    }
  }
  const lowRiskSampleItemIds = items
    .filter((item) => !required.has(item.auditItemId))
    .filter((item) => (resultById.get(item.auditItemId)?.riskLevel ?? "low") === "low")
    .map((item) => ({ itemId: item.auditItemId, hash: stableHash(`${reviewId}${item.auditItemId}`) }))
    .sort((left, right) => left.hash.localeCompare(right.hash) || left.itemId.localeCompare(right.itemId))
    .slice(0, Math.max(0, lowRiskSampleSize))
    .map(({ itemId }) => itemId);
  for (const itemId of lowRiskSampleItemIds) required.add(itemId);
  return {
    requiredItemIds: [...required].sort(),
    lowRiskSampleItemIds,
  };
}

async function loadWritableRound(
  store: ArtifactStore,
  artifactId: string,
  reviewId: string,
  reviewerUserId: string,
): Promise<{ round: HumanReviewRound; reviewItems: AuditReviewItem[] }> {
  if (!reviewerUserId.trim()) throw new Error("reviewer_required");
  const artifact = await requireIntactArtifact(store, artifactId);
  const round = artifact.reviewRounds.find((entry) => entry.reviewId === reviewId);
  if (!round) throw new Error("review_not_found");
  if (round.finalizedAt) throw new Error("review_finalized");
  if (round.reviewerUserId && round.reviewerUserId !== reviewerUserId) {
    throw new Error("review_owned_by_another_user");
  }
  return { round, reviewItems: artifact.manifest.reviewItems ?? [] };
}

async function requireIntactArtifact(store: ArtifactStore, artifactId: string) {
  const artifact = await readArtifact(store, artifactId);
  if (!artifact.integrity.ok) throw new Error("artifact_integrity_failed");
  return artifact;
}

function validateHumanItems(items: HumanReviewItem[], availableItems: AuditReviewItem[]): void {
  const validIds = new Set(availableItems.map((item) => item.auditItemId));
  const seen = new Set<string>();
  for (const item of items) {
    if (!validIds.has(item.auditItemId) || seen.has(item.auditItemId)) {
      throw new Error("invalid_audit_item");
    }
    seen.add(item.auditItemId);
    if (item.comment.length > 2000) throw new Error("review_comment_too_long");
    if (item.status === "issue") {
      if (!item.comment.trim() || item.issueTypes.length === 0 || item.issueTypes.some((type) => !ISSUE_TYPES.has(type))) {
        throw new Error("issue_details_required");
      }
    }
  }
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
