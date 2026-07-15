import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createArtifactDirectory,
  loadArtifact,
  replaceReviewResult,
  verifyArtifactIntegrity,
} from "../lib/audit/artifactStore.ts";
import { renderReviewHtml } from "../lib/audit/renderReviewArtifact.ts";
import type {
  AuditManifest,
  AuditSourceItem,
  ReviewResult,
} from "../lib/audit/types.ts";
import { sha256Text } from "../lib/audit/reviewItems.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const item: AuditSourceItem = {
  auditItemId: "plain_section:obj-1",
  objectType: "plain_section",
  title: "<script>alert(1)</script>",
  content: "正文 </script><script>alert(2)</script>",
  sourcePageStart: 1,
  sourcePageEnd: 1,
  sourceBlockIds: ["block-1"],
  knowledgeObjectId: "obj-1",
  chunkIds: ["chunk-1"],
  confidence: 0.95,
  warnings: [],
  contentSha256: "content-hash",
  selectedForReview: true,
  selectionReason: "stable_sample",
};

function fixture(): {
  manifest: AuditManifest;
  reviewMd: string;
  reviewHtml: string;
  result: ReviewResult;
} {
  const reviewMd = "# Review\n";
  const reviewHtml = renderReviewHtml({
    documentId: "doc-audit",
    artifactId: "artifact-a",
    fileName: "audit.pdf",
    items: [item],
  });
  const {
    content: _content,
    sourceExcerpt: _sourceExcerpt,
    tableMarkdown: _tableMarkdown,
    ...manifestItem
  } = item;

  return {
    manifest: {
      schemaVersion: 1,
      artifactId: "artifact-a",
      generatedAt: "2026-07-15T00:00:00.000Z",
      document: {
        id: "doc-audit",
        fileName: "audit.pdf",
        sourceFileSha256: "source-hash",
      },
      pipeline: { dataSchemaVersion: 5, embeddingSignature: "mock:v1" },
      summary: {
        blockCount: 1,
        knowledgeObjectCount: 1,
        chunkCount: 1,
        ragTableCount: 0,
        warningCount: 0,
        focusItemCount: 1,
        selectionWarnings: [],
      },
      items: [manifestItem],
      files: {
        reviewMdSha256: sha256Text(reviewMd),
        reviewHtmlSha256: sha256Text(reviewHtml),
      },
    },
    reviewMd,
    reviewHtml,
    result: {
      schemaVersion: 1,
      artifactId: "artifact-a",
      status: "pending",
      items: [],
    },
  };
}

test("escapes document content in generated HTML", () => {
  const html = fixture().reviewHtml;
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /plain_section:obj-1/);
});

test("creates four files atomically and verifies hashes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-artifact-"));
  roots.push(root);
  const data = fixture();
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
  const loaded = loadArtifact(root, "doc-audit", "artifact-a");

  assert.deepEqual(fs.readdirSync(loaded.directory).sort(), [
    "manifest.json",
    "review-result.json",
    "review.html",
    "review.md",
  ]);
  assert.deepEqual(verifyArtifactIntegrity(loaded), { ok: true, errors: [] });
});

test("detects file tampering and rejects unsafe ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-artifact-"));
  roots.push(root);
  const data = fixture();
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
  fs.appendFileSync(
    path.join(root, "doc-audit", "artifact-a", "review.html"),
    "tampered"
  );

  assert.equal(
    verifyArtifactIntegrity(loadArtifact(root, "doc-audit", "artifact-a")).ok,
    false
  );
  assert.throws(
    () => loadArtifact(root, "../escape", "artifact-a"),
    /invalid documentId/
  );

  const manifestPath = path.join(
    root,
    "doc-audit",
    "artifact-a",
    "manifest.json"
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, artifactId: "artifact-b" })
  );
  assert.throws(
    () => loadArtifact(root, "doc-audit", "artifact-a"),
    /artifact identity mismatch/
  );
});

test("atomically replaces a non-final review result", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-artifact-"));
  roots.push(root);
  const data = fixture();
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
  replaceReviewResult(root, "doc-audit", "artifact-a", {
    schemaVersion: 1,
    artifactId: "artifact-a",
    reviewerUserId: "user-admin",
    status: "draft",
    startedAt: "2026-07-15T01:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
    items: [],
  });

  assert.equal(loadArtifact(root, "doc-audit", "artifact-a").result.status, "draft");
});
