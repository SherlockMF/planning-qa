import { aggregateAutoRisk } from "./riskScore.ts";
import { detectAuditRiskSignals } from "./riskSignals.ts";
import type { AutoReviewProvider, ReviewPageImage } from "./autoReviewProvider.ts";
import type {
  AuditReviewItem,
  AutoReviewItemResult,
  AutoReviewMode,
  AutoReviewRun,
} from "./types.ts";

export interface RunAutoReviewInput {
  artifactId: string;
  items: AuditReviewItem[];
}

export interface RunAutoReviewDependencies {
  provider?: AutoReviewProvider;
  renderPage(pageNumber: number, item: AuditReviewItem): Promise<ReviewPageImage>;
  now?: () => string;
  concurrency?: number;
}

export async function runAutoReview(
  input: RunAutoReviewInput,
  dependencies: RunAutoReviewDependencies,
): Promise<AutoReviewRun> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const pageImages = new Map<number, Promise<ReviewPageImage>>();
  const provider = dependencies.provider;
  const results = await mapWithConcurrency(
    input.items,
    positiveInteger(dependencies.concurrency, 2),
    async (item) => {
      const ruleSignals = detectAuditRiskSignals(item);
      if (!provider) {
        return buildResult(item, "rules_only", ruleSignals, undefined, undefined, now());
      }
      try {
        const pageNumber = item.source.pageStart;
        if (!Number.isInteger(pageNumber) || (pageNumber ?? 0) < 1) {
          throw new Error("source_page_unavailable");
        }
        let pageImage = pageImages.get(pageNumber!);
        if (!pageImage) {
          pageImage = dependencies.renderPage(pageNumber!, item);
          pageImages.set(pageNumber!, pageImage);
        }
        const modelAssessment = await provider.review({
          item,
          ruleSignals,
          pageImage: await pageImage,
        });
        return buildResult(item, "hybrid", ruleSignals, modelAssessment, undefined, now(), provider);
      } catch (error) {
        return buildResult(
          item,
          "partial",
          ruleSignals,
          undefined,
          safeErrorReason(error),
          now(),
          provider,
        );
      }
    },
  );

  const failedCount = results.filter((result) => result.unavailableReason).length;
  const runMode: AutoReviewMode = !provider
    ? "rules_only"
    : failedCount === 0
      ? "hybrid"
      : failedCount === results.length
        ? "unavailable"
        : "partial";
  if (runMode === "unavailable") {
    for (const result of results) result.mode = "unavailable";
  }

  return {
    runId: `auto-review-${input.artifactId}-${startedAt}`,
    artifactId: input.artifactId,
    mode: runMode,
    provider: provider?.metadata,
    startedAt,
    finishedAt: now(),
    items: results,
    summary: {
      status: runMode === "hybrid" ? "completed" : runMode === "partial" ? "partial" : "unavailable",
      reviewedCount: results.length - failedCount,
      suspectedCount: results.filter((result) => result.status === "suspected_issue").length,
      unavailableCount: failedCount,
    },
  };
}

function buildResult(
  item: AuditReviewItem,
  mode: AutoReviewMode,
  ruleSignals: ReturnType<typeof detectAuditRiskSignals>,
  modelAssessment: AutoReviewItemResult["modelAssessment"],
  unavailableReason: string | undefined,
  reviewedAt: string,
  provider?: AutoReviewProvider,
): AutoReviewItemResult {
  const risk = aggregateAutoRisk({ mode, ruleSignals, modelAssessment });
  return {
    auditItemId: item.auditItemId,
    status: unavailableReason && risk.status === "clean" ? "unavailable" : risk.status,
    mode: risk.mode,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    issueTypes: risk.issueTypes,
    summary: unavailableReason ? `自动审核未完整完成：${unavailableReason}` : risk.summary,
    ruleSignals,
    modelAssessment,
    source: item.source,
    provider: provider?.metadata,
    reviewedAt,
    unavailableReason,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function safeErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/data:[^\s]+/g, "[image omitted]").slice(0, 240) || "auto_review_unavailable";
}
