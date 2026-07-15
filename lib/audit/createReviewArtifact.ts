import { createHash, randomUUID } from "node:crypto";

import { getEmbeddingProvider } from "../ai/embedding.ts";
import { SCHEMA_VERSION } from "../db/persist.ts";
import { createArtifactDirectory } from "./artifactStore.ts";
import {
  buildAuditReviewItems,
  selectFocusReviewItems,
  sha256Text,
} from "./reviewItems.ts";
import {
  renderReviewHtml,
  renderReviewMarkdown,
} from "./renderReviewArtifact.ts";
import type {
  AuditArtifactCreationResult,
  AuditManifest,
  CreateReviewArtifactInput,
} from "./types.ts";

function makeArtifactId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createReviewArtifact(input: CreateReviewArtifactInput): {
  artifactId: string;
  generatedAt: string;
} {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const artifactId = input.artifactId ?? makeArtifactId(now);
  const projected = buildAuditReviewItems(input.snapshot);
  const selected = selectFocusReviewItems(
    projected,
    `${input.document.id}:${artifactId}`
  );
  const manifestWithoutFiles = {
    schemaVersion: 1 as const,
    artifactId,
    generatedAt,
    document: {
      id: input.document.id,
      fileName: input.document.fileName,
      sourceFileSha256: sha256Buffer(input.sourceBuffer),
    },
    pipeline: {
      dataSchemaVersion: SCHEMA_VERSION,
      embeddingSignature: getEmbeddingProvider().signature,
    },
    summary: {
      blockCount: input.snapshot.blocks.length,
      knowledgeObjectCount: input.snapshot.knowledgeObjects.length,
      chunkCount: input.snapshot.chunks.length,
      ragTableCount: input.snapshot.ragTables.length,
      warningCount:
        input.snapshot.warnings.length +
        selected.items.reduce((sum, item) => sum + item.warnings.length, 0),
      focusItemCount: selected.items.filter((item) => item.selectedForReview)
        .length,
      selectionWarnings: selected.selectionWarnings,
    },
    items: selected.items.map(
      ({
        content: _content,
        sourceExcerpt: _sourceExcerpt,
        tableMarkdown: _tableMarkdown,
        ...item
      }) => item
    ),
  };
  const reviewMd = renderReviewMarkdown({
    manifest: manifestWithoutFiles,
    items: selected.items,
  });
  const reviewHtml = renderReviewHtml({
    documentId: input.document.id,
    artifactId,
    fileName: input.document.fileName,
    items: selected.items,
  });
  const manifest: AuditManifest = {
    ...manifestWithoutFiles,
    files: {
      reviewMdSha256: sha256Text(reviewMd),
      reviewHtmlSha256: sha256Text(reviewHtml),
    },
  };

  createArtifactDirectory({
    rootDir: input.rootDir,
    documentId: input.document.id,
    manifest,
    reviewMd,
    reviewHtml,
    result: {
      schemaVersion: 1,
      artifactId,
      status: "pending",
      items: [],
    },
  });

  return { artifactId, generatedAt };
}

export function tryCreateReviewArtifact(
  input: CreateReviewArtifactInput,
  writer: typeof createReviewArtifact = createReviewArtifact
): AuditArtifactCreationResult {
  try {
    return { status: "created", ...writer(input) };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
