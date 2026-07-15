import type { ReviewStatus } from "./types.ts";

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
