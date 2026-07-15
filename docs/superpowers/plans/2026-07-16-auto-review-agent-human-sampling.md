# Automatic Review Agent and Human Sampling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent hybrid automatic-review Agent that detects table-splitting risks, ranks human sampling work, preserves immutable human review rounds, and evaluates detection quality without changing retrieval data.

**Architecture:** Keep `.data/chunks.json` and `.data/ragtables.json` authoritative. After indexing, project the in-memory processing result into an immutable audit artifact, run deterministic signals plus an injected multimodal review provider, persist `auto-review.json`, and keep each finalized human review in its own immutable JSON file. A protected Next.js workbench separates automatic suspicions from human conclusions and uses pure view-model functions for summary, filters, and jump-to-issue behavior.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.6, Node test runner, local JSON persistence, existing OpenAI-compatible/Zhipu HTTP conventions, Python/PyMuPDF page rendering bridge.

## Global Constraints

- This plan supersedes `docs/superpowers/plans/2026-07-15-auditable-review-artifact-pilot.md`; do not execute the old plan in parallel.
- This iteration detects splitting risk but does not change PDF table extraction, row/column recovery, Chunk construction, embeddings, or RagTable contents.
- Automatic review never blocks indexing and never changes a document from `indexed` to `failed`.
- Automatic and human conclusions, actors, timestamps, and issue counts remain separate in storage and UI.
- Risk scores are triage priorities, not probabilities.
- Finalized human rounds are immutable; re-review creates a new round against the same artifact and never reparses the document.
- `.data/chunks.json` and `.data/ragtables.json` must be byte-for-byte unchanged by all review actions.
- A `rules_only` run must never be labeled as a completed hybrid Agent run.
- The UI must retain: `本轮只识别切分风险，不修复切分结果；表格仍应按表格结构优化切分。`
- All production behavior follows red-green-refactor: every production function is introduced only after its focused test fails for the expected missing behavior.

---

## File Structure

### Audit domain

- `lib/audit/types.ts` — manifest, projected item, automatic result, review round, summary, and process snapshot contracts.
- `lib/audit/reviewItems.ts` — deterministic projection, focus selection, and stable low-risk sampling.
- `lib/audit/riskSignals.ts` — rule-based signals for figures 1–3 and clean negative cases.
- `lib/audit/riskScore.ts` — risk aggregation, level mapping, and automatic status/completeness summaries.
- `lib/audit/autoReviewProvider.ts` — independent model-provider interface, strict response parsing, and environment-backed provider selection.
- `lib/audit/runAutoReview.ts` — per-item orchestration, page image reuse, partial/unavailable handling, and run summary.
- `lib/audit/autoReviewEval.ts` — confusion matrix and risk Eval metrics.
- `lib/audit/artifactStore.ts` — safe paths, atomic writes, integrity reads, artifact listing, and immutable round persistence.
- `lib/audit/reviewRounds.ts` — draft/finalize/re-review state transitions and completion gates.
- `lib/audit/renderReviewArtifact.ts` — archived Markdown/HTML rendering with escaped content and explicit automatic/human labels.
- `lib/audit/createReviewArtifact.ts` — artifact creation orchestration after successful indexing.
- `lib/audit/reviewViewModel.ts` — pure summary, filter, sort, read-only, and jump-to-problem behavior used by the workbench.

### Integration and UI

- `lib/db/chunks.ts` — return the in-memory `ProcessDocumentResult`; never call audit code here.
- `app/api/documents/[id]/process/route.ts` — create the audit artifact after indexing and isolate review failures.
- `app/api/documents/[id]/review-artifacts/access.ts` — shared document lookup and management permission guard.
- `app/api/documents/[id]/review-artifacts/route.ts` — list artifact summaries.
- `app/api/documents/[id]/review-artifacts/[artifactId]/route.ts` — serve protected manifest, auto-review, archive HTML/Markdown, and integrity status.
- `app/api/documents/[id]/review-artifacts/[artifactId]/reviews/route.ts` — list rounds and create first/re-review rounds.
- `app/api/documents/[id]/review-artifacts/[artifactId]/reviews/[reviewId]/route.ts` — read, save draft, and finalize one round.
- `app/documents/[id]/review/[artifactId]/page.tsx` — protected review page shell.
- `components/AuditReviewWorkbench.tsx` — interactive automatic-first human sampling workbench.
- `components/ReviewArtifactControl.tsx` — document-list status, snapshot selection, and open-review action.
- `components/DocumentTable.tsx` — process-result notice and review-control placement only.

### Eval and tests

- `scripts/run_auto_review_eval.mjs` — run the labeled corpus and write JSON/Markdown reports.
- `tests/fixtures/auto-review/` — the three provided screenshots plus a 60-item versioned label file built from real pilot documents.
- `tests/auditReviewItems.test.ts`
- `tests/auditRiskSignals.test.ts`
- `tests/auditAutoReviewProvider.test.ts`
- `tests/auditAutoReviewRun.test.ts`
- `tests/auditAutoReviewEval.test.ts`
- `tests/auditArtifactStore.test.ts`
- `tests/auditReviewRounds.test.ts`
- `tests/auditReviewViewModel.test.ts`
- `tests/auditCreateArtifact.test.ts`
- `tests/auditReviewApi.test.ts`
- `tests/index.ts` — import every new unit test.
- `docs/auto-review-pilot-runbook.md` — exact pilot commands, hashes, Eval result, and split-remediation reminder.

---

### Task 1: Define contracts, project review items, and select human samples

**Files:**
- Create: `lib/audit/types.ts`
- Create: `lib/audit/reviewItems.ts`
- Create: `tests/auditReviewItems.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Produces `ProcessDocumentResult`, `AuditReviewItem`, `AutoReviewRun`, `HumanReviewRound`, and `projectReviewItems(...)` for every later task.
- Consumes existing `Block`, `Chunk`, `Document`, `KnowledgeObject`, and `RagTable` types.

- [ ] **Step 1: Write the failing projection and sampling tests**

Create tests that construct one warning table row, one ordinary table row, one low-confidence object, and one ordinary section. Assert:

```ts
const items = projectReviewItems(snapshot, { maxFocusItems: 20, lowRiskSampleSize: 2 });
assert.equal(new Set(items.map((item) => item.auditItemId)).size, items.length);
assert.ok(items.find((item) => item.source.ragTableId === "tbl-1"));
assert.ok(items.filter((item) => item.selectedForReview).length <= 20);
assert.equal(
  items.find((item) => item.warnings.includes("noisy_extraction_text"))?.selectionReason,
  "warning"
);
assert.deepEqual(
  stableLowRiskSample(items, "artifact-a", 2).map((item) => item.auditItemId),
  stableLowRiskSample(items, "artifact-a", 2).map((item) => item.auditItemId)
);
```

Import the test from `tests/index.ts`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types tests/auditReviewItems.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/audit/reviewItems.ts`.

- [ ] **Step 3: Add the exact contracts**

Define these unions and fields in `lib/audit/types.ts`:

```ts
export type AutoReviewItemStatus = "clean" | "suspected_issue" | "unavailable";
export type AutoReviewMode = "hybrid" | "rules_only" | "partial" | "unavailable";
export type RiskLevel = "low" | "medium" | "high";
export type AutoIssueType =
  | "reading_order_noise"
  | "row_boundary_contamination"
  | "column_misalignment"
  | "merged_cell_scope_error"
  | "missing_content"
  | "source_mapping_error"
  | "semantic_assignment_error"
  | "other";
export type HumanItemStatus = "passed" | "issue";
export type HumanReviewStatus = "pending" | "draft" | "passed" | "issues_found";

export interface AuditReviewItem {
  auditItemId: string;
  objectType: string;
  title: string;
  content: string;
  confidence?: number;
  warnings: string[];
  selectedForReview: boolean;
  selectionReason?: "warning" | "low_confidence" | "table_coverage" | "stable_sample";
  source: {
    pageStart?: number;
    pageEnd?: number;
    blockIds: string[];
    tableId?: string;
    rowIndex?: number;
    ragTableId?: string;
    knowledgeObjectId?: string;
    chunkIds: string[];
  };
  tableContext?: { headers: string[]; targetRow: string[]; previousRow?: string[]; nextRow?: string[] };
}

export interface HumanReviewRound {
  reviewId: string;
  artifactId: string;
  parentReviewId?: string;
  reviewerUserId?: string;
  status: HumanReviewStatus;
  startedAt?: string;
  updatedAt?: string;
  finalizedAt?: string;
  samplingPlan: { requiredItemIds: string[]; lowRiskSampleItemIds: string[] };
  items: HumanReviewItem[];
}

export interface ProcessDocumentResult {
  chunkCount: number;
  snapshot: {
    blocks: Block[];
    knowledgeObjects: KnowledgeObject[];
    chunks: Chunk[];
    ragTables: RagTable[];
    warnings: string[];
  };
}
```

Also define `AutoRuleSignal`, `AutoReviewItemResult`, `AutoReviewRun`, `HumanReviewItem`, `AuditManifest`, `ReviewArtifactSummary`, and `CreateReviewArtifactInput` using the fields fixed by the approved design. Do not add edit/correction fields.

- [ ] **Step 4: Implement deterministic projection and stable sampling**

Implement `projectReviewItems(snapshot, options)` by projecting KnowledgeObjects first, joining Chunk/RagTable identifiers, and attaching the target row plus adjacent rows. Use a stable FNV-1a hash of `artifactSeed + auditItemId` for low-risk ordering. Selection priority is warning, confidence `< 0.80`, table coverage, then stable sample; cap focus items at 20.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --experimental-strip-types tests/auditReviewItems.test.ts`

Expected: all projection, focus, table-context, and sampling tests pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/audit/types.ts lib/audit/reviewItems.ts tests/auditReviewItems.test.ts tests/index.ts
git commit -m "feat(audit): define automatic review contracts"
```

---

### Task 2: Detect figures 1–3 and aggregate explainable risk

**Files:**
- Create: `lib/audit/riskSignals.ts`
- Create: `lib/audit/riskScore.ts`
- Create: `tests/auditRiskSignals.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Consumes `AuditReviewItem`.
- Produces `detectAuditRiskSignals(item)`, `aggregateAutoRisk(input)`, and `riskLevelForScore(score)`.

- [ ] **Step 1: Write failing regression tests before production rules**

Use exact textual fixtures derived from the screenshots:

```ts
test("figure 1 flags reading-order noise and title distortion", () => {
  const result = detectAuditRiskSignals(item({
    title: "3.、5、10、15。",
    content: "社区卫生1服5务中心 2 1 ,15。建筑面积比例不应低于2. 、 、85%具。",
  }));
  assert.ok(result.some((signal) => signal.issueType === "reading_order_noise"));
  assert.ok(Math.max(...result.map((signal) => signal.riskScore)) >= 70);
});

test("figure 2 flags a value absent from the target source row", () => {
  const result = detectAuditRiskSignals(item({
    content: "服务规模：20 / 1000—5000户",
    tableContext: {
      headers: ["编号", "设施名称", "服务规模"],
      targetRow: ["15", "综合通信机房", "1000—5000户"],
      previousRow: ["14", "污水处置及再生利用装置", "20平方米/万平方米"],
    },
  }));
  assert.ok(result.some((signal) => signal.issueType === "row_boundary_contamination"));
});

test("figure 3 flags semantic assignment while keeping a clean long cell negative", () => {
  assert.ok(detectAuditRiskSignals(figure3Item).some(
    (signal) => signal.issueType === "semantic_assignment_error"
  ));
  assert.deepEqual(detectAuditRiskSignals(cleanLongCellItem), []);
});

test("risk boundaries are stable", () => {
  assert.equal(riskLevelForScore(39), "low");
  assert.equal(riskLevelForScore(40), "medium");
  assert.equal(riskLevelForScore(69), "medium");
  assert.equal(riskLevelForScore(70), "high");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types tests/auditRiskSignals.test.ts`

Expected: FAIL because the two modules do not exist.

- [ ] **Step 3: Implement narrowly scoped detectors**

Reuse `classifyEvidenceQuality` for numeric/read-order warnings. Add pure checks for:

- title composed mostly of punctuation/numbers and shorter than meaningful content;
- structured values absent from the target row but present in an adjacent row;
- structured field labels duplicated inside the value;
- title/content assignment where a fixed category label such as `指标修改说明` becomes a facility name or the whole row title;
- target row/header length mismatch and unexpected non-empty overflow cells.

Every signal returns `{ ruleId, issueType, riskScore, summary, evidence }`. Use the approved base scores `85/80/70/55/40`; do not add scores together.

- [ ] **Step 4: Implement aggregation**

`aggregateAutoRisk` must use `Math.max(ruleRiskScore, modelRiskScore ?? 0)`, clamp to `0..100`, return `suspected_issue` at `>=40`, and force `unavailable` when configured hybrid review did not produce a model assessment and no deterministic issue is present. `rules_only` remains visible in the result.

- [ ] **Step 5: Verify GREEN and the clean negative guardrail**

Run: `node --experimental-strip-types tests/auditRiskSignals.test.ts`

Expected: all positive and clean-negative tests pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/audit/riskSignals.ts lib/audit/riskScore.ts tests/auditRiskSignals.test.ts tests/index.ts
git commit -m "feat(audit): detect table splitting risks"
```

---

### Task 3: Add the independent model provider and partial-safe runner

**Files:**
- Create: `lib/audit/autoReviewProvider.ts`
- Create: `lib/audit/runAutoReview.ts`
- Create: `tests/auditAutoReviewProvider.test.ts`
- Create: `tests/auditAutoReviewRun.test.ts`
- Modify: `tests/index.ts`
- Modify: `.env.example`

**Interfaces:**
- `AutoReviewProvider.review(input): Promise<ModelAutoReviewAssessment>` is separate from the answer `LLMProvider`.
- `runAutoReview(input, dependencies): Promise<AutoReviewRun>` accepts injected provider, page renderer, clock, and concurrency limit.

- [ ] **Step 1: Write failing strict-parser and runner tests**

Test valid JSON, invalid enum, risk `101`, missing source explanation, rules-only mode, provider rejection, one-item failure among two items, and provider independence:

```ts
await assert.rejects(
  () => parseModelAssessment(JSON.stringify({ status: "passed", riskScore: 20 })),
  /invalid_auto_review_status/
);

const run = await runAutoReview(input, {
  provider: providerThatFailsFor("item-2"),
  renderPage: async () => ({ mimeType: "image/png", base64: "AA==" }),
  now: () => "2026-07-16T00:00:00.000Z",
  concurrency: 1,
});
assert.equal(run.items.find((item) => item.auditItemId === "item-2")?.status, "unavailable");
assert.notEqual(run.summary.status, "completed");
```

- [ ] **Step 2: Verify RED**

Run both focused files. Expected: missing-module failures.

- [ ] **Step 3: Implement the provider contract and strict parser**

The model prompt must ask only for JSON with `status`, `riskScore`, `issueTypes`, `summary`, and `sourceEvidence`. Use temperature `0`. Reject unknown keys only when they conflict with required fields; reject invalid enums, missing summary, score outside `0..100`, and more than 4 issue types.

Provider selection:

- `AUTO_REVIEW_ENABLED=1` and `AUTO_REVIEW_API_KEY` enable the dedicated endpoint.
- `AUTO_REVIEW_API_URL` and `AUTO_REVIEW_MODEL` select endpoint/model.
- If dedicated values are absent but `ZHIPU_API_KEY` exists, use the existing Zhipu v4 endpoint with `AUTO_REVIEW_MODEL=glm-4v-flash` default.
- Otherwise return no model provider and run `rules_only`.

Do not import or call `getLLMProvider()`.

- [ ] **Step 4: Implement the runner**

Run deterministic signals for every item. For a configured provider, render each distinct page once and reuse the base64 image. Process items with concurrency `2` by default. Convert timeout, bad JSON, image failure, and provider error into per-item `unavailable` details; never reject the whole run for one item. The run summary reports mode, reviewed count, suspected count, unavailable count, provider, model, started/finished timestamps.

- [ ] **Step 5: Document environment switches**

Add commented examples to `.env.example` for `AUTO_REVIEW_ENABLED`, URL, key, model, timeout, and concurrency. State that page content is sent to the configured provider.

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
node --experimental-strip-types tests/auditAutoReviewProvider.test.ts
node --experimental-strip-types tests/auditAutoReviewRun.test.ts
```

Expected: strict parsing, rules-only labeling, image reuse, and partial failure tests pass.

- [ ] **Step 7: Commit**

```powershell
git add lib/audit/autoReviewProvider.ts lib/audit/runAutoReview.ts tests/auditAutoReviewProvider.test.ts tests/auditAutoReviewRun.test.ts tests/index.ts .env.example
git commit -m "feat(audit): add independent automatic review provider"
```

---

### Task 4: Build risk Eval metrics, corpus format, and CLI

**Files:**
- Create: `lib/audit/autoReviewEval.ts`
- Create: `tests/auditAutoReviewEval.test.ts`
- Create: `scripts/run_auto_review_eval.mjs`
- Create: `tests/fixtures/auto-review/labels.schema.json`
- Modify: `tests/index.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `computeAutoReviewEval(gold, actual)` with confusion matrix, severe recall/miss, false-positive, localization, issue-type, and unavailable metrics.
- CLI consumes a versioned label JSON file and optional real provider configuration.

- [ ] **Step 1: Write failing metric tests with an explicit 8-item matrix**

Use two severe true positives, one severe false negative, one non-severe true positive, three clean items with one false positive, and one unavailable item. Assert the exact fractions rather than rounded strings.

```ts
assert.equal(metrics.severeRecall, 2 / 3);
assert.equal(metrics.severeMissRate, 1 / 3);
assert.equal(metrics.falsePositiveRate, 1 / 3);
assert.equal(metrics.unavailableRate, 1 / 8);
assert.deepEqual(metrics.confusion, { tp: 3, fp: 1, tn: 2, fn: 1, unavailable: 1 });
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types tests/auditAutoReviewEval.test.ts`

Expected: missing-module failure.

- [ ] **Step 3: Implement metric calculations and pass/fail gates**

The result must include raw counts and unrounded numeric rates. `meetsPilotGate` is true only when severe recall `>=0.90`, severe miss `<=0.10`, false positive `<=0.15`, localization `>=0.95`, unavailable `<=0.05`, and run mode is `hybrid`.

- [ ] **Step 4: Implement the corpus schema and CLI**

The label schema requires `datasetVersion`, `documents`, and items containing `auditItemId`, source image path, parsed item, true status, severity, issue types, and correct source location. The CLI validates the file, runs the same automatic-review path, writes `debug/auto-review-eval/<timestamp>/summary.json` and `summary.md`, and exits `2` when metrics are computed but pilot gates fail. `rules_only` output is labeled as baseline and cannot pass.

- [ ] **Step 5: Add the package command and verify GREEN**

Add:

```json
"eval:auto-review": "node --experimental-strip-types scripts/run_auto_review_eval.mjs"
```

Run the unit test and run the CLI against a temporary 8-item test fixture. Expected: metrics are exact; the deliberately weak fixture exits `2` and writes both reports.

- [ ] **Step 6: Commit**

```powershell
git add lib/audit/autoReviewEval.ts tests/auditAutoReviewEval.test.ts scripts/run_auto_review_eval.mjs tests/fixtures/auto-review/labels.schema.json tests/index.ts package.json
git commit -m "feat(audit): add automatic review risk eval"
```

---

### Task 5: Persist immutable artifacts and human review rounds

**Files:**
- Create: `lib/audit/artifactStore.ts`
- Create: `lib/audit/reviewRounds.ts`
- Create: `tests/auditArtifactStore.test.ts`
- Create: `tests/auditReviewRounds.test.ts`
- Modify: `tests/index.ts`
- Modify: `.gitignore`

**Interfaces:**
- `writeArtifactAtomic(input)`, `readArtifact(...)`, `listArtifactSummaries(docId)`, `createReviewRound(...)`, `saveReviewDraft(...)`, and `finalizeReviewRound(...)`.

- [ ] **Step 1: Write failing safe-path, atomic-write, and immutable-round tests**

Cover path traversal, an artifact containing `manifest.json`, `review.md`, `review.html`, `auto-review.json`, and `reviews/<reviewId>.json`, invalid item IDs, issue-without-type/comment, incomplete required items, overwrite after finalization, and re-review parent linkage.

```ts
const first = createReviewRound(store, artifactId, reviewerId);
const finalized = finalizeReviewRound(store, first.reviewId, completeItems);
await assert.rejects(() => saveReviewDraft(store, finalized.reviewId, completeItems), /review_finalized/);
const second = createReviewRound(store, artifactId, reviewerId, finalized.reviewId);
assert.equal(second.parentReviewId, finalized.reviewId);
assert.notEqual(second.reviewId, finalized.reviewId);
```

- [ ] **Step 2: Verify RED**

Run both focused tests. Expected: missing-module failures.

- [ ] **Step 3: Implement safe storage and integrity checks**

Resolve every path under `<cwd>/artifacts`; reject identifiers outside `[A-Za-z0-9_-]`. Write new artifacts into a sibling temporary directory, fsync/close files, then atomically rename. Human draft saves use a temporary file and atomic replacement. Finalized JSON is never replaced. Hash `review.md`, `review.html`, and `auto-review.json` in the manifest and verify them on every submission read.

- [ ] **Step 4: Implement round validation and completion gates**

Required human item IDs are the union of high risk, focus, stable low-risk sample, `partial`, and `unavailable`. An `issue` requires at least one fixed issue type and a non-empty comment of at most 2000 characters. Final status is derived, never accepted from the client. Re-review reuses the same artifact and creates a fresh stable sampling plan based on the new `reviewId`.

Artifact creation creates one initial `pending` round with no reviewer or timestamps. The first successful draft/finalize request assigns `reviewerUserId` from the authenticated manager and sets `startedAt`; another user cannot take over that non-finalized round. This removes ambiguity between “artifact exists” and “human review started.”

- [ ] **Step 5: Ignore runtime artifacts and verify GREEN**

Add `/artifacts/` and `/debug/auto-review-eval/` to `.gitignore`. Run both tests and assert no temporary directories remain after simulated failure.

- [ ] **Step 6: Commit**

```powershell
git add lib/audit/artifactStore.ts lib/audit/reviewRounds.ts tests/auditArtifactStore.test.ts tests/auditReviewRounds.test.ts tests/index.ts .gitignore
git commit -m "feat(audit): persist immutable review rounds"
```

---

### Task 6: Render artifacts and integrate failure-isolated processing

**Files:**
- Create: `lib/audit/renderReviewArtifact.ts`
- Create: `lib/audit/createReviewArtifact.ts`
- Create: `tests/auditCreateArtifact.test.ts`
- Modify: `lib/db/chunks.ts`
- Modify: `app/api/documents/[id]/process/route.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- `processDocument(...)` changes from `Promise<number>` to `Promise<ProcessDocumentResult>`.
- `createReviewArtifact(input, dependencies)` consumes the in-memory snapshot, source buffer, and automatic-review runner.

- [ ] **Step 1: Write failing creation and failure-isolation tests**

Test escaped `<script>` content, separate automatic/human labels in both archive formats, a successful artifact, an automatic run containing unavailable items, and an injected artifact writer failure that leaves the processing result usable.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types tests/auditCreateArtifact.test.ts`

Expected: missing-module failure.

- [ ] **Step 3: Implement archive rendering**

Render `review.md` and a self-contained read-only `review.html`. Both show document summary, automatic reviewer/mode/time, automatic suspected count, item risk/type/evidence/source, and the split-remediation reminder. The live form belongs to the Next.js workbench, not the archive HTML. Escape all document and model content.

- [ ] **Step 4: Return the processing snapshot without audit coupling**

In `lib/db/chunks.ts`, keep existing write order and return:

```ts
return {
  chunkCount: chunks.length,
  snapshot: {
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
```

- [ ] **Step 5: Integrate after indexing with isolated errors**

The process route must set `indexed` after `processDocument` succeeds. Then call `createReviewArtifact` inside its own `try/catch`. Return HTTP 200 with:

```ts
{
  document,
  chunkCount,
  extractedChars,
  auditArtifact: { status: "created", artifactId, autoReviewMode, unavailableCount }
}
```

or `{ status: "failed", error }` for artifact-only failure. Do not enter the outer parse-failure catch after indexing.

- [ ] **Step 6: Verify GREEN**

Run the focused test, existing process-related tests, and `npx.cmd tsc --noEmit`.

- [ ] **Step 7: Commit**

```powershell
git add lib/audit/renderReviewArtifact.ts lib/audit/createReviewArtifact.ts tests/auditCreateArtifact.test.ts lib/db/chunks.ts app/api/documents/[id]/process/route.ts tests/index.ts
git commit -m "feat(audit): create automatic review artifacts after indexing"
```

---

### Task 7: Expose protected artifact, round, and re-review APIs

**Files:**
- Create: `app/api/documents/[id]/review-artifacts/access.ts`
- Create: `app/api/documents/[id]/review-artifacts/route.ts`
- Create: `app/api/documents/[id]/review-artifacts/[artifactId]/route.ts`
- Create: `app/api/documents/[id]/review-artifacts/[artifactId]/reviews/route.ts`
- Create: `app/api/documents/[id]/review-artifacts/[artifactId]/reviews/[reviewId]/route.ts`
- Create: `tests/auditReviewApi.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- List/read routes require `canManageDocumentInManagement`.
- `POST reviews` creates a first round only for a legacy artifact with no rounds; otherwise it requires a finalized `parentReviewId` and creates a re-review.
- `PATCH reviews/[reviewId]` accepts only `{ action: "save_draft" | "finalize", items }`.

- [ ] **Step 1: Write failing access and state-transition tests**

Test manager success, employee 403, path traversal 400, missing artifact 404, integrity mismatch 409, draft success, incomplete finalize 400, finalized overwrite 409, and re-review creation preserving the old round.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types tests/auditReviewApi.test.ts`

Expected: route-module missing failures.

- [ ] **Step 3: Implement the shared access guard and read routes**

Resolve `userId` using existing utilities, load the document, require management permission, and return explicit Chinese errors. Never expose filesystem paths. The artifact GET route allows only `manifest`, `auto-review`, `html`, or `markdown` formats.

- [ ] **Step 4: Implement round routes**

The server derives reviewer ID from the resolved user, not request JSON. Creating re-review requires a finalized parent belonging to the same artifact. Draft/finalize validates artifact integrity and source-file hash first. Return the persisted server object after every mutation.

- [ ] **Step 5: Verify GREEN**

Run the API tests and `npx.cmd tsc --noEmit`.

- [ ] **Step 6: Commit**

```powershell
git add app/api/documents/[id]/review-artifacts tests/auditReviewApi.test.ts tests/index.ts
git commit -m "feat(audit): expose protected review round APIs"
```

---

### Task 8: Build the automatic-first human sampling workbench

**Files:**
- Create: `lib/audit/reviewViewModel.ts`
- Create: `tests/auditReviewViewModel.test.ts`
- Create: `components/AuditReviewWorkbench.tsx`
- Create: `components/ReviewArtifactControl.tsx`
- Create: `app/documents/[id]/review/[artifactId]/page.tsx`
- Modify: `components/DocumentTable.tsx`
- Modify: `tests/index.ts`

**Interfaces:**
- Pure functions: `buildReviewSummary`, `defaultReviewFilter`, `filterReviewItems`, `sortReviewItems`, `nextProblemItemId`, and `isReviewReadOnly`.
- Workbench consumes manifest, automatic run, rounds, and current user; writes only through the protected API.

- [ ] **Step 1: Write failing view-model behavior tests**

```ts
assert.equal(defaultReviewFilter(autoRunWithIssues), "problems");
assert.equal(defaultReviewFilter(cleanAutoRun), "focus");
assert.equal(nextProblemItemId(items, round), "highest-risk-unreviewed");
assert.equal(isReviewReadOnly(finalizedRound), true);
assert.deepEqual(buildReviewSummary(input), {
  autoReviewedBy: "Auto Review Agent v1",
  humanReviewer: "王磊",
  focusCompleted: 5,
  focusTotal: 8,
  autoSuspectedCount: 3,
  humanConfirmedCount: 1,
  automaticConclusion: "发现疑似问题，待人工确认",
  humanConclusion: "审核中",
});
```

Also assert problem/focus/unreviewed/all membership and stable risk/page/table/row ordering.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types tests/auditReviewViewModel.test.ts`

Expected: missing-module failure.

- [ ] **Step 3: Implement the pure view model**

Keep labels explicit: `自动审核疑似问题`, `人工审核确认问题`, `自动审核：规则模式`, and `自动审核未完整完成`. Never return a generic `系统已审核` label.

- [ ] **Step 4: Implement the protected page and workbench**

Match the approved layout:

- top summary with automatic actor/time, human actor/time, focus completion, separate problem counts, and overall conclusions;
- split-remediation reminder;
- default problem filter and `跳到问题`;
- fixed `问题 / 重点项 / 未审核 / 全部` filters;
- source page and parsed result side by side;
- automatic risk/evidence above separate human conclusion/type/comment controls;
- save draft and finalize buttons only for mutable rounds;
- finalized page fully shows type, note, and source while disabling all controls;
- `发起复审` creates a new round without calling `/process`.

Use the existing document page image API for source display. Keep source-image failure visible and place the item in the unavailable/manual queue.

- [ ] **Step 5: Integrate document management**

`ReviewArtifactControl` lists snapshots and opens `/documents/<docId>/review/<artifactId>?userId=<id>`. In `DocumentTable`, show separate process notices for indexing success plus audit success/failure. Do not rename the existing `重新解析` action; add a separate review action so re-review cannot be mistaken for parsing.

- [ ] **Step 6: Verify GREEN**

Run the view-model test, full `npm.cmd test`, `npx.cmd tsc --noEmit`, and `npm.cmd run build`.

- [ ] **Step 7: Commit**

```powershell
git add lib/audit/reviewViewModel.ts tests/auditReviewViewModel.test.ts components/AuditReviewWorkbench.tsx components/ReviewArtifactControl.tsx app/documents/[id]/review/[artifactId]/page.tsx components/DocumentTable.tsx tests/index.ts
git commit -m "feat(audit): add automatic-first review workbench"
```

---

### Task 9: Build the 60-item corpus and run the real pilot

**Files:**
- Create: `tests/fixtures/auto-review/figure-1.png`
- Create: `tests/fixtures/auto-review/figure-2.png`
- Create: `tests/fixtures/auto-review/figure-3.png`
- Create: `tests/fixtures/auto-review/gold-v1.json`
- Create: `docs/auto-review-pilot-runbook.md`

**Interfaces:**
- Consumes five real pilot documents, immutable artifacts, the real configured provider, and `npm.cmd run eval:auto-review`.
- Produces a reviewed 60-item corpus and the go/adjust/stop decision.

- [ ] **Step 1: Preserve the three supplied source screenshots**

Copy the user-provided PNGs byte-for-byte into the fixture paths. Record SHA-256 values in `gold-v1.json`. Label figure 1 as `reading_order_noise`, figure 2 as `row_boundary_contamination`, and figure 3 as `semantic_assignment_error`; include the exact correct page/table/row locations visible in the source artifact.

- [ ] **Step 2: Select and label the remaining real items**

From five pilot documents, select at least 30 issue items and 30 clean items. Include adjacent correct rows for each known bad row as difficult negatives. Group by document/table so no table occurs in both calibration and blind partitions. Every label must contain reviewer, reviewed time, source location, severity, issue types, and a concise evidence note. Do not commit an item with an empty evidence note or unresolved status.

- [ ] **Step 3: Freeze the retrieval-data baseline**

Run:

```powershell
Get-FileHash .data\chunks.json -Algorithm SHA256
Get-FileHash .data\ragtables.json -Algorithm SHA256
```

Record both values in the runbook immediately before any human review action.

- [ ] **Step 4: Run deterministic and real hybrid Eval**

Run:

```powershell
npm.cmd run eval:auto-review -- tests/fixtures/auto-review/gold-v1.json --mode rules_only
npm.cmd run eval:auto-review -- tests/fixtures/auto-review/gold-v1.json --mode hybrid
```

Record model, rule version, dataset hash, confusion matrix, severe recall/miss, false-positive, localization, issue-type detail, unavailable rate, and exit code. A hybrid exit code `2` is an honest “gate not met,” not a script failure to hide.

- [ ] **Step 5: Complete one human review and one re-review without parsing**

Use the UI to finalize a round containing at least one confirmed issue, verify the read-only display, click `发起复审`, finalize the second round, and confirm both round IDs remain readable. Do not click `重新解析` during this phase.

- [ ] **Step 6: Prove review isolation and record the reminder**

Repeat the two SHA-256 commands. Both hashes must match the Step 3 values. The runbook must end with one of `继续 / 调整 / 停止自动排序` and repeat that table splitting itself remains unresolved and requires a separate project.

- [ ] **Step 7: Run final verification**

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
git -c safe.directory='D:/OPC/enterprise-knowledge-qa-wenda' diff --check
```

Expected: all commands exit `0`; if hybrid Eval gates fail, the product remains in shadow/adjust mode and the runbook reports the failed metrics without claiming Agent acceptance.

- [ ] **Step 8: Commit reusable fixtures and runbook only**

Do not commit runtime `artifacts/`, `.data/`, `.cache/`, logs, or generated Eval report directories.

```powershell
git add tests/fixtures/auto-review docs/auto-review-pilot-runbook.md
git commit -m "test(audit): record automatic review pilot"
```

---

## Final Verification Checklist

- [ ] Figure 1 is automatically suspected for reading-order/title distortion or explicitly unavailable; never auto-clean.
- [ ] Figure 2 is automatically suspected for cross-row contamination or explicitly unavailable; never auto-clean.
- [ ] Figure 3 is automatically suspected for semantic/table-level assignment or explicitly unavailable; never auto-clean.
- [ ] Correct adjacent rows remain clean in the blind set and contribute to false-positive measurement.
- [ ] Automatic and human actors, timestamps, conclusions, and issue counts are separately visible.
- [ ] Automatic issues open the problem filter by default and `跳到问题` selects the highest-risk unreviewed item.
- [ ] Problem, focus, unreviewed, and all filters match the pure view-model tests.
- [ ] Finalized rounds are read-only and fully show issue type, note, and source.
- [ ] Re-review creates a new round and never calls document processing.
- [ ] Automatic-review failure does not change an indexed document to failed.
- [ ] Rules-only mode is visibly labeled and cannot pass the hybrid Eval gate.
- [ ] Real hybrid Eval reports all approved metrics and uses a document/table-grouped blind set.
- [ ] Review actions leave `.data/chunks.json` and `.data/ragtables.json` hashes unchanged.
- [ ] `npm.cmd test`, `npx.cmd tsc --noEmit`, and `npm.cmd run build` pass with fresh output.
- [ ] The UI and runbook remind the user that table splitting itself remains unresolved.
