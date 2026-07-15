import type {
  AuditReviewItem,
  AutoReviewItemResult,
  AutoReviewRun,
  HumanReviewRound,
} from "./types.ts";

export type ReviewFilter = "problems" | "focus" | "unreviewed" | "all";

export interface ReviewViewItem {
  item: AuditReviewItem;
  automatic?: AutoReviewItemResult;
}

export interface ReviewSummary {
  autoReviewedBy: string;
  humanReviewer: string;
  focusCompleted: number;
  focusTotal: number;
  autoSuspectedCount: number;
  humanConfirmedCount: number;
  automaticConclusion: string;
  humanConclusion: string;
}

export function buildReviewSummary(input: {
  reviewItems: AuditReviewItem[];
  autoRun: AutoReviewRun;
  round?: HumanReviewRound;
  humanReviewerName?: string;
}): ReviewSummary {
  const reviewedIds = new Set(input.round?.items.map((item) => item.auditItemId) ?? []);
  const focusItems = input.reviewItems.filter((item) => item.selectedForReview);
  return {
    autoReviewedBy: input.autoRun.provider?.name ?? "Auto Review Agent v1",
    humanReviewer: input.humanReviewerName ?? input.round?.reviewerUserId ?? "尚未分配",
    focusCompleted: focusItems.filter((item) => reviewedIds.has(item.auditItemId)).length,
    focusTotal: focusItems.length,
    autoSuspectedCount: input.autoRun.items.filter((item) => item.status === "suspected_issue").length,
    humanConfirmedCount: input.round?.items.filter((item) => item.status === "issue").length ?? 0,
    automaticConclusion: automaticConclusion(input.autoRun),
    humanConclusion: humanConclusion(input.round),
  };
}

export function defaultReviewFilter(autoRun: AutoReviewRun): ReviewFilter {
  return autoRun.items.some((item) => item.status === "suspected_issue") ? "problems" : "focus";
}

export function filterReviewItems(
  items: ReviewViewItem[],
  round: HumanReviewRound | undefined,
  filter: ReviewFilter,
): ReviewViewItem[] {
  if (filter === "all") return items;
  const reviewedIds = new Set(round?.items.map((item) => item.auditItemId) ?? []);
  if (filter === "problems") {
    return items.filter(({ automatic }) => automatic?.status === "suspected_issue");
  }
  if (filter === "focus") return items.filter(({ item }) => item.selectedForReview);
  return items.filter(({ item }) => !reviewedIds.has(item.auditItemId));
}

export function sortReviewItems(items: ReviewViewItem[]): ReviewViewItem[] {
  return [...items].sort((left, right) =>
    (right.automatic?.riskScore ?? 0) - (left.automatic?.riskScore ?? 0)
    || number(left.item.source.pageStart) - number(right.item.source.pageStart)
    || (left.item.source.tableId ?? "").localeCompare(right.item.source.tableId ?? "")
    || number(left.item.source.rowIndex) - number(right.item.source.rowIndex)
    || left.item.auditItemId.localeCompare(right.item.auditItemId)
  );
}

export function nextProblemItemId(
  items: ReviewViewItem[],
  round?: HumanReviewRound,
): string | undefined {
  const reviewedIds = new Set(round?.items.map((item) => item.auditItemId) ?? []);
  return sortReviewItems(items)
    .find(({ item, automatic }) =>
      automatic?.status === "suspected_issue" && !reviewedIds.has(item.auditItemId)
    )?.item.auditItemId;
}

export function isReviewReadOnly(round?: HumanReviewRound): boolean {
  return Boolean(round?.finalizedAt || round?.status === "passed" || round?.status === "issues_found");
}

function automaticConclusion(autoRun: AutoReviewRun): string {
  if (autoRun.summary.status !== "completed" || autoRun.summary.unavailableCount > 0) {
    return "自动审核未完整完成";
  }
  if (autoRun.summary.suspectedCount > 0) return "发现疑似问题，待人工确认";
  return "未发现疑似问题";
}

function humanConclusion(round?: HumanReviewRound): string {
  if (!round) return "尚未开始";
  if (round.status === "passed") return "人工审核通过";
  if (round.status === "issues_found") return "人工确认存在问题";
  return "审核中";
}

function number(value?: number): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}
