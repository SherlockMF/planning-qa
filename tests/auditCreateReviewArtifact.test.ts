import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  createReviewArtifact,
  tryCreateReviewArtifact,
} from "../lib/audit/createReviewArtifact.ts";
import {
  loadArtifact,
  verifyArtifactIntegrity,
} from "../lib/audit/artifactStore.ts";
import type { AuditPipelineSnapshot } from "../lib/audit/types.ts";
import type { Document } from "../lib/types.ts";
import type { KnowledgeObject } from "../lib/rag/objects.ts";

const document: Document = {
  id: "doc-audit",
  fileName: "audit.txt",
  city: "测试城市",
  fileType: "其他",
  enabled: true,
  status: "indexed",
  createdAt: "2026-07-15T00:00:00.000Z",
};

const plainSection = {
  id: "object-1",
  docId: document.id,
  objectType: "plain_section",
  title: "审核段落",
  content: "需要审核的正文",
  sectionPath: [],
  sectionPathText: "",
  sourcePageStart: 1,
  sourceBlockIds: ["block-0"],
  confidence: 0.95,
  warnings: ["object-warning"],
} satisfies KnowledgeObject;

const snapshot: AuditPipelineSnapshot = {
  blocks: [
    {
      type: "paragraph",
      pageStart: 1,
      pageEnd: 1,
      rawText: "来源正文",
      normalizedText: "来源正文",
    },
  ],
  knowledgeObjects: [plainSection],
  chunks: [
    {
      id: "chunk-1",
      documentId: document.id,
      fileName: document.fileName,
      city: document.city,
      chunkType: "section",
      objectId: plainSection.id,
      content: plainSection.content,
      keywords: [],
      embedding: [0.123456789, 0.987654321],
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ],
  ragTables: [],
  warnings: ["pipeline-warning"],
};

test("creates a review artifact without persisting embeddings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-create-"));
  try {
    const sourceBuffer = Buffer.from("source file", "utf8");
    const created = createReviewArtifact({
      document,
      sourceBuffer,
      snapshot,
      now: new Date("2026-07-15T00:00:00.000Z"),
      artifactId: "artifact-a",
      rootDir: root,
    });

    assert.deepEqual(created, {
      artifactId: "artifact-a",
      generatedAt: "2026-07-15T00:00:00.000Z",
    });

    const loaded = loadArtifact(root, document.id, "artifact-a");
    const persisted = [
      JSON.stringify(loaded.manifest),
      loaded.reviewMd,
      loaded.reviewHtml,
      JSON.stringify(loaded.result),
    ].join("\n");
    assert.doesNotMatch(persisted, /0\.123456789|0\.987654321/);
    assert.doesNotMatch(persisted, /"embedding"/);
    assert.equal(
      loaded.manifest.document.sourceFileSha256,
      createHash("sha256").update(sourceBuffer).digest("hex")
    );
    assert.deepEqual(loaded.manifest.summary, {
      blockCount: 1,
      knowledgeObjectCount: 1,
      chunkCount: 1,
      ragTableCount: 0,
      warningCount: 2,
      focusItemCount: 1,
      selectionWarnings: [],
    });
    assert.deepEqual(loaded.manifest.items[0]?.chunkIds, ["chunk-1"]);
    assert.equal(loaded.result.status, "pending");
    assert.deepEqual(verifyArtifactIntegrity(loaded), { ok: true, errors: [] });
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generates a URL-safe artifact id from the current timestamp", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-create-id-"));
  try {
    const created = createReviewArtifact({
      document,
      sourceBuffer: Buffer.from("source file", "utf8"),
      snapshot,
      now: new Date("2026-07-15T00:00:00.000Z"),
      rootDir: root,
    });

    assert.match(created.artifactId, /^20260715000000-[0-9a-f]{8}$/);
    assert.equal(
      loadArtifact(root, document.id, created.artifactId).manifest.artifactId,
      created.artifactId
    );
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isolates review artifact writer failures", async () => {
  const result = await tryCreateReviewArtifact(
    {} as never,
    () => {
      throw new Error("disk unavailable");
    }
  );

  assert.deepEqual(result, { status: "failed", error: "disk unavailable" });
});
