import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";

import { renderDocPage } from "../debug/pageImage.ts";
import {
  createArtifactStore,
  writeArtifactAtomic,
  type ArtifactStore,
  type WriteArtifactInput,
} from "./artifactStore.ts";
import { createAutoReviewProvider } from "./autoReviewProvider.ts";
import { projectReviewItems } from "./reviewItems.ts";
import { buildSamplingPlan } from "./reviewRounds.ts";
import { renderReviewArtifact } from "./renderReviewArtifact.ts";
import { runAutoReview as runAutomaticReview } from "./runAutoReview.ts";
import type {
  AuditReviewItem,
  AutoReviewMode,
  AutoReviewRun,
  CreateReviewArtifactInput,
  HumanReviewRound,
} from "./types.ts";

export interface CreateReviewArtifactDependencies {
  store?: ArtifactStore;
  runAutoReview?: (input: {
    artifactId: string;
    items: AuditReviewItem[];
  }) => Promise<AutoReviewRun>;
  writeArtifact?: (
    store: ArtifactStore,
    input: WriteArtifactInput,
  ) => Promise<unknown>;
  lowRiskSampleSize?: number;
}

export type AuditArtifactProcessStatus =
  | { status: "created"; artifactId: string; autoReviewMode: AutoReviewMode; unavailableCount: number }
  | { status: "failed"; error: string };

export async function createReviewArtifact(
  input: CreateReviewArtifactInput,
  dependencies: CreateReviewArtifactDependencies = {},
): Promise<Extract<AuditArtifactProcessStatus, { status: "created" }>> {
  const store = dependencies.store ?? createArtifactStore({ docId: input.document.id });
  const lowRiskSampleSize = dependencies.lowRiskSampleSize ?? 2;
  const items = projectReviewItems(input.processResult.snapshot, {
    artifactSeed: input.artifactId,
    maxFocusItems: 20,
    lowRiskSampleSize,
  });
  const autoReview = dependencies.runAutoReview
    ? await dependencies.runAutoReview({ artifactId: input.artifactId, items })
    : await runDefaultAutoReview(input, items);
  const rendered = renderReviewArtifact({ document: input.document, items, autoReview });
  const reviewId = store.createReviewId();
  const initialReview: HumanReviewRound = {
    reviewId,
    artifactId: input.artifactId,
    status: "pending",
    samplingPlan: buildSamplingPlan(items, autoReview.items, reviewId, lowRiskSampleSize),
    items: [],
  };
  const writer = dependencies.writeArtifact ?? writeArtifactAtomic;
  await writer(store, {
    manifest: {
      artifactId: input.artifactId,
      docId: input.document.id,
      documentFileName: input.document.fileName,
      sourceFileSha256: createHash("sha256").update(input.sourceBuffer).digest("hex"),
      createdAt: input.createdAt,
      files: {},
      reviewItems: items,
    },
    reviewMarkdown: rendered.markdown,
    reviewHtml: rendered.html,
    autoReview,
    initialReview,
  });
  return {
    status: "created",
    artifactId: input.artifactId,
    autoReviewMode: autoReview.mode,
    unavailableCount: autoReview.summary.unavailableCount,
  };
}

export async function createReviewArtifactSafely(
  create: () => Promise<Extract<AuditArtifactProcessStatus, { status: "created" }>>,
): Promise<AuditArtifactProcessStatus> {
  try {
    return await create();
  } catch (error) {
    return { status: "failed", error: safeError(error) };
  }
}

export function newArtifactIdentity(now = new Date()): { artifactId: string; createdAt: string } {
  return { artifactId: `artifact-${randomUUID()}`, createdAt: now.toISOString() };
}

async function runDefaultAutoReview(
  input: CreateReviewArtifactInput,
  items: AuditReviewItem[],
): Promise<AutoReviewRun> {
  const provider = createAutoReviewProvider();
  return runAutomaticReview({ artifactId: input.artifactId, items }, {
    provider,
    concurrency: positiveInteger(process.env.AUTO_REVIEW_CONCURRENCY, 2),
    renderPage: async (pageNumber) => {
      const rendered = await renderDocPage(
        input.document.id,
        Buffer.from(input.sourceBuffer),
        pageNumber,
      );
      if (!rendered.pngPath) throw new Error(rendered.error || "page_render_failed");
      return { mimeType: "image/png", base64: fs.readFileSync(rendered.pngPath).toString("base64") };
    },
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/data:[^\s]+/g, "[image omitted]").slice(0, 500) || "artifact_creation_failed";
}
