import type { ReviewArtifactSummary, ReviewStatus } from "./types.ts";

export type ReviewStatusPresentation = {
  label: string;
  variant: "warning" | "info" | "success" | "destructive";
};

const REVIEW_STATUS_PRESENTATION: Record<
  ReviewStatus,
  ReviewStatusPresentation
> = {
  pending: { label: "待审核", variant: "warning" },
  draft: { label: "审核中", variant: "info" },
  passed: { label: "审核通过", variant: "success" },
  issues_found: { label: "发现问题", variant: "destructive" },
};

export function reviewStatusMeta(
  status: ReviewStatus
): ReviewStatusPresentation {
  return REVIEW_STATUS_PRESENTATION[status];
}

const REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending",
  "draft",
  "passed",
  "issues_found",
];

function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    typeof value === "string" &&
    REVIEW_STATUSES.some((status) => status === value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseReviewArtifactSummaries(
  value: unknown
): ReviewArtifactSummary[] {
  if (!Array.isArray(value)) throw new Error("审核副本数据无效");

  return value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("审核副本数据无效");
    }
    const record = item as Record<string, unknown>;
    if (
      !isNonEmptyString(record.documentId) ||
      !isNonEmptyString(record.artifactId) ||
      !isNonEmptyString(record.generatedAt) ||
      Number.isNaN(Date.parse(record.generatedAt)) ||
      !isReviewStatus(record.status) ||
      !isNonNegativeFiniteNumber(record.focusItemCount) ||
      !isNonNegativeFiniteNumber(record.issueCount) ||
      ("reviewerUserId" in record &&
        typeof record.reviewerUserId !== "string") ||
      ("finalizedAt" in record && typeof record.finalizedAt !== "string")
    ) {
      throw new Error("审核副本数据无效");
    }

    const summary: ReviewArtifactSummary = {
      documentId: record.documentId,
      artifactId: record.artifactId,
      generatedAt: record.generatedAt,
      status: record.status,
      focusItemCount: record.focusItemCount,
      issueCount: record.issueCount,
    };
    if (typeof record.reviewerUserId === "string") {
      summary.reviewerUserId = record.reviewerUserId;
    }
    if (typeof record.finalizedAt === "string") {
      summary.finalizedAt = record.finalizedAt;
    }
    return summary;
  });
}
