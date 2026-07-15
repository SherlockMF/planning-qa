import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createArtifactDirectory,
  listReviewArtifacts,
  loadArtifact,
  replaceReviewResult,
  verifyArtifactIntegrity,
} from "../lib/audit/artifactStore.ts";
import {
  renderReviewHtml,
  renderReviewMarkdown,
} from "../lib/audit/renderReviewArtifact.ts";
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

function temporaryRoot(prefix = "audit-artifact-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function assertNoPublishedArtifact(
  root: string,
  documentId = "doc-audit",
  artifactId = "artifact-a"
): void {
  const documentDirectory = path.join(root, documentId);
  assert.equal(
    fs.existsSync(path.join(documentDirectory, artifactId)),
    false
  );
  if (fs.existsSync(documentDirectory)) {
    assert.equal(
      fs.readdirSync(documentDirectory).some((name) => name.startsWith(".tmp-")),
      false
    );
  }
}

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

test("rejects a mismatched manifest document before publishing", () => {
  const root = temporaryRoot();
  const data = fixture();
  data.manifest.document.id = "doc-other";

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
      }),
    /artifact identity mismatch/
  );
  assertNoPublishedArtifact(root);

  data.manifest.document.id = "doc-audit";
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
  assert.equal(loadArtifact(root, "doc-audit", "artifact-a").manifest.artifactId, "artifact-a");
});

test("rejects a mismatched review result artifact before publishing", () => {
  const root = temporaryRoot();
  const data = fixture();
  data.result.artifactId = "artifact-other";

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
      }),
    /artifact identity mismatch/
  );
  assertNoPublishedArtifact(root);

  data.result.artifactId = "artifact-a";
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
  assert.equal(loadArtifact(root, "doc-audit", "artifact-a").result.artifactId, "artifact-a");
});

test("rejects unsupported manifest and review result schemas before publishing", () => {
  const root = temporaryRoot();
  const data = fixture();
  data.manifest.schemaVersion = 2 as 1;

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
      }),
    /unsupported schema version/
  );
  assertNoPublishedArtifact(root);

  data.manifest.schemaVersion = 1;
  data.result.schemaVersion = 2 as 1;
  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
      }),
    /unsupported schema version/
  );
  assertNoPublishedArtifact(root);

  data.result.schemaVersion = 1;
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
});

test("rejects a mismatched Markdown hash before publishing", () => {
  const root = temporaryRoot();
  const data = fixture();
  const reviewMd = `${data.reviewMd}tampered`;

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
        reviewMd,
      }),
    /review_md_hash_mismatch/
  );
  assertNoPublishedArtifact(root);

  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
});

test("rejects a mismatched HTML hash before publishing", () => {
  const root = temporaryRoot();
  const data = fixture();
  const reviewHtml = `${data.reviewHtml}tampered`;

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...data,
        reviewHtml,
      }),
    /review_html_hash_mismatch/
  );
  assertNoPublishedArtifact(root);

  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });
});

test("rejects artifact creation through a document junction", () => {
  const root = temporaryRoot("audit-root-");
  const outside = temporaryRoot("audit-outside-");
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "keep", "utf8");
  const documentJunction = path.join(root, "doc-audit");
  fs.symlinkSync(outside, documentJunction, "junction");

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...fixture(),
      }),
    /symlink|reparse|escaped root/
  );
  assert.deepEqual(fs.readdirSync(outside), ["sentinel.txt"]);
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "keep");
});

test("rejects artifact reads through a document junction", () => {
  const root = temporaryRoot("audit-root-");
  const outside = temporaryRoot("audit-outside-");
  const data = fixture();
  createArtifactDirectory({
    rootDir: outside,
    documentId: "doc-audit",
    ...data,
  });
  fs.symlinkSync(
    path.join(outside, "doc-audit"),
    path.join(root, "doc-audit"),
    "junction"
  );

  assert.throws(
    () => loadArtifact(root, "doc-audit", "artifact-a"),
    /symlink|reparse|escaped root/
  );
});

test("rejects artifact listing through a document junction", () => {
  const root = temporaryRoot("audit-root-");
  const outside = temporaryRoot("audit-outside-");
  const data = fixture();
  createArtifactDirectory({
    rootDir: outside,
    documentId: "doc-audit",
    ...data,
  });
  fs.symlinkSync(
    path.join(outside, "doc-audit"),
    path.join(root, "doc-audit"),
    "junction"
  );

  assert.throws(
    () => listReviewArtifacts("doc-audit", root),
    /symlink|reparse|escaped root/
  );
});

test("escapes document content in generated HTML", () => {
  const html = fixture().reviewHtml;
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /plain_section:obj-1/);
});

test("renders the Markdown audit contract with source and table evidence", () => {
  const data = fixture();
  const { files: _files, ...manifest } = data.manifest;
  const markdown = renderReviewMarkdown({
    manifest,
    items: [
      {
        ...item,
        sourceExcerpt: "来源摘录",
        tableMarkdown: "| 指标 |\n| --- |",
      },
    ],
  });

  assert.match(markdown, /^# audit\.pdf 审核副本/m);
  assert.match(markdown, /## \[必审\] <script>alert\(1\)<\/script>/);
  assert.match(markdown, /### Source Block 摘录\n\n来源摘录/);
  assert.match(markdown, /\| 指标 \|\n\| --- \|/);
  assert.equal(markdown.endsWith("\n"), true);
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

test("does not overwrite an existing immutable artifact", () => {
  const root = temporaryRoot();
  const original = fixture();
  createArtifactDirectory({
    rootDir: root,
    documentId: "doc-audit",
    ...original,
  });
  const replacement = fixture();
  replacement.reviewMd = "# Replacement\n";
  replacement.manifest.files.reviewMdSha256 = sha256Text(replacement.reviewMd);

  assert.throws(
    () =>
      createArtifactDirectory({
        rootDir: root,
        documentId: "doc-audit",
        ...replacement,
      }),
    /artifact already exists/
  );
  assert.equal(
    loadArtifact(root, "doc-audit", "artifact-a").reviewMd,
    original.reviewMd
  );
});

test("lists artifacts newest first with review summary counts", () => {
  const root = temporaryRoot();
  const older = fixture();
  createArtifactDirectory({
    rootDir: root,
    documentId: "doc-audit",
    ...older,
  });

  const newer = fixture();
  newer.manifest.artifactId = "artifact-b";
  newer.manifest.generatedAt = "2026-07-15T02:00:00.000Z";
  newer.manifest.summary.focusItemCount = 7;
  newer.result.artifactId = "artifact-b";
  newer.result.status = "issues_found";
  newer.result.reviewerUserId = "user-admin";
  newer.result.items = [
    {
      auditItemId: item.auditItemId,
      status: "issue",
      issueTypes: ["table_error"],
      comment: "表格错列",
    },
  ];
  newer.reviewHtml = renderReviewHtml({
    documentId: "doc-audit",
    artifactId: "artifact-b",
    fileName: "audit.pdf",
    items: [item],
  });
  newer.manifest.files.reviewHtmlSha256 = sha256Text(newer.reviewHtml);
  createArtifactDirectory({
    rootDir: root,
    documentId: "doc-audit",
    ...newer,
  });

  const summaries = listReviewArtifacts("doc-audit", root);
  assert.deepEqual(
    summaries.map((summary) => summary.artifactId),
    ["artifact-b", "artifact-a"]
  );
  assert.equal(summaries[0].generatedAt, "2026-07-15T02:00:00.000Z");
  assert.equal(summaries[0].status, "issues_found");
  assert.equal(summaries[0].focusItemCount, 7);
  assert.equal(summaries[0].issueCount, 1);
  assert.equal(summaries[0].reviewerUserId, "user-admin");
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
  assert.deepEqual(
    fs.readdirSync(path.join(root, "doc-audit", "artifact-a")).sort(),
    ["manifest.json", "review-result.json", "review.html", "review.md"]
  );
});

test("does not replace a finalized review result", () => {
  const root = temporaryRoot();
  const data = fixture();
  data.result.status = "passed";
  data.result.reviewerUserId = "user-admin";
  data.result.finalizedAt = "2026-07-15T02:00:00.000Z";
  createArtifactDirectory({ rootDir: root, documentId: "doc-audit", ...data });

  assert.throws(
    () =>
      replaceReviewResult(root, "doc-audit", "artifact-a", {
        schemaVersion: 1,
        artifactId: "artifact-a",
        status: "draft",
        items: [],
      }),
    /review already finalized/
  );
  assert.deepEqual(
    loadArtifact(root, "doc-audit", "artifact-a").result,
    data.result
  );
});
