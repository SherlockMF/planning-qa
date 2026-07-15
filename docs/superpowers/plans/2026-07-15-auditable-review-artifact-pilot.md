# Auditable Review Artifact Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immutable per-processing-run review package and a read-only review workflow for five pilot documents without changing the retrieval source of truth.

**Architecture:** Keep `.data/chunks.json` and `.data/ragtables.json` authoritative. After `processDocument` has persisted chunks and RagTables, project the same in-memory processing result into `artifacts/<docId>/<artifactId>/`; protected APIs serve the immutable files and write only `review-result.json`. The document-management UI reads artifact summaries through a narrow component and opens the generated `review.html` in a protected route.

**Tech Stack:** Next.js 14 App Router, TypeScript 5.6, React 18, Node.js `node:test`, local JSON/filesystem persistence, Node `crypto` and `fs` only; no new runtime dependency.

## Global Constraints

- `.data/chunks.json` and `.data/ragtables.json` remain the retrieval source of truth; audit code must never write either file.
- Markdown and HTML are review sidecars only and must never be read by embedding, retrieval, reranking, answer generation, or reindexing code.
- Every processing run gets a new immutable `artifactId`; old artifact directories are not overwritten.
- Every artifact directory contains exactly `manifest.json`, `review.md`, `review.html`, and `review-result.json`.
- Initial review status is `pending`; allowed later states are `draft`, `passed`, and `issues_found`.
- A document exposes all review items but requires at most 20 focus items; low confidence means `confidence < 0.80`.
- A finalized `review-result.json` cannot be overwritten through the application.
- Review access reuses `canManageDocumentInManagement`; `artifacts/` must not be placed under `public/`.
- Do not persist embedding vectors, secrets, environment variables, or original uploaded bytes in an artifact; the provider/model `embeddingSignature` is allowed.
- Artifact creation failure must leave the document `indexed` and return `auditArtifact.status = "failed"` instead of turning the process request into a 500.
- All filesystem identifiers use `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`; resolved child paths must remain under the configured artifact root.
- Use TDD for each task and commit only the files listed by that task.
- Run commands from `D:\OPC\enterprise-knowledge-qa-wenda` with PowerShell-compatible `npm.cmd` and `npx.cmd` entry points.

---

## File Structure

### New domain files

- `lib/audit/types.ts` — audit manifest, source item, review result, creation result, and issue-type contracts.
- `lib/audit/reviewItems.ts` — deterministic KnowledgeObject/Chunk/RagTable projection and focus selection.
- `lib/audit/renderReviewArtifact.ts` — Markdown and self-contained HTML rendering with mandatory escaping.
- `lib/audit/artifactStore.ts` — safe paths, immutable directory creation, list/read/integrity operations, and atomic review-result replacement.
- `lib/audit/reviewSubmission.ts` — draft/finalize validation and state transition.
- `lib/audit/reviewAvailability.ts` — pure integrity/source/finalization submission gate.
- `lib/audit/createReviewArtifact.ts` — orchestrates item projection, selection, rendering, manifest creation, and persistence.
- `lib/audit/reviewPresentation.ts` — pure status label/variant mapping shared by the management UI.

### New API and UI files

- `app/api/documents/[id]/review-artifacts/access.ts` — shared document lookup and management-permission guard.
- `app/api/documents/[id]/review-artifacts/route.ts` — list snapshots for one document.
- `app/api/documents/[id]/review-artifacts/[artifactId]/route.ts` — serve protected HTML, Markdown, or manifest.
- `app/api/documents/[id]/review-artifacts/[artifactId]/review/route.ts` — load, save draft, and finalize review results.
- `components/ReviewArtifactControl.tsx` — snapshot selector, status badge, and open-review action.

### Existing files to modify

- `.gitignore` — ignore generated `/artifacts/` data.
- `lib/db/chunks.ts` — return a narrow `AuditPipelineSnapshot` together with `chunkCount`.
- `app/api/documents/[id]/process/route.ts` — create the artifact after indexing and isolate audit failures.
- `components/DocumentTable.tsx` — display the review control and process-result notice.
- `tests/index.ts` — import the five new audit test modules.
- `docs/audit-review-pilot-runbook.md` — five-document trial, hash checks, sampling, and decision record.

---

### Task 1: Define audit contracts and deterministic focus selection

**Files:**
- Create: `lib/audit/types.ts`
- Create: `lib/audit/reviewItems.ts`
- Create: `tests/auditReviewItems.test.ts`
- Modify: `tests/index.ts:30`

**Interfaces:**
- Consumes: `KnowledgeObject[]`, `Chunk[]`, `RagTable[]`, and `Block[]` from the existing processing pipeline.
- Produces: `buildAuditReviewItems(input: AuditPipelineSnapshot): AuditSourceItem[]`.
- Produces: `selectFocusReviewItems(items: AuditSourceItem[], seed: string, limit?: number): FocusSelectionResult`.
- Produces: the shared types consumed by every later task.

- [ ] **Step 1: Write the failing projection and selection tests**

Create `tests/auditReviewItems.test.ts` with fixtures covering object-to-chunk mapping, RagTable mapping, risk priority, stable selection, the 20-item cap, and table overflow:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Chunk, RagTable } from "../lib/types.ts";
import type { KnowledgeObject } from "../lib/rag/objects.ts";
import {
  buildAuditReviewItems,
  selectFocusReviewItems,
} from "../lib/audit/reviewItems.ts";

function object(
  id: string,
  objectType = "plain_section",
  extra: Partial<KnowledgeObject> = {}
): KnowledgeObject {
  return {
    id,
    docId: "doc-audit",
    objectType,
    title: id,
    content: `content-${id}`,
    sectionPath: [],
    sectionPathText: "",
    sourcePageStart: 1,
    sourcePageEnd: 1,
    confidence: 0.95,
    ...extra,
  } as KnowledgeObject;
}

function chunk(id: string, objectId: string): Chunk {
  return {
    id,
    documentId: "doc-audit",
    fileName: "audit.pdf",
    city: "北京",
    chunkType: "paragraph",
    content: `chunk-${id}`,
    keywords: [],
    objectId,
    createdAt: "2026-07-15T00:00:00.000Z",
    embedding: [0.1, 0.2],
  };
}

const table: RagTable = {
  tableId: "tbl-1",
  docId: "doc-audit",
  docTitle: "audit",
  tableTitle: "指标表",
  tableType: "indicator_table",
  sectionPath: [],
  pageStart: 2,
  pageEnd: 2,
  columns: [],
  rows: [],
  markdownFull: "| 指标 | 值 |\n| --- | --- |\n| 高度 | 24m |",
  confidence: 0.90,
  warnings: [],
};

test("projects source ids without persisting embeddings", () => {
  const objects = [
    object("table-object", "structured_table", {
      sourceTableId: "tbl-1",
      sourcePageStart: 2,
      content: "指标表",
    }),
    object("row-object", "structured_table_row", {
      sourceTableId: "tbl-1",
      sourceRowIndex: 0,
      sourceBlockIds: ["block-0"],
      sourcePageStart: 2,
      content: "高度 24m",
    }),
  ];
  const items = buildAuditReviewItems({
    blocks: [{
      type: "table_row",
      pageStart: 2,
      pageEnd: 2,
      rawText: "高度 24m",
      normalizedText: "高度 24m",
      rowCells: ["高度", "24m"],
    }],
    knowledgeObjects: objects,
    chunks: [chunk("chunk-1", "row-object")],
    ragTables: [table],
    warnings: [],
  });

  const row = items.find((item) => item.knowledgeObjectId === "row-object");
  const tableItem = items.find(
    (item) => item.knowledgeObjectId === "table-object"
  );
  assert.deepEqual(row?.chunkIds, ["chunk-1"]);
  assert.equal(row?.ragTableId, "tbl-1");
  assert.equal(row?.tableMarkdown, undefined);
  assert.equal(tableItem?.tableMarkdown, table.markdownFull);
  assert.equal(row?.sourceExcerpt, "高度 24m");
  assert.equal(JSON.stringify(items).includes("0.1"), false);
});

test("selects risks first and remains stable", () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    auditItemId: `plain_section:item-${index}`,
    knowledgeObjectId: `item-${index}`,
    objectType: "plain_section",
    title: `item-${index}`,
    content: `content-${index}`,
    sourcePageStart: index + 1,
    sourcePageEnd: index + 1,
    sourceBlockIds: [],
    chunkIds: [],
    confidence: index === 29 ? 0.50 : 0.95,
    warnings: index === 28 ? ["parse_warning"] : [],
    contentSha256: `hash-${index}`,
    selectedForReview: false,
  }));

  const first = selectFocusReviewItems(items, "doc-audit:artifact-a");
  const second = selectFocusReviewItems(items, "doc-audit:artifact-a");
  assert.equal(first.items.filter((item) => item.selectedForReview).length, 20);
  assert.deepEqual(first, second);
  assert.equal(
    first.items.find((item) => item.auditItemId === "plain_section:item-29")
      ?.selectedForReview,
    true
  );
  assert.equal(
    first.items.find((item) => item.auditItemId === "plain_section:item-28")
      ?.selectedForReview,
    true
  );
});

test("records a coverage warning when table minimums exceed the cap", () => {
  const items = Array.from({ length: 12 }, (_, index) => [
    {
      auditItemId: `structured_table:table-${index}`,
      knowledgeObjectId: `table-${index}`,
      objectType: "structured_table",
      title: `table-${index}`,
      content: `table-${index}`,
      sourcePageStart: index + 1,
      sourcePageEnd: index + 1,
      sourceBlockIds: [],
      chunkIds: [],
      ragTableId: `tbl-${index}`,
      confidence: 0.95,
      warnings: [],
      contentSha256: `table-hash-${index}`,
      selectedForReview: false,
    },
    {
      auditItemId: `structured_table_row:row-${index}`,
      knowledgeObjectId: `row-${index}`,
      objectType: "structured_table_row",
      title: `row-${index}`,
      content: `row-${index}`,
      sourcePageStart: index + 1,
      sourcePageEnd: index + 1,
      sourceBlockIds: [],
      chunkIds: [],
      ragTableId: `tbl-${index}`,
      confidence: 0.95,
      warnings: [],
      contentSha256: `row-hash-${index}`,
      selectedForReview: false,
    },
  ]).flat();

  const selected = selectFocusReviewItems(items, "overflow");
  assert.equal(selected.items.filter((item) => item.selectedForReview).length, 20);
  assert.deepEqual(selected.selectionWarnings, ["review_table_coverage_truncated"]);
});
```

Append the import to `tests/index.ts`:

```ts
import "./auditReviewItems.test.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node --experimental-strip-types tests/auditReviewItems.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/audit/reviewItems.ts`.

- [ ] **Step 3: Add the exact domain contracts**

Create `lib/audit/types.ts` with these exported contracts. Keep audit types outside `lib/types.ts` so the retrieval domain does not depend on audit concerns:

```ts
import type { Block, Chunk, Document, RagTable } from "../types.ts";
import type { KnowledgeObject } from "../rag/objects.ts";

export const REVIEW_ISSUE_TYPES = [
  "missing_content",
  "ocr_error",
  "structure_error",
  "table_error",
  "source_location_error",
  "object_type_error",
  "other",
] as const;

export type ReviewIssueType = (typeof REVIEW_ISSUE_TYPES)[number];
export type ReviewItemStatus = "passed" | "issue";
export type ReviewStatus = "pending" | "draft" | "passed" | "issues_found";

export interface AuditPipelineSnapshot {
  blocks: Block[];
  knowledgeObjects: KnowledgeObject[];
  chunks: Chunk[];
  ragTables: RagTable[];
  warnings: string[];
}

export interface AuditManifestItem {
  auditItemId: string;
  objectType: string;
  title: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  sourceBlockIds: string[];
  sourceTableId?: string;
  sourceRowIndex?: number;
  knowledgeObjectId: string;
  chunkIds: string[];
  ragTableId?: string;
  confidence: number;
  warnings: string[];
  contentSha256: string;
  selectedForReview: boolean;
  selectionReason?: string;
}

export interface AuditSourceItem extends AuditManifestItem {
  content: string;
  sourceExcerpt?: string;
  tableMarkdown?: string;
}

export interface AuditManifest {
  schemaVersion: 1;
  artifactId: string;
  generatedAt: string;
  document: {
    id: string;
    fileName: string;
    sourceFileSha256: string;
  };
  pipeline: {
    dataSchemaVersion: number;
    embeddingSignature: string;
  };
  summary: {
    blockCount: number;
    knowledgeObjectCount: number;
    chunkCount: number;
    ragTableCount: number;
    warningCount: number;
    focusItemCount: number;
    selectionWarnings: string[];
  };
  items: AuditManifestItem[];
  files: {
    reviewMdSha256: string;
    reviewHtmlSha256: string;
  };
}

export interface ReviewResultItem {
  auditItemId: string;
  status: ReviewItemStatus;
  issueTypes: ReviewIssueType[];
  comment: string;
}

export interface ReviewResult {
  schemaVersion: 1;
  artifactId: string;
  reviewerUserId?: string;
  status: ReviewStatus;
  startedAt?: string;
  updatedAt?: string;
  finalizedAt?: string;
  items: ReviewResultItem[];
}

export interface ReviewArtifactSummary {
  documentId: string;
  artifactId: string;
  generatedAt: string;
  status: ReviewStatus;
  reviewerUserId?: string;
  finalizedAt?: string;
  focusItemCount: number;
  issueCount: number;
}

export type AuditArtifactCreationResult =
  | { status: "created"; artifactId: string; generatedAt: string }
  | { status: "failed"; error: string };

export interface ProcessDocumentResult {
  chunkCount: number;
  auditSnapshot: AuditPipelineSnapshot;
}

export interface CreateReviewArtifactInput {
  document: Document;
  sourceBuffer: Buffer;
  snapshot: AuditPipelineSnapshot;
  now?: Date;
  artifactId?: string;
  rootDir?: string;
}

export interface FocusSelectionResult {
  items: AuditSourceItem[];
  selectionWarnings: string[];
}
```

- [ ] **Step 4: Implement projection and stable focus selection**

Create `lib/audit/reviewItems.ts`. Use `contentSha256` rather than copying any embedding vector. Resolve table IDs through both `sourceTableId` and `tableObjectId`:

```ts
import { createHash } from "node:crypto";
import type { KnowledgeObject } from "../rag/objects.ts";
import { blockIdAt } from "../rag/sectionTree.ts";
import type {
  AuditPipelineSnapshot,
  AuditSourceItem,
  FocusSelectionResult,
} from "./types.ts";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildAuditReviewItems(
  input: AuditPipelineSnapshot
): AuditSourceItem[] {
  const blockById = new Map(
    input.blocks.map((block, index) => [blockIdAt(index), block])
  );
  const chunksByObject = new Map<string, string[]>();
  for (const chunk of input.chunks) {
    if (!chunk.objectId) continue;
    const ids = chunksByObject.get(chunk.objectId) ?? [];
    ids.push(chunk.id);
    chunksByObject.set(chunk.objectId, ids);
  }

  const tableIdByObject = new Map<string, string>();
  for (const object of input.knowledgeObjects) {
    if (object.objectType !== "structured_table") continue;
    tableIdByObject.set(object.id, object.sourceTableId ?? object.id);
  }
  const ragTableById = new Map(input.ragTables.map((table) => [table.tableId, table]));

  return input.knowledgeObjects.map((object) => {
    const linkedTableObjectId =
      "tableObjectId" in object && typeof object.tableObjectId === "string"
        ? object.tableObjectId
        : undefined;
    const ragTableId =
      object.sourceTableId ??
      (linkedTableObjectId ? tableIdByObject.get(linkedTableObjectId) : undefined) ??
      (object.objectType === "structured_table" ? tableIdByObject.get(object.id) : undefined);
    const ragTable = ragTableId ? ragTableById.get(ragTableId) : undefined;
    const sourceBlockIds = [...(object.sourceBlockIds ?? [])];
    const sourceExcerpt = sourceBlockIds
      .map((id) => blockById.get(id)?.normalizedText)
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    return {
      auditItemId: `${object.objectType}:${object.id}`,
      objectType: object.objectType,
      title: object.title?.trim() || object.id,
      content: object.content,
      sourceExcerpt: sourceExcerpt || undefined,
      tableMarkdown:
        object.objectType === "structured_table"
          ? ragTable?.markdownFull
          : undefined,
      sourcePageStart: object.sourcePageStart,
      sourcePageEnd: object.sourcePageEnd ?? object.sourcePageStart,
      sourceBlockIds,
      sourceTableId: object.sourceTableId,
      sourceRowIndex: object.sourceRowIndex,
      knowledgeObjectId: object.id,
      chunkIds: [...(chunksByObject.get(object.id) ?? [])].sort(),
      ragTableId,
      confidence: object.confidence,
      warnings: [...(object.warnings ?? [])],
      contentSha256: sha256Text(object.content),
      selectedForReview: false,
    };
  });
}

function stableScore(seed: string, id: string): string {
  return sha256Text(`${seed}:${id}`);
}

export function selectFocusReviewItems(
  items: AuditSourceItem[],
  seed: string,
  limit = 20
): FocusSelectionResult {
  const selected = new Map<string, string>();
  const add = (item: AuditSourceItem | undefined, reason: string) => {
    if (!item || selected.size >= limit || selected.has(item.auditItemId)) return;
    selected.set(item.auditItemId, reason);
  };
  const riskItems = items
    .filter((item) => item.warnings.length > 0 || item.confidence < 0.8)
    .sort(
      (a, b) =>
        b.warnings.length - a.warnings.length ||
        a.confidence - b.confidence ||
        a.auditItemId.localeCompare(b.auditItemId)
    );
  for (const item of riskItems) add(item, item.warnings.length ? "warning" : "low_confidence");

  const tableIds = [...new Set(items.map((item) => item.ragTableId).filter(Boolean))] as string[];
  for (const tableId of tableIds.sort()) {
    add(
      items.find((item) => item.ragTableId === tableId && item.objectType === "structured_table"),
      "table_header"
    );
    add(
      items.find((item) => item.ragTableId === tableId && item.objectType === "structured_table_row"),
      "table_representative_row"
    );
  }

  const remaining = items
    .filter((item) => !selected.has(item.auditItemId))
    .sort((a, b) =>
      stableScore(seed, a.auditItemId).localeCompare(stableScore(seed, b.auditItemId))
    );
  const coveredTypes = new Set(
    items.filter((item) => selected.has(item.auditItemId)).map((item) => item.objectType)
  );
  for (const item of remaining) {
    if (!coveredTypes.has(item.objectType)) {
      add(item, "object_type_coverage");
      coveredTypes.add(item.objectType);
    }
  }
  for (const item of remaining) add(item, "stable_sample");

  const hasRequiredTableCoverage = tableIds.every(
    (tableId) =>
      items.some(
        (item) =>
          selected.has(item.auditItemId) &&
          item.ragTableId === tableId &&
          item.objectType === "structured_table"
      ) &&
      items.some(
        (item) =>
          selected.has(item.auditItemId) &&
          item.ragTableId === tableId &&
          item.objectType === "structured_table_row"
      )
  );
  const selectionWarnings = hasRequiredTableCoverage
    ? []
    : ["review_table_coverage_truncated"];

  return {
    items: items.map((item) => ({
      ...item,
      selectedForReview: selected.has(item.auditItemId),
      selectionReason: selected.get(item.auditItemId),
    })),
    selectionWarnings,
  };
}
```

- [ ] **Step 5: Run the targeted test and full suite**

Run:

```powershell
node --experimental-strip-types tests/auditReviewItems.test.ts
npm.cmd test
```

Expected: the new file reports 3 passing tests; the full suite exits 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add lib/audit/types.ts lib/audit/reviewItems.ts tests/auditReviewItems.test.ts tests/index.ts
git diff --cached --check
git commit -m "feat(audit): define review artifact items"
```

---

### Task 2: Render and persist immutable artifact packages

**Files:**
- Create: `lib/audit/renderReviewArtifact.ts`
- Create: `lib/audit/artifactStore.ts`
- Create: `tests/auditArtifactStore.test.ts`
- Modify: `tests/index.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `AuditManifest`, `AuditSourceItem[]`, and `ReviewResult` from Task 1.
- Produces: `renderReviewMarkdown(...)`, `renderReviewHtml(...)`, `createArtifactDirectory(...)`, `loadArtifact(...)`, `listReviewArtifacts(...)`, `verifyArtifactIntegrity(...)`, and `replaceReviewResult(...)`.
- Later tasks rely on the exact route-relative review endpoint embedded by `renderReviewHtml`.

- [ ] **Step 1: Write failing renderer and store tests**

Create `tests/auditArtifactStore.test.ts`. Use a temporary root and clean only the verified directory returned by `mkdtempSync`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
import {
  createArtifactDirectory,
  loadArtifact,
  replaceReviewResult,
  verifyArtifactIntegrity,
} from "../lib/audit/artifactStore.ts";
import { renderReviewHtml } from "../lib/audit/renderReviewArtifact.ts";
import type { AuditManifest, AuditSourceItem, ReviewResult } from "../lib/audit/types.ts";
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
    result: { schemaVersion: 1, artifactId: "artifact-a", status: "pending", items: [] },
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
  fs.appendFileSync(path.join(root, "doc-audit", "artifact-a", "review.html"), "tampered");
  assert.equal(verifyArtifactIntegrity(loadArtifact(root, "doc-audit", "artifact-a")).ok, false);
  assert.throws(() => loadArtifact(root, "../escape", "artifact-a"), /invalid documentId/);
  const manifestPath = path.join(root, "doc-audit", "artifact-a", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, artifactId: "artifact-b" }));
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
```

Append to `tests/index.ts`:

```ts
import "./auditArtifactStore.test.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types tests/auditArtifactStore.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `artifactStore.ts`.

- [ ] **Step 3: Implement escaped Markdown and HTML rendering**

Create `lib/audit/renderReviewArtifact.ts` with these exports. The generated page must use DOM attributes instead of injecting unescaped JSON into a script block:

```ts
import type { AuditManifest, AuditSourceItem } from "./types.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderReviewMarkdown(input: {
  manifest: Omit<AuditManifest, "files">;
  items: AuditSourceItem[];
}): string {
  const lines = [
    `# ${input.manifest.document.fileName} 审核副本`,
    "",
    `- Artifact: ${input.manifest.artifactId}`,
    `- Generated: ${input.manifest.generatedAt}`,
    `- Source SHA-256: ${input.manifest.document.sourceFileSha256}`,
    `- Focus items: ${input.manifest.summary.focusItemCount}`,
    "",
  ];
  for (const item of input.items) {
    lines.push(
      `## ${item.selectedForReview ? "[必审] " : ""}${item.title}`,
      "",
      `- auditItemId: ${item.auditItemId}`,
      `- objectType: ${item.objectType}`,
      `- page: ${item.sourcePageStart ?? "?"}-${item.sourcePageEnd ?? item.sourcePageStart ?? "?"}`,
      `- sourceBlocks: ${item.sourceBlockIds.join(", ") || "none"}`,
      `- chunks: ${item.chunkIds.join(", ") || "none"}`,
      `- RagTable: ${item.ragTableId ?? "none"}`,
      `- confidence: ${item.confidence.toFixed(2)}`,
      `- warnings: ${item.warnings.join(", ") || "none"}`,
      "",
      item.content,
      ""
    );
    if (item.sourceExcerpt) {
      lines.push("### Source Block excerpt", "", item.sourceExcerpt, "");
    }
    if (item.tableMarkdown) lines.push(item.tableMarkdown, "");
  }
  return `${lines.join("\n")}\n`;
}

export function renderReviewHtml(input: {
  documentId: string;
  artifactId: string;
  fileName: string;
  items: AuditSourceItem[];
}): string {
  const endpoint = `/api/documents/${encodeURIComponent(input.documentId)}/review-artifacts/${encodeURIComponent(input.artifactId)}/review`;
  const supportsPagePreview = /\.pdf$/i.test(input.fileName);
  const cards = input.items.map((item) => `
    <article class="item" data-id="${escapeHtml(item.auditItemId)}" data-required="${item.selectedForReview}" data-search="${escapeHtml(`${item.title} ${item.content} ${item.sourceExcerpt ?? ""} ${item.tableMarkdown ?? ""}`.toLowerCase())}">
      <h2>${item.selectedForReview ? '<span class="required">必审</span>' : ""}${escapeHtml(item.title)}</h2>
      <p class="meta">${escapeHtml(item.objectType)} · 页 ${item.sourcePageStart ?? "?"}-${item.sourcePageEnd ?? item.sourcePageStart ?? "?"} · confidence ${item.confidence.toFixed(2)}</p>
      <p class="meta">Object ${escapeHtml(item.knowledgeObjectId)} · Chunk ${escapeHtml(item.chunkIds.join(", ") || "none")} · RagTable ${escapeHtml(item.ragTableId ?? "none")}</p>
      ${item.warnings.length ? `<p class="warning">${escapeHtml(item.warnings.join(", "))}</p>` : ""}
      ${supportsPagePreview && item.sourcePageStart ? `<p><a class="source-page" data-page="${item.sourcePageStart}" target="_blank" rel="noreferrer">查看原文页</a></p>` : ""}
      ${item.sourceExcerpt ? `<details><summary>Source Block 摘录</summary><pre>${escapeHtml(item.sourceExcerpt)}</pre></details>` : ""}
      <pre>${escapeHtml(item.content)}</pre>
      ${item.tableMarkdown ? `<pre class="table">${escapeHtml(item.tableMarkdown)}</pre>` : ""}
      <label>结论 <select class="status"><option value="">未审核</option><option value="passed">通过</option><option value="issue">有问题</option></select></label>
      <label>问题类型 <select class="issue"><option value="">请选择</option><option value="missing_content">内容缺失</option><option value="ocr_error">文本识别错误</option><option value="structure_error">章节或条款结构错误</option><option value="table_error">表格错列、漏行或合并错误</option><option value="source_location_error">原文页码或来源定位错误</option><option value="object_type_error">对象类型识别错误</option><option value="other">其他</option></select></label>
      <label>备注 <textarea class="comment" maxlength="2000"></textarea></label>
    </article>`).join("\n");
  const safeEndpoint = JSON.stringify(endpoint).replaceAll("<", "\\u003c");
  const safeDocumentId = JSON.stringify(input.documentId).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.fileName)} 审核</title>
<style>body{font-family:system-ui;margin:0;background:#f8fafc;color:#1e293b}main{max-width:1040px;margin:auto;padding:24px}.toolbar{position:sticky;top:0;background:#fff;padding:12px;border:1px solid #cbd5e1}.item{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin:16px 0}.meta{color:#64748b;font-size:12px}.required,.warning{color:#b45309}pre{white-space:pre-wrap;background:#f1f5f9;padding:12px;overflow:auto}label{display:block;margin-top:10px}select,textarea,input{width:100%;padding:8px;box-sizing:border-box}button{margin:8px 8px 0 0;padding:8px 14px}</style></head>
<body><main><h1>${escapeHtml(input.fileName)} 审核副本</h1><div class="toolbar"><input id="search" placeholder="搜索全部审核项"><button id="save">保存草稿</button><button id="finalize">最终提交</button><span id="message"></span></div>${cards}</main>
<script>
const endpoint=${safeEndpoint};
const documentId=${safeDocumentId};
const userId=new URLSearchParams(location.search).get("userId")||"";
const api=endpoint+"?userId="+encodeURIComponent(userId);
document.querySelectorAll(".source-page").forEach(link=>{link.href="/api/documents/"+encodeURIComponent(documentId)+"/page?n="+encodeURIComponent(link.dataset.page)+"&userId="+encodeURIComponent(userId)});
const rows=[...document.querySelectorAll(".item")];
function collect(){return rows.map(row=>{const status=row.querySelector(".status").value;if(!status)return null;const issue=row.querySelector(".issue").value;return{auditItemId:row.dataset.id,status,issueTypes:issue?[issue]:[],comment:row.querySelector(".comment").value.trim()}}).filter(Boolean)}
function apply(result){for(const item of result.items||[]){const row=rows.find(x=>x.dataset.id===item.auditItemId);if(!row)continue;row.querySelector(".status").value=item.status;row.querySelector(".issue").value=item.issueTypes?.[0]||"";row.querySelector(".comment").value=item.comment||""}if(result.finalizedAt){document.querySelectorAll("select,textarea,button").forEach(x=>x.disabled=true)}}
async function request(action){const response=await fetch(api,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,items:collect()})});const data=await response.json();document.querySelector("#message").textContent=response.ok?(action==="finalize"?"已提交":"草稿已保存"):(data.error||"保存失败");if(response.ok)apply(data.result)}
document.querySelector("#save").onclick=()=>request("save_draft");document.querySelector("#finalize").onclick=()=>request("finalize");document.querySelector("#search").oninput=e=>{const q=e.target.value.toLowerCase();rows.forEach(row=>row.hidden=!row.dataset.search.includes(q))};
fetch(api,{cache:"no-store"}).then(r=>r.json()).then(data=>{if(data.result)apply(data.result);if(data.canSubmit===false){document.querySelector("#message").textContent=data.error||"当前快照不可提交";document.querySelectorAll("select,textarea,button").forEach(x=>x.disabled=true)}});
</script></body></html>`;
}
```

- [ ] **Step 4: Implement safe artifact storage and integrity checks**

Create `lib/audit/artifactStore.ts`. Use `path.relative` for containment checks before every recursive cleanup or read:

```ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AuditManifest,
  ReviewArtifactSummary,
  ReviewResult,
} from "./types.ts";
import { sha256Text } from "./reviewItems.ts";

export const DEFAULT_ARTIFACT_ROOT = path.join(process.cwd(), "artifacts");
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function validateId(kind: string, value: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`invalid ${kind}`);
}

function childPath(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("artifact path escaped root");
  }
  return resolved;
}

export interface LoadedArtifact {
  directory: string;
  manifest: AuditManifest;
  reviewMd: string;
  reviewHtml: string;
  result: ReviewResult;
}

export function createArtifactDirectory(input: {
  rootDir?: string;
  documentId: string;
  manifest: AuditManifest;
  reviewMd: string;
  reviewHtml: string;
  result: ReviewResult;
}): string {
  validateId("documentId", input.documentId);
  validateId("artifactId", input.manifest.artifactId);
  const root = input.rootDir ?? DEFAULT_ARTIFACT_ROOT;
  const docDir = childPath(root, input.documentId);
  const finalDir = childPath(docDir, input.manifest.artifactId);
  const tempDir = childPath(docDir, `.tmp-${input.manifest.artifactId}`);
  fs.mkdirSync(docDir, { recursive: true });
  if (fs.existsSync(finalDir)) throw new Error("artifact already exists");
  fs.mkdirSync(tempDir);
  try {
    fs.writeFileSync(path.join(tempDir, "review.md"), input.reviewMd, "utf8");
    fs.writeFileSync(path.join(tempDir, "review.html"), input.reviewHtml, "utf8");
    fs.writeFileSync(path.join(tempDir, "review-result.json"), JSON.stringify(input.result, null, 2), "utf8");
    fs.writeFileSync(path.join(tempDir, "manifest.json"), JSON.stringify(input.manifest, null, 2), "utf8");
    fs.renameSync(tempDir, finalDir);
    return finalDir;
  } catch (error) {
    const relative = path.relative(path.resolve(root), tempDir);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export function loadArtifact(
  rootDir: string,
  documentId: string,
  artifactId: string
): LoadedArtifact {
  validateId("documentId", documentId);
  validateId("artifactId", artifactId);
  const directory = childPath(rootDir, documentId, artifactId);
  const manifest: AuditManifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8")
  );
  const result: ReviewResult = JSON.parse(
    fs.readFileSync(path.join(directory, "review-result.json"), "utf8")
  );
  if (
    manifest.document.id !== documentId ||
    manifest.artifactId !== artifactId ||
    result.artifactId !== artifactId
  ) {
    throw new Error("artifact identity mismatch");
  }
  return {
    directory,
    manifest,
    reviewMd: fs.readFileSync(path.join(directory, "review.md"), "utf8"),
    reviewHtml: fs.readFileSync(path.join(directory, "review.html"), "utf8"),
    result,
  };
}

export function verifyArtifactIntegrity(
  artifact: LoadedArtifact
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (sha256Text(artifact.reviewMd) !== artifact.manifest.files.reviewMdSha256) errors.push("review_md_hash_mismatch");
  if (sha256Text(artifact.reviewHtml) !== artifact.manifest.files.reviewHtmlSha256) errors.push("review_html_hash_mismatch");
  return { ok: errors.length === 0, errors };
}

export function replaceReviewResult(
  rootDir: string,
  documentId: string,
  artifactId: string,
  result: ReviewResult
): void {
  const loaded = loadArtifact(rootDir, documentId, artifactId);
  if (loaded.result.finalizedAt) throw new Error("review already finalized");
  const target = path.join(loaded.directory, "review-result.json");
  const temp = path.join(loaded.directory, `.review-result-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(result, null, 2), "utf8");
    fs.renameSync(temp, target);
  } catch (error) {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }
}

export function listReviewArtifacts(
  documentId: string,
  rootDir = DEFAULT_ARTIFACT_ROOT
): ReviewArtifactSummary[] {
  validateId("documentId", documentId);
  const docDir = childPath(rootDir, documentId);
  if (!fs.existsSync(docDir)) return [];
  return fs.readdirSync(docDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".tmp-") && SAFE_ID.test(entry.name))
    .map((entry) => loadArtifact(rootDir, documentId, entry.name))
    .map((artifact) => ({
      documentId,
      artifactId: artifact.manifest.artifactId,
      generatedAt: artifact.manifest.generatedAt,
      status: artifact.result.status,
      reviewerUserId: artifact.result.reviewerUserId,
      finalizedAt: artifact.result.finalizedAt,
      focusItemCount: artifact.manifest.summary.focusItemCount,
      issueCount: artifact.result.items.filter((item) => item.status === "issue").length,
    }))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
```

Add the generated artifact directory to `.gitignore`:

```gitignore
# 可审计审核副本（运行时生成物）
/artifacts/
```

- [ ] **Step 5: Run targeted tests and confirm only intended files changed**

```powershell
node --experimental-strip-types tests/auditArtifactStore.test.ts
npm.cmd test
git status --short
```

Expected: renderer/store tests pass; the full suite exits 0; only Task 2 files plus the Task 1 commit history are present.

- [ ] **Step 6: Commit Task 2**

```powershell
git add .gitignore lib/audit/renderReviewArtifact.ts lib/audit/artifactStore.ts tests/auditArtifactStore.test.ts tests/index.ts
git diff --cached --check
git commit -m "feat(audit): persist immutable review packages"
```

---

### Task 3: Validate drafts and lock finalized reviews

**Files:**
- Create: `lib/audit/reviewSubmission.ts`
- Create: `tests/auditReviewSubmission.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Consumes: `AuditManifest`, current `ReviewResult`, untrusted request body, reviewer user ID, and current time.
- Produces: `applyReviewSubmission(...) => ReviewResult` or `ReviewSubmissionError` with status 400/409.
- The review API in Task 5 must use this function and must not duplicate its validation.

- [ ] **Step 1: Write failing state-machine tests**

Create `tests/auditReviewSubmission.test.ts` with these cases: valid draft, incomplete finalize, issue without type/comment, foreign draft owner, and finalized lock.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { applyReviewSubmission, ReviewSubmissionError } from "../lib/audit/reviewSubmission.ts";
import type { AuditManifest, ReviewResult } from "../lib/audit/types.ts";

const manifest = {
  schemaVersion: 1,
  artifactId: "artifact-a",
  items: [
    { auditItemId: "obj:a", selectedForReview: true },
    { auditItemId: "obj:b", selectedForReview: true },
    { auditItemId: "obj:c", selectedForReview: false },
  ],
} as AuditManifest;
const pending: ReviewResult = {
  schemaVersion: 1,
  artifactId: "artifact-a",
  status: "pending",
  items: [],
};

test("saves a valid draft and assigns its reviewer", () => {
  const result = applyReviewSubmission({
    manifest,
    current: pending,
    reviewerUserId: "user-admin",
    now: "2026-07-15T01:00:00.000Z",
    body: { action: "save_draft", items: [{ auditItemId: "obj:a", status: "passed", issueTypes: [], comment: "" }] },
  });
  assert.equal(result.status, "draft");
  assert.equal(result.reviewerUserId, "user-admin");
  assert.equal(result.startedAt, "2026-07-15T01:00:00.000Z");
});

test("requires every focus item before finalizing", () => {
  assert.throws(
    () => applyReviewSubmission({ manifest, current: pending, reviewerUserId: "user-admin", now: "2026-07-15T01:00:00.000Z", body: { action: "finalize", items: [{ auditItemId: "obj:a", status: "passed", issueTypes: [], comment: "" }] } }),
    (error) => error instanceof ReviewSubmissionError && error.status === 400 && error.message === "重点审核项尚未全部完成"
  );
});

test("requires issue type and comment", () => {
  assert.throws(
    () => applyReviewSubmission({ manifest, current: pending, reviewerUserId: "user-admin", now: "2026-07-15T01:00:00.000Z", body: { action: "save_draft", items: [{ auditItemId: "obj:a", status: "issue", issueTypes: [], comment: "" }] } }),
    /问题项必须选择问题类型并填写备注/
  );
});

test("locks a draft to one reviewer and never overwrites final results", () => {
  const owned = { ...pending, status: "draft", reviewerUserId: "user-admin", startedAt: "2026-07-15T01:00:00.000Z" } as ReviewResult;
  assert.throws(() => applyReviewSubmission({ manifest, current: owned, reviewerUserId: "user-manager", now: "2026-07-15T02:00:00.000Z", body: { action: "save_draft", items: [] } }), /审核草稿已由其他用户领取/);
  const final = { ...owned, status: "passed", finalizedAt: "2026-07-15T02:00:00.000Z" } as ReviewResult;
  assert.throws(() => applyReviewSubmission({ manifest, current: final, reviewerUserId: "user-admin", now: "2026-07-15T03:00:00.000Z", body: { action: "save_draft", items: [] } }), /审核结果已提交/);
});
```

Append:

```ts
import "./auditReviewSubmission.test.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types tests/auditReviewSubmission.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `reviewSubmission.ts`.

- [ ] **Step 3: Implement strict request parsing and transitions**

Create `lib/audit/reviewSubmission.ts`:

```ts
import {
  REVIEW_ISSUE_TYPES,
  type AuditManifest,
  type ReviewIssueType,
  type ReviewResult,
  type ReviewResultItem,
} from "./types.ts";

export class ReviewSubmissionError extends Error {
  constructor(message: string, public readonly status: 400 | 409) {
    super(message);
  }
}

function parseItems(body: unknown, manifest: AuditManifest): ReviewResultItem[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) {
    throw new ReviewSubmissionError("审核请求格式无效", 400);
  }
  const allowedIds = new Set(manifest.items.map((item) => item.auditItemId));
  const issueTypes = new Set<string>(REVIEW_ISSUE_TYPES);
  const seen = new Set<string>();
  return (body as { items: unknown[] }).items.map((raw) => {
    if (!raw || typeof raw !== "object") throw new ReviewSubmissionError("审核项格式无效", 400);
    const item = raw as Record<string, unknown>;
    const auditItemId = typeof item.auditItemId === "string" ? item.auditItemId : "";
    if (!allowedIds.has(auditItemId) || seen.has(auditItemId)) throw new ReviewSubmissionError("审核项不存在或重复", 400);
    seen.add(auditItemId);
    if (item.status !== "passed" && item.status !== "issue") throw new ReviewSubmissionError("审核状态无效", 400);
    const rawTypes = Array.isArray(item.issueTypes) ? item.issueTypes : [];
    if (!rawTypes.every((value) => typeof value === "string" && issueTypes.has(value))) throw new ReviewSubmissionError("问题类型无效", 400);
    const comment = typeof item.comment === "string" ? item.comment.trim() : "";
    if (comment.length > 2000) throw new ReviewSubmissionError("备注不能超过 2000 字", 400);
    if (item.status === "issue" && (!rawTypes.length || !comment)) throw new ReviewSubmissionError("问题项必须选择问题类型并填写备注", 400);
    return {
      auditItemId,
      status: item.status,
      issueTypes: item.status === "issue" ? (rawTypes as ReviewIssueType[]) : [],
      comment: item.status === "issue" ? comment : "",
    };
  });
}

export function applyReviewSubmission(input: {
  manifest: AuditManifest;
  current: ReviewResult;
  reviewerUserId: string;
  now: string;
  body: unknown;
}): ReviewResult {
  if (input.current.finalizedAt) throw new ReviewSubmissionError("审核结果已提交", 409);
  if (input.current.reviewerUserId && input.current.reviewerUserId !== input.reviewerUserId) {
    throw new ReviewSubmissionError("审核草稿已由其他用户领取", 409);
  }
  const body = input.body as { action?: unknown };
  if (body?.action !== "save_draft" && body?.action !== "finalize") {
    throw new ReviewSubmissionError("审核动作无效", 400);
  }
  const items = parseItems(input.body, input.manifest);
  if (body.action === "finalize") {
    const reviewed = new Set(items.map((item) => item.auditItemId));
    const missing = input.manifest.items.some(
      (item) => item.selectedForReview && !reviewed.has(item.auditItemId)
    );
    if (missing) throw new ReviewSubmissionError("重点审核项尚未全部完成", 400);
  }
  const startedAt = input.current.startedAt ?? input.now;
  const hasIssues = items.some((item) => item.status === "issue");
  return {
    schemaVersion: 1,
    artifactId: input.manifest.artifactId,
    reviewerUserId: input.reviewerUserId,
    status: body.action === "save_draft" ? "draft" : hasIssues ? "issues_found" : "passed",
    startedAt,
    updatedAt: input.now,
    finalizedAt: body.action === "finalize" ? input.now : undefined,
    items,
  };
}
```

- [ ] **Step 4: Run targeted and full tests**

```powershell
node --experimental-strip-types tests/auditReviewSubmission.test.ts
npm.cmd test
```

Expected: 4 new tests pass; full suite exits 0.

- [ ] **Step 5: Commit Task 3**

```powershell
git add lib/audit/reviewSubmission.ts tests/auditReviewSubmission.test.ts tests/index.ts
git diff --cached --check
git commit -m "feat(audit): validate review submissions"
```

---

### Task 4: Build artifacts from the persisted processing result

**Files:**
- Create: `lib/audit/createReviewArtifact.ts`
- Create: `tests/auditCreateReviewArtifact.test.ts`
- Modify: `tests/index.ts`
- Modify: `lib/db/chunks.ts:5-18,56-140`
- Modify: `app/api/documents/[id]/process/route.ts:7-11,76-82`

**Interfaces:**
- `processDocument(...)` changes from `Promise<number>` to `Promise<ProcessDocumentResult>`.
- `createReviewArtifact(input: CreateReviewArtifactInput): { artifactId: string; generatedAt: string }` consumes the returned snapshot and source buffer.
- The process API returns `auditArtifact: AuditArtifactCreationResult` in every non-skipped successful processing response.

- [ ] **Step 1: Write a failing end-to-end artifact builder test**

Create `tests/auditCreateReviewArtifact.test.ts`. Use a temporary root, one KnowledgeObject, one Chunk containing an embedding, and a fixed artifact ID. Assert that the package is created and no file contains the embedding values:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createReviewArtifact,
  tryCreateReviewArtifact,
} from "../lib/audit/createReviewArtifact.ts";
import { loadArtifact } from "../lib/audit/artifactStore.ts";
import type { Document } from "../lib/types.ts";

test("creates a traceable package without serializing embeddings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-builder-"));
  try {
    const document: Document = { id: "doc-audit", fileName: "audit.txt", city: "北京", fileType: "其他", enabled: true, status: "indexed", createdAt: "2026-07-15T00:00:00.000Z" };
    const created = createReviewArtifact({
      document,
      sourceBuffer: Buffer.from("source"),
      rootDir: root,
      artifactId: "artifact-a",
      now: new Date("2026-07-15T00:00:00.000Z"),
      snapshot: {
        blocks: [],
        warnings: [],
        ragTables: [],
        knowledgeObjects: [{ id: "obj-1", docId: "doc-audit", objectType: "plain_section", title: "范围", content: "适用范围", sectionPath: [], sectionPathText: "", sourcePageStart: 1, confidence: 0.95 }],
        chunks: [{ id: "chunk-1", documentId: "doc-audit", fileName: "audit.txt", city: "北京", chunkType: "paragraph", objectId: "obj-1", content: "适用范围", keywords: [], embedding: [0.123456789, 0.987654321], createdAt: "2026-07-15T00:00:00.000Z" }],
      },
    });
    assert.equal(created.artifactId, "artifact-a");
    const loaded = loadArtifact(root, "doc-audit", "artifact-a");
    const allFiles = fs.readdirSync(loaded.directory).map((name) => fs.readFileSync(path.join(loaded.directory, name), "utf8")).join("\n");
    assert.equal(allFiles.includes("0.123456789"), false);
    assert.deepEqual(loaded.manifest.items[0].chunkIds, ["chunk-1"]);
    assert.equal(loaded.result.status, "pending");
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("converts artifact writer failure into an audit-only result", () => {
  const result = tryCreateReviewArtifact(
    {} as never,
    () => {
      throw new Error("disk unavailable");
    }
  );
  assert.deepEqual(result, { status: "failed", error: "disk unavailable" });
});
```

Append:

```ts
import "./auditCreateReviewArtifact.test.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types tests/auditCreateReviewArtifact.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `createReviewArtifact.ts`.

- [ ] **Step 3: Implement the artifact builder**

Create `lib/audit/createReviewArtifact.ts`. Generate a URL-safe ID, compute hashes before constructing the final manifest, and create an initial pending result:

```ts
import { createHash, randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "../db/persist.ts";
import { getEmbeddingProvider } from "../ai/embedding.ts";
import { buildAuditReviewItems, selectFocusReviewItems, sha256Text } from "./reviewItems.ts";
import { renderReviewHtml, renderReviewMarkdown } from "./renderReviewArtifact.ts";
import { createArtifactDirectory } from "./artifactStore.ts";
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
  const selected = selectFocusReviewItems(projected, `${input.document.id}:${artifactId}`);
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
      warningCount: input.snapshot.warnings.length + selected.items.reduce((sum, item) => sum + item.warnings.length, 0),
      focusItemCount: selected.items.filter((item) => item.selectedForReview).length,
      selectionWarnings: selected.selectionWarnings,
    },
    items: selected.items.map(({ content: _content, sourceExcerpt: _source, tableMarkdown: _table, ...item }) => item),
  };
  const reviewMd = renderReviewMarkdown({ manifest: manifestWithoutFiles, items: selected.items });
  const reviewHtml = renderReviewHtml({ documentId: input.document.id, artifactId, fileName: input.document.fileName, items: selected.items });
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
    result: { schemaVersion: 1, artifactId, status: "pending", items: [] },
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
```

- [ ] **Step 4: Return the narrow snapshot from `processDocument`**

In `lib/db/chunks.ts`, import `ProcessDocumentResult`, change the return annotation, and replace the final return. Do not call audit code from this database module:

```ts
import type { ProcessDocumentResult } from "@/lib/audit/types";

export async function processDocument(
  doc: Document,
  input: { blocks?: Block[]; text?: string } = {}
): Promise<ProcessDocumentResult> {
  // existing processing remains unchanged
  return {
    chunkCount: chunks.length,
    auditSnapshot: {
      blocks: buildResult.blocks,
      knowledgeObjects: buildResult.knowledgeObjects,
      chunks,
      ragTables,
      warnings: [
        ...buildResult.warnings,
        ...(buildResult.fallbackUsed ? ["fallback_to_legacy_chunkBlocks"] : []),
      ],
    },
  };
}
```

- [ ] **Step 5: Isolate artifact failure in the process route**

In `app/api/documents/[id]/process/route.ts`, import `tryCreateReviewArtifact`. Replace the lines that expect a numeric count with this exact control flow:

```ts
const processed = await processDocument(doc, { blocks, text });
const updated = await updateDocument(doc.id, { status: "indexed" });
const auditArtifact = tryCreateReviewArtifact({
  document: updated ?? doc,
  sourceBuffer: buf,
  snapshot: processed.auditSnapshot,
});
if (auditArtifact.status === "failed") {
  console.error("[process] review artifact creation failed:", auditArtifact.error);
}
return NextResponse.json({
  document: updated,
  chunkCount: processed.chunkCount,
  extractedChars,
  auditArtifact,
});
```

Keep the `updateDocument(..., { status: "indexed" })` call before `tryCreateReviewArtifact`; the wrapper must consume writer errors so they cannot reach the outer catch that marks the document `failed`.

- [ ] **Step 6: Run targeted tests, type checking, and full tests**

```powershell
node --experimental-strip-types tests/auditCreateReviewArtifact.test.ts
npx.cmd tsc --noEmit
npm.cmd test
```

Expected: builder test passes; TypeScript exits 0 after all `processDocument` call sites use `processed.chunkCount`; full suite exits 0.

- [ ] **Step 7: Commit Task 4**

```powershell
git add lib/audit/createReviewArtifact.ts lib/db/chunks.ts app/api/documents/[id]/process/route.ts tests/auditCreateReviewArtifact.test.ts tests/index.ts
git diff --cached --check
git commit -m "feat(audit): create review package after indexing"
```

---

### Task 5: Add protected artifact and review APIs

**Files:**
- Create: `lib/audit/reviewAvailability.ts`
- Modify: `tests/auditReviewSubmission.test.ts`
- Create: `app/api/documents/[id]/review-artifacts/access.ts`
- Create: `app/api/documents/[id]/review-artifacts/route.ts`
- Create: `app/api/documents/[id]/review-artifacts/[artifactId]/route.ts`
- Create: `app/api/documents/[id]/review-artifacts/[artifactId]/review/route.ts`

**Interfaces:**
- List response: `{ artifacts: ReviewArtifactSummary[] }`.
- Artifact response formats: default/`html`, `markdown`, and `manifest`.
- Review GET response: `{ result, canSubmit, error? }`.
- Review PUT request: `{ action: "save_draft" | "finalize", items: ReviewResultItem[] }`.
- Review PUT response: `{ result }`; validation errors use 400, locks/integrity/source mismatch use 409.

- [ ] **Step 1: Add a failing availability-gate test**

Extend the import section and append these cases to `tests/auditReviewSubmission.test.ts`:

```ts
import { evaluateReviewAvailability } from "../lib/audit/reviewAvailability.ts";

test("blocks submission for integrity, source, and finalization failures", () => {
  assert.deepEqual(
    evaluateReviewAvailability({ integrityOk: false, sourceMatches: true }),
    { canSubmit: false, error: "审核副本完整性校验失败" }
  );
  assert.deepEqual(
    evaluateReviewAvailability({ integrityOk: true, sourceMatches: false }),
    { canSubmit: false, error: "原文件已变化，旧快照不能提交" }
  );
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: true,
      finalizedAt: "2026-07-15T03:00:00.000Z",
    }),
    { canSubmit: false, error: "审核结果已提交" }
  );
  assert.deepEqual(
    evaluateReviewAvailability({ integrityOk: true, sourceMatches: true }),
    { canSubmit: true }
  );
});
```

- [ ] **Step 2: Run the gate test to verify it fails**

```powershell
node --experimental-strip-types tests/auditReviewSubmission.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `reviewAvailability.ts`.

- [ ] **Step 3: Implement the pure availability gate**

Create `lib/audit/reviewAvailability.ts`:

```ts
export function evaluateReviewAvailability(input: {
  integrityOk: boolean;
  sourceMatches: boolean;
  finalizedAt?: string;
}): { canSubmit: boolean; error?: string } {
  if (!input.integrityOk) {
    return { canSubmit: false, error: "审核副本完整性校验失败" };
  }
  if (!input.sourceMatches) {
    return { canSubmit: false, error: "原文件已变化，旧快照不能提交" };
  }
  if (input.finalizedAt) {
    return { canSubmit: false, error: "审核结果已提交" };
  }
  return { canSubmit: true };
}
```

- [ ] **Step 4: Add the shared document-management access guard**

Create `access.ts` so every route has the same 404/403 behavior:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/db/documents";
import {
  canManageDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";

export async function resolveReviewAccess(req: NextRequest, documentId: string) {
  const document = await getDocument(documentId);
  if (!document) return { error: NextResponse.json({ error: "文档不存在" }, { status: 404 }) };
  const user = resolveKnowledgeUser({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
  });
  if (!canManageDocumentInManagement(user, document)) {
    return { error: NextResponse.json({ error: "当前账号无权审核该文档" }, { status: 403 }) };
  }
  return { document, user };
}
```

- [ ] **Step 5: Implement snapshot listing**

Create `app/api/documents/[id]/review-artifacts/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { listReviewArtifacts } from "@/lib/audit/artifactStore";
import { resolveReviewAccess } from "./access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await resolveReviewAccess(req, params.id);
  if ("error" in access) return access.error;
  try {
    return NextResponse.json({ artifacts: listReviewArtifacts(params.id) });
  } catch (error) {
    console.error("[review] artifact listing failed:", error);
    return NextResponse.json({ error: "审核副本读取失败" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Implement protected immutable-file serving**

Create `app/api/documents/[id]/review-artifacts/[artifactId]/route.ts`. Verify hashes before serving any artifact:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_ARTIFACT_ROOT,
  loadArtifact,
  verifyArtifactIntegrity,
} from "@/lib/audit/artifactStore";
import { resolveReviewAccess } from "../access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string; artifactId: string } }) {
  const access = await resolveReviewAccess(req, params.id);
  if ("error" in access) return access.error;
  let artifact;
  try {
    artifact = loadArtifact(DEFAULT_ARTIFACT_ROOT, params.id, params.artifactId);
  } catch {
    return NextResponse.json({ error: "审核副本不存在" }, { status: 404 });
  }
  const integrity = verifyArtifactIntegrity(artifact);
  if (!integrity.ok) {
    return NextResponse.json({ error: "审核副本完整性校验失败", details: integrity.errors }, { status: 409 });
  }
  const format = req.nextUrl.searchParams.get("format") ?? "html";
  if (format === "manifest") return NextResponse.json(artifact.manifest);
  if (format === "markdown") {
    return new NextResponse(artifact.reviewMd, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
  if (format !== "html") return NextResponse.json({ error: "审核副本格式无效" }, { status: 400 });
  return new NextResponse(artifact.reviewHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 7: Implement review GET/PUT with source and integrity gates**

Create `app/api/documents/[id]/review-artifacts/[artifactId]/review/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db/store";
import {
  DEFAULT_ARTIFACT_ROOT,
  loadArtifact,
  replaceReviewResult,
  verifyArtifactIntegrity,
} from "@/lib/audit/artifactStore";
import { sha256Buffer } from "@/lib/audit/createReviewArtifact";
import {
  applyReviewSubmission,
  ReviewSubmissionError,
} from "@/lib/audit/reviewSubmission";
import { evaluateReviewAvailability } from "@/lib/audit/reviewAvailability";
import { resolveReviewAccess } from "../../access";

function loadChecked(documentId: string, artifactId: string) {
  const artifact = loadArtifact(DEFAULT_ARTIFACT_ROOT, documentId, artifactId);
  const integrity = verifyArtifactIntegrity(artifact);
  const source = getStore().rawBuffers[documentId];
  const sourceMatches = Boolean(
    source && sha256Buffer(source) === artifact.manifest.document.sourceFileSha256
  );
  return { artifact, integrity, sourceMatches };
}

export async function GET(req: NextRequest, { params }: { params: { id: string; artifactId: string } }) {
  const access = await resolveReviewAccess(req, params.id);
  if ("error" in access) return access.error;
  try {
    const checked = loadChecked(params.id, params.artifactId);
    const availability = evaluateReviewAvailability({
      integrityOk: checked.integrity.ok,
      sourceMatches: checked.sourceMatches,
      finalizedAt: checked.artifact.result.finalizedAt,
    });
    return NextResponse.json({
      result: checked.artifact.result,
      ...availability,
    });
  } catch {
    return NextResponse.json({ error: "审核副本不存在" }, { status: 404 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; artifactId: string } }) {
  const access = await resolveReviewAccess(req, params.id);
  if ("error" in access) return access.error;
  let checked: ReturnType<typeof loadChecked>;
  try {
    checked = loadChecked(params.id, params.artifactId);
  } catch {
    return NextResponse.json({ error: "审核副本不存在" }, { status: 404 });
  }
  const availability = evaluateReviewAvailability({
    integrityOk: checked.integrity.ok,
    sourceMatches: checked.sourceMatches,
    finalizedAt: checked.artifact.result.finalizedAt,
  });
  if (!availability.canSubmit) {
    return NextResponse.json({ error: availability.error }, { status: 409 });
  }
  try {
    const body = await req.json().catch(() => null);
    const result = applyReviewSubmission({
      manifest: checked.artifact.manifest,
      current: checked.artifact.result,
      reviewerUserId: access.user.id,
      now: new Date().toISOString(),
      body,
    });
    replaceReviewResult(DEFAULT_ARTIFACT_ROOT, params.id, params.artifactId, result);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ReviewSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "review already finalized") {
      return NextResponse.json({ error: "审核结果已提交" }, { status: 409 });
    }
    console.error("[review] save failed:", error);
    return NextResponse.json({ error: "审核结果保存失败" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run targeted tests, type checking, and build**

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: all commands exit 0; build output lists the three new review-artifact route groups.

- [ ] **Step 9: Commit Task 5**

```powershell
git add lib/audit/reviewAvailability.ts tests/auditReviewSubmission.test.ts app/api/documents/[id]/review-artifacts
git diff --cached --check
git commit -m "feat(audit): expose protected review APIs"
```

---

### Task 6: Surface review status in document management

**Files:**
- Create: `lib/audit/reviewPresentation.ts`
- Create: `tests/auditReviewPresentation.test.ts`
- Create: `components/ReviewArtifactControl.tsx`
- Modify: `components/DocumentTable.tsx:3-30,58-63,95-103,171-185,454-489`
- Modify: `tests/index.ts`

**Interfaces:**
- `reviewStatusMeta(status)` returns existing `Badge` variants and Chinese labels.
- `ReviewArtifactControl` props are `{ documentId, currentUserId, refreshToken }`.
- `DocumentTable` increments `refreshToken` after every single or batch process request.

- [ ] **Step 1: Write the failing presentation mapping test**

Create `tests/auditReviewPresentation.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { reviewStatusMeta } from "../lib/audit/reviewPresentation.ts";

test("maps every review status to an explicit badge", () => {
  assert.deepEqual(reviewStatusMeta("pending"), { label: "待审核", variant: "warning" });
  assert.deepEqual(reviewStatusMeta("draft"), { label: "审核中", variant: "info" });
  assert.deepEqual(reviewStatusMeta("passed"), { label: "审核通过", variant: "success" });
  assert.deepEqual(reviewStatusMeta("issues_found"), { label: "发现问题", variant: "destructive" });
});
```

Append:

```ts
import "./auditReviewPresentation.test.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
node --experimental-strip-types tests/auditReviewPresentation.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `reviewPresentation.ts`.

- [ ] **Step 3: Implement the pure presentation mapping**

Create `lib/audit/reviewPresentation.ts`:

```ts
import type { ReviewStatus } from "./types.ts";

export function reviewStatusMeta(status: ReviewStatus): {
  label: string;
  variant: "warning" | "info" | "success" | "destructive";
} {
  return {
    pending: { label: "待审核", variant: "warning" },
    draft: { label: "审核中", variant: "info" },
    passed: { label: "审核通过", variant: "success" },
    issues_found: { label: "发现问题", variant: "destructive" },
  }[status];
}
```

- [ ] **Step 4: Add the independent review control**

Create `components/ReviewArtifactControl.tsx`. Fetch history with `cache: "no-store"`, default to the latest snapshot, and keep URLs permission-scoped with `userId`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ReviewArtifactSummary } from "@/lib/audit/types";
import { reviewStatusMeta } from "@/lib/audit/reviewPresentation";

export function ReviewArtifactControl({
  documentId,
  currentUserId,
  refreshToken,
}: {
  documentId: string;
  currentUserId: string;
  refreshToken: number;
}) {
  const [artifacts, setArtifacts] = useState<ReviewArtifactSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/documents/${encodeURIComponent(documentId)}/review-artifacts?userId=${encodeURIComponent(currentUserId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "审核副本读取失败");
        return data;
      })
      .then((data) => {
        if (!active) return;
        const next = (data.artifacts ?? []) as ReviewArtifactSummary[];
        setArtifacts(next);
        setSelectedId((current) => next.some((item) => item.artifactId === current) ? current : next[0]?.artifactId ?? "");
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "审核副本读取失败");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [documentId, currentUserId, refreshToken]);

  if (loading) return <span className="text-xs text-muted-foreground">读取审核状态…</span>;
  if (error) return <Badge variant="destructive">{error}</Badge>;
  if (!artifacts.length) return <Badge variant="secondary">无审核副本</Badge>;
  const selected = artifacts.find((item) => item.artifactId === selectedId) ?? artifacts[0];
  const status = reviewStatusMeta(selected.status);
  const href = `/api/documents/${encodeURIComponent(documentId)}/review-artifacts/${encodeURIComponent(selected.artifactId)}?format=html&userId=${encodeURIComponent(currentUserId)}`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="text-[11px] text-muted-foreground">{artifacts.length} 个快照</span>
      </div>
      {artifacts.length > 1 && (
        <Select className="h-8 text-xs" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {artifacts.map((item) => <option key={item.artifactId} value={item.artifactId}>{new Date(item.generatedAt).toLocaleString("zh-CN")}</option>)}
        </Select>
      )}
      <Button asChild size="sm" variant="outline">
        <a href={href} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />打开审核</a>
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Integrate process notices and refresh into `DocumentTable`**

Add these imports and states:

```tsx
import { ReviewArtifactControl } from "@/components/ReviewArtifactControl";

const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
const [auditNotices, setAuditNotices] = useState<Record<string, string>>({});
```

Replace the single-document `process` function so it checks the response and records audit-only failure separately from parsing failure:

```tsx
async function process(id: string) {
  setBusyId(id);
  try {
    const res = await fetch(withUser(`/api/documents/${id}/process`), {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `解析失败：${res.status}`);
    setAuditNotices((current) => ({
      ...current,
      [id]:
        data.auditArtifact?.status === "failed"
          ? `索引成功，但审核副本生成失败：${data.auditArtifact.error}`
          : "",
    }));
    setReviewRefreshToken((value) => value + 1);
    onChange();
  } catch (error) {
    setAuditNotices((current) => ({
      ...current,
      [id]: error instanceof Error ? error.message : "解析失败",
    }));
  } finally {
    setBusyId(null);
  }
}
```

Replace `batchProcess` with the explicit serial loop below. Parsing failures stop the batch and remain visible on the affected document; audit-only failures do not stop later documents:

```tsx
async function batchProcess() {
  setBatchBusy(true);
  try {
    for (let i = 0; i < selectedIds.length; i++) {
      const id = selectedIds[i];
      setBatchProgress(`解析中 ${i + 1}/${selectedIds.length}`);
      const res = await fetch(withUser(`/api/documents/${id}/process`), {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error ?? `解析失败：${res.status}`;
        setAuditNotices((current) => ({ ...current, [id]: message }));
        break;
      }
      setAuditNotices((current) => ({
        ...current,
        [id]:
          data.auditArtifact?.status === "failed"
            ? `索引成功，但审核副本生成失败：${data.auditArtifact.error}`
            : "",
      }));
    }
  } finally {
    setReviewRefreshToken((value) => value + 1);
    onChange();
    setBatchBusy(false);
    setBatchProgress(null);
  }
}
```

Render the control in the action column above “重新解析”:

```tsx
{canManage ? (
  <ReviewArtifactControl
    documentId={doc.id}
    currentUserId={currentUser.id}
    refreshToken={reviewRefreshToken}
  />
) : (
  <Badge variant="outline">无审核权限</Badge>
)}
{canManage && auditNotices[doc.id] && (
  <p className="text-xs text-destructive">{auditNotices[doc.id]}</p>
)}
```

- [ ] **Step 6: Run tests, type checking, and build**

```powershell
node --experimental-strip-types tests/auditReviewPresentation.test.ts
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: all commands exit 0; document management compiles with no new dependency.

- [ ] **Step 7: Commit Task 6**

```powershell
git add lib/audit/reviewPresentation.ts components/ReviewArtifactControl.tsx components/DocumentTable.tsx tests/auditReviewPresentation.test.ts tests/index.ts
git diff --cached --check
git commit -m "feat(audit): add document review controls"
```

---

### Task 7: Run the five-document pilot and record the decision

**Files:**
- Create: `docs/audit-review-pilot-runbook.md`

**Interfaces:**
- Consumes: five selected document IDs, their artifact IDs, and finalized review results.
- Produces: one durable runbook containing the exact commands and a result table for the continue/adjust/stop decision.

- [ ] **Step 1: Create the operational runbook**

Select the five actual business documents first, then create `docs/audit-review-pilot-runbook.md` with the structure below. Populate all five sample rows with real document IDs, file names, and artifact IDs during the pilot; do not commit empty result rows.

```markdown
# 可审计审核副本试点运行记录

## 样本

| 类型 | 文档 ID | 文件名 | Artifact ID |
| --- | --- | --- | --- |
| 普通文本 1 |  |  |  |
| 普通文本 2 |  |  |  |
| 复杂表格 1 |  |  |  |
| 复杂表格 2 |  |  |  |
| 已知问题 |  |  |  |

## 主数据隔离检查

五份文档全部完成重新解析并生成审核副本后、打开第一份审核页面前：

```powershell
Get-FileHash -Algorithm SHA256 .data/chunks.json,.data/ragtables.json
```

五份文档全部提交审核后重复同一命令。两次哈希必须逐文件一致。不要把重新解析前的哈希作为审核隔离基线，因为重新解析本身会合法更新主数据。

## 可追溯抽查

从五个 manifest 的重点项中按 artifactId + auditItemId 排序后等距抽取 20 项。逐项记录：

| # | 文档 | auditItemId | 页码可定位 | Block/Table 可定位 | Object/Chunk/RagTable 可定位 | 通过 |
| --- | --- | --- | --- | --- | --- | --- |

通过项必须不少于 19/20。

## 审核结果

| 文档 | startedAt | finalizedAt | 分钟 | 问题数 | 问题记录完整 |
| --- | --- | --- | --- | --- | --- |

中位审核时间必须不超过 15 分钟；每条问题必须同时具有 auditItemId、问题类型、备注、审核人和时间。

## 已知问题闭环

- 已知问题：
- 对应 auditItemId：
- 问题类型：
- 备注：
- 来源定位：

## 结论

- 继续：全部硬指标达到，且运营人员能够独立完成审核。
- 调整：数据隔离达标，但耗时、抽样或呈现未达标。
- 停止：来源追溯不稳定、影响检索主数据，或运营人员无法独立使用。

最终选择：
理由：
```

- [ ] **Step 2: Run all automated verification before the pilot**

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: every command exits 0. Do not start the five-document trial if any command fails.

- [ ] **Step 3: Start the local service and verify the actual port**

```powershell
$job = Start-Process -FilePath "npm.cmd" -ArgumentList @("run","dev:big") -WorkingDirectory "D:\OPC\enterprise-knowledge-qa-wenda" -RedirectStandardOutput ".dev-audit-pilot.out.log" -RedirectStandardError ".dev-audit-pilot.err.log" -WindowStyle Hidden -PassThru
Get-Content .dev-audit-pilot.out.log -Wait
```

Expected: Next.js prints the final local URL, normally `http://localhost:3200`. Stop reading after the ready line, then verify that exact URL:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3200/documents | Select-Object StatusCode
```

Expected: `StatusCode` is 200.

- [ ] **Step 4: Process the five documents, freeze hashes, then review**

Phase A — process all five documents before any review action:

1. Open `/documents` as `user-admin`.
2. Click “重新解析” for each of the five selected documents.
3. Confirm every UI row reports an audit snapshot rather than an audit failure.
4. Confirm every new artifact directory contains the four required files.
5. Run the first `Get-FileHash` command and copy both hashes into the runbook.

Phase B — do not process any document again; review all five snapshots:

1. Open the latest snapshot for each selected document.
2. Complete every focus item; record any optional non-focus issue found.
3. Finalize once and verify the page becomes read-only.
4. Copy document ID, artifact ID, `startedAt`, and `finalizedAt` into the runbook.
5. After the fifth finalization, run the second `Get-FileHash` command.

- [ ] **Step 5: Perform integrity, traceability, completeness, and isolation checks**

Run the two SHA-256 commands in the runbook, inspect all five `manifest.json` files, sample 20 items, and calculate the median of the five review durations. Expected hard gates:

- 5/5 artifact directories contain four files and pass hash verification.
- Traceability is at least 19/20.
- Median duration is at most 15 minutes.
- Issue-record completeness is 100%.
- The known problem produces at least one complete, traceable issue.
- `.data/chunks.json` and `.data/ragtables.json` hashes are unchanged during review.

- [ ] **Step 6: Commit the runbook and implementation closeout**

Do not commit runtime `artifacts/`, `.data`, logs, or review results. Commit only the reusable runbook after recording the pilot decision:

```powershell
git add docs/audit-review-pilot-runbook.md
git diff --cached --check
git commit -m "docs: record audit review pilot"
```

---

## Final Verification Checklist

- [ ] `npm.cmd test` exits 0 and includes all five new audit test modules.
- [ ] `npx.cmd tsc --noEmit` exits 0.
- [ ] `npm.cmd run build` exits 0.
- [ ] A real process response contains `auditArtifact.status = "created"`.
- [ ] Forced artifact-writer failure returns HTTP 200 with `auditArtifact.status = "failed"` and leaves the document `indexed`.
- [ ] A non-manager receives 403 from list, artifact, and review endpoints.
- [ ] Tampering with `review.html` yields 409 and prevents submission.
- [ ] Changing the source file hash yields 409 and prevents submission of the old snapshot.
- [ ] Finalizing twice yields 409.
- [ ] No artifact file contains embedding-vector numeric values, API keys, environment values, or original file bytes; `embeddingSignature` is the only embedding-related field.
- [ ] Review-only actions do not change `.data/chunks.json` or `.data/ragtables.json` hashes.
- [ ] The five-document runbook records a single `继续`, `调整`, or `停止` decision.
