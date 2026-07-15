import type { ReviewStatus } from "./types.ts";

export type ReviewAvailability =
  | { canSubmit: true }
  | { canSubmit: false; error: string };

export function evaluateReviewAvailability(input: {
  integrityOk: boolean;
  sourceMatches: boolean;
  status: ReviewStatus;
  reviewerUserId?: string;
  requesterUserId: string;
  finalizedAt?: string;
}): ReviewAvailability {
  if (!input.integrityOk) {
    return { canSubmit: false, error: "审核副本完整性校验失败" };
  }
  if (!input.sourceMatches) {
    return { canSubmit: false, error: "原文件已变化，旧快照不能提交" };
  }
  if (
    input.finalizedAt !== undefined ||
    input.status === "passed" ||
    input.status === "issues_found"
  ) {
    return { canSubmit: false, error: "审核结果已提交" };
  }
  const reviewerUserId = input.reviewerUserId?.trim();
  if (
    reviewerUserId &&
    reviewerUserId !== input.requesterUserId.trim()
  ) {
    return { canSubmit: false, error: "审核草稿已由其他用户领取" };
  }
  return { canSubmit: true };
}
