import {
  REVIEW_ISSUE_TYPES,
  type AuditManifest,
  type ReviewIssueType,
  type ReviewResult,
  type ReviewResultItem,
} from "./types.ts";

export class ReviewSubmissionError extends Error {
  public readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409) {
    super(message);
    this.status = status;
  }
}

function parseItems(
  body: unknown,
  manifest: AuditManifest
): ReviewResultItem[] {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    throw new ReviewSubmissionError("审核请求格式无效", 400);
  }

  const allowedIds = new Set(
    manifest.items.map((item) => item.auditItemId)
  );
  const issueTypes = new Set<string>(REVIEW_ISSUE_TYPES);
  const seen = new Set<string>();

  return (body as { items: unknown[] }).items.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new ReviewSubmissionError("审核项格式无效", 400);
    }

    const item = raw as Record<string, unknown>;
    const auditItemId =
      typeof item.auditItemId === "string" ? item.auditItemId : "";
    if (!allowedIds.has(auditItemId) || seen.has(auditItemId)) {
      throw new ReviewSubmissionError("审核项不存在或重复", 400);
    }
    seen.add(auditItemId);

    if (item.status !== "passed" && item.status !== "issue") {
      throw new ReviewSubmissionError("审核状态无效", 400);
    }

    const rawTypes = Array.isArray(item.issueTypes) ? item.issueTypes : [];
    if (
      !rawTypes.every(
        (value) => typeof value === "string" && issueTypes.has(value)
      )
    ) {
      throw new ReviewSubmissionError("问题类型无效", 400);
    }
    if (new Set(rawTypes).size !== rawTypes.length) {
      throw new ReviewSubmissionError("问题类型重复", 400);
    }

    const comment =
      typeof item.comment === "string" ? item.comment.trim() : "";
    if (comment.length > 2000) {
      throw new ReviewSubmissionError("备注不能超过 2000 字", 400);
    }
    if (item.status === "issue" && (!rawTypes.length || !comment)) {
      throw new ReviewSubmissionError(
        "问题项必须选择问题类型并填写备注",
        400
      );
    }

    return {
      auditItemId,
      status: item.status,
      issueTypes:
        item.status === "issue" ? (rawTypes as ReviewIssueType[]) : [],
      comment: item.status === "issue" ? comment : "",
    };
  });
}

export function applyReviewSubmission(input: {
  manifest: AuditManifest;
  current: ReviewResult;
  reviewerUserId: string;
  now: string;
  body: unknown;
}): ReviewResult {
  if (input.current.schemaVersion !== 1) {
    throw new ReviewSubmissionError("审核结果版本无效", 409);
  }
  if (
    input.current.status !== "pending" &&
    input.current.status !== "draft" &&
    input.current.status !== "passed" &&
    input.current.status !== "issues_found"
  ) {
    throw new ReviewSubmissionError("审核结果状态无效", 409);
  }
  if (
    input.current.status === "passed" ||
    input.current.status === "issues_found" ||
    input.current.finalizedAt !== undefined
  ) {
    throw new ReviewSubmissionError("审核结果已提交", 409);
  }

  const reviewerUserId = input.reviewerUserId.trim();
  if (!reviewerUserId) {
    throw new ReviewSubmissionError("审核用户无效", 400);
  }
  const reviewTime = new Date(input.now);
  if (
    !input.now ||
    Number.isNaN(reviewTime.getTime()) ||
    reviewTime.toISOString() !== input.now
  ) {
    throw new ReviewSubmissionError("审核时间无效", 400);
  }

  const currentReviewerUserId = input.current.reviewerUserId?.trim();
  if (
    currentReviewerUserId &&
    currentReviewerUserId !== reviewerUserId
  ) {
    throw new ReviewSubmissionError("审核草稿已由其他用户领取", 409);
  }

  const body = input.body as { action?: unknown };
  if (body?.action !== "save_draft" && body?.action !== "finalize") {
    throw new ReviewSubmissionError("审核动作无效", 400);
  }

  const items = parseItems(input.body, input.manifest);
  if (body.action === "finalize") {
    const reviewed = new Set(items.map((item) => item.auditItemId));
    const missing = input.manifest.items.some(
      (item) => item.selectedForReview && !reviewed.has(item.auditItemId)
    );
    if (missing) {
      throw new ReviewSubmissionError("重点审核项尚未全部完成", 400);
    }
  }

  const startedAt = input.current.startedAt ?? input.now;
  const hasIssues = items.some((item) => item.status === "issue");
  return {
    schemaVersion: 1,
    artifactId: input.manifest.artifactId,
    reviewerUserId,
    status:
      body.action === "save_draft"
        ? "draft"
        : hasIssues
          ? "issues_found"
          : "passed",
    startedAt,
    updatedAt: input.now,
    finalizedAt: body.action === "finalize" ? input.now : undefined,
    items,
  };
}
