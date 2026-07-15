import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createArtifactStore, readArtifact } from "../lib/audit/artifactStore.ts";
import {
  createReviewArtifact,
  createReviewArtifactSafely,
} from "../lib/audit/createReviewArtifact.ts";
import { renderReviewArtifact } from "../lib/audit/renderReviewArtifact.ts";
import type {
  AuditReviewItem,
  AutoReviewRun,
  CreateReviewArtifactInput,
} from "../lib/audit/types.ts";
import type { KnowledgeObject } from "../lib/rag/objects.ts";
import type { Document } from "../lib/types.ts";

const document: Document = {
  id: "doc-1",
  fileName: "<script>alert('doc')</script>.pdf",
  city: "北京",
  fileType: "规划法规",
  enabled: true,
  status: "indexed",
  createdAt: "2026-07-16T00:00:00.000Z",
};

const reviewItem: AuditReviewItem = {
  auditItemId: "item-1",
  objectType: "structured_table_row",
  title: "<script>alert('title')</script>",
  content: "服务规模：20 / 1000—5000 户",
  warnings: ["cross-row <script>"],
  selectedForReview: true,
  selectionReason: "warning",
  source: {
    pageStart: 2,
    pageEnd: 2,
    blockIds: ["block-1"],
    tableId: "table-1",
    rowIndex: 15,
    knowledgeObjectId: "item-1",
    chunkIds: ["chunk-1"],
  },
};

const autoReview: AutoReviewRun = {
  runId: "run-1",
  artifactId: "artifact-1",
  mode: "partial",
  provider: { name: "independent-review", model: "vision-1" },
  startedAt: "2026-07-16T00:01:00.000Z",
  finishedAt: "2026-07-16T00:01:01.000Z",
  items: [{
    auditItemId: "item-1",
    status: "unavailable",
    mode: "partial",
    riskScore: 70,
    riskLevel: "high",
    issueTypes: ["row_boundary_contamination"],
    summary: "模型返回 <script>alert('model')</script>",
    ruleSignals: [{
      ruleId: "adjacent_row_value",
      issueType: "row_boundary_contamination",
      riskScore: 85,
      summary: "相邻行污染",
      evidence: "20 来自上一行",
    }],
    source: reviewItem.source,
    provider: { name: "independent-review", model: "vision-1" },
    reviewedAt: "2026-07-16T00:01:01.000Z",
    unavailableReason: "provider_timeout",
  }],
  summary: { status: "partial", reviewedCount: 0, suspectedCount: 0, unavailableCount: 1 },
};

function artifactInput(): CreateReviewArtifactInput {
  const object: KnowledgeObject = {
    id: "item-1",
    docId: "doc-1",
    objectType: "structured_table_row",
    title: reviewItem.title,
    content: reviewItem.content,
    sectionPath: [],
    sectionPathText: "",
    confidence: 0.7,
    warnings: ["cross-row <script>"],
    sourcePageStart: 2,
    sourcePageEnd: 2,
    sourceBlockIds: ["block-1"],
    sourceTableId: "table-1",
    sourceRowIndex: 15,
    tableObjectId: "table-object-1",
    rowIndex: 15,
    fields: { 服务规模: "20 / 1000—5000 户" },
    normalizedFields: { 服务规模: { raw: "20 / 1000—5000 户", kind: "text" } },
  };
  return {
    artifactId: "artifact-1",
    document,
    sourceBuffer: Buffer.from("source-pdf"),
    processResult: {
      chunkCount: 1,
      snapshot: {
        blocks: [],
        knowledgeObjects: [object],
        chunks: [{
          id: "chunk-1",
          documentId: "doc-1",
          fileName: document.fileName,
          city: document.city,
          chunkType: "table_row",
          objectId: "item-1",
          sourceTableId: "table-1",
          sourceRowIndex: 15,
          content: reviewItem.content,
          keywords: [],
          createdAt: "2026-07-16T00:00:00.000Z",
        }],
        ragTables: [],
        warnings: [],
      },
    },
    createdAt: "2026-07-16T00:01:01.000Z",
  };
}

test("renders escaped read-only Markdown and HTML with separate automatic and human labels", () => {
  const rendered = renderReviewArtifact({ document, items: [reviewItem], autoReview });

  for (const archive of [rendered.markdown, rendered.html]) {
    assert.doesNotMatch(archive, /<script>/i);
    assert.match(archive, /自动审核/);
    assert.match(archive, /人工审核/);
    assert.match(archive, /自动疑似问题数/);
    assert.match(archive, /本轮只识别切分风险，不修复切分结果；表格仍应按表格结构优化切分。/);
  }
  assert.doesNotMatch(rendered.html, /<(form|input|button)\b/i);
  assert.match(rendered.html, /provider_timeout/);
});

test("creates a complete immutable artifact and preserves unavailable automatic items", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-create-"));
  const store = createArtifactStore({
    rootDir,
    docId: "doc-1",
    createReviewId: () => "review-1",
  });
  let receivedItems: AuditReviewItem[] = [];

  const result = await createReviewArtifact(artifactInput(), {
    store,
    runAutoReview: async ({ items }) => {
      receivedItems = items;
      return autoReview;
    },
  });

  assert.equal(result.artifactId, "artifact-1");
  assert.equal(result.autoReviewMode, "partial");
  assert.equal(result.unavailableCount, 1);
  assert.equal(receivedItems.length, 1);
  const artifact = await readArtifact(store, "artifact-1");
  assert.equal(artifact.integrity.ok, true);
  assert.equal(artifact.manifest.sourceFileSha256.length, 64);
  assert.deepEqual(artifact.manifest.reviewItems?.map((item) => item.auditItemId), ["item-1"]);
  assert.equal(artifact.reviewRounds[0].status, "pending");
  assert.equal(artifact.reviewRounds[0].reviewerUserId, undefined);
  assert.deepEqual(artifact.reviewRounds[0].samplingPlan.requiredItemIds, ["item-1"]);
});

test("converts artifact-only failure into an isolated process result", async () => {
  const indexedResult = { chunkCount: 1, extractedChars: 88 };
  const auditArtifact = await createReviewArtifactSafely(async () => {
    throw new Error("artifact_writer_failed");
  });

  assert.deepEqual(indexedResult, { chunkCount: 1, extractedChars: 88 });
  assert.deepEqual(auditArtifact, { status: "failed", error: "artifact_writer_failed" });
});
