# Table Splitting Structural Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair four representative structural table-splitting failures and add safe, explicit reprocessing for already indexed documents.

**Architecture:** Keep Python/pdfplumber as the primary geometry extractor, extend its output with versioned cell geometry and span evidence, and normalize that evidence once in TypeScript before producing the existing `TableModel`, Chunk, and RagTable outputs. Existing documents are rebuilt in staging, quality-gated, compared, and published through a recoverable document-scoped transaction.

**Tech Stack:** Python 3 + pdfplumber, TypeScript 5.6, Node test runner, Next.js 14 route handlers, JSON file persistence.

## Global Constraints

- First release covers reading order/pseudo-tables, row boundaries, merged-cell propagation, and cross-page continuation.
- Python/pdfplumber remains the primary extractor; the coordinate extractor remains diagnostic/fallback only.
- Do not use an LLM for structural recovery or publish decisions.
- Do not automatically reprocess existing documents.
- Do not change the automatic-review Provider, review sorting, human review, or answer-generation behavior.
- Follow strict TDD: run only the target test file during RED/GREEN; run the grouped full suite once after the complete feature group.
- Preserve unrelated untracked logs, backups, `.data-backups/`, and `.superpowers/`.

---

## File Structure

- `scripts/extract_tables.py`: emit `RawTableV2` geometry, cells, spans, ignored fragments, and legacy rows.
- `lib/parse/tableStructure.ts`: own RawTableV2/CanonicalTable contracts, validation, canonicalization, and quality diagnostics.
- `lib/parse/tablesSidecar.ts`: parse the versioned Python contract, canonicalize tables, group compatible continuation pages, and adapt to Blocks.
- `lib/rag/tableModel.ts`: build a TableModel from explicit structured cells without unbounded null forward-fill.
- `lib/reprocess/tableReprocess.ts`: prepare, inspect, publish, and recover document-scoped reprocessing.
- `lib/reprocess/tableReprocessStore.ts`: persist staging manifests, diffs, payloads, and transaction journals.
- `app/api/documents/[id]/reprocess/prepare/route.ts`: protected prepare endpoint.
- `app/api/documents/[id]/reprocess/[stagingId]/route.ts`: protected status/diff endpoint.
- `app/api/documents/[id]/reprocess/[stagingId]/publish/route.ts`: protected publish endpoint.
- `tests/fixtures/table-parsing/gold-v1.json`: exact representative parsing gold.
- `tests/tableStructure.test.ts`: contract and pure normalization tests.
- `tests/tableParsingGold.test.ts`: real-PDF structural gold tests.
- `tests/tableReprocess.test.ts`: staging, conflict, publish, idempotency, and recovery tests.
- `tests/index.ts`: import the three new test files.

### Task 1: Versioned extractor contract

**Files:**
- Create: `lib/parse/tableStructure.ts`
- Modify: `scripts/extract_tables.py`
- Create: `tests/tableStructure.test.ts`

**Interfaces:**
- Produces: `parseRawTableV2(value: unknown): RawTableV2`
- Produces: `RawTableV2`, `RawTableCell`, `IgnoredTableFragment`, and `TableGridEvidence`
- Python stdout keeps `rows` during migration but adds `schemaVersion: 2`, `cells`, `gridEvidence`, and `ignoredFragments`.

- [ ] **Step 1: Write contract RED tests**

Add cases that accept a complete V2 table and reject duplicate cell occupancy, out-of-range spans, missing source order, and silently unmapped fragments:

```ts
const raw = parseRawTableV2({
  schemaVersion: 2,
  page: 14,
  bbox: [10, 20, 210, 120],
  title: "指标表",
  extractionMethod: "lines",
  gridEvidence: {
    horizontalBoundaries: [20, 50, 80, 120],
    verticalBoundaries: [10, 80, 150, 210],
    lineCoverage: 1,
  },
  cells: [
    {
      text: "规模性指标",
      bbox: [80, 20, 210, 50],
      rowStart: 0,
      rowEnd: 1,
      colStart: 1,
      colEnd: 3,
      sourceOrder: [0],
    },
  ],
  ignoredFragments: [],
  warnings: [],
});
assert.equal(raw.cells[0].colEnd - raw.cells[0].colStart, 2);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --experimental-strip-types tests/tableStructure.test.ts
```

Expected: fail because `lib/parse/tableStructure.ts` does not exist.

- [ ] **Step 3: Implement the TypeScript contract and validator**

Implement bounded-number, bbox, boundary-array, source-order, and non-overlap validation. Return a cloned typed object; never retain unchecked input references.

- [ ] **Step 4: Extend the Python extractor**

For each unique pdfplumber cell bbox:

```python
cell = {
    "text": extract_ordered_cell_text(page, bbox),
    "bbox": [round(float(v), 1) for v in bbox],
    "rowStart": boundary_index(y_boundaries, bbox[1]),
    "rowEnd": boundary_index(y_boundaries, bbox[3]),
    "colStart": boundary_index(x_boundaries, bbox[0]),
    "colEnd": boundary_index(x_boundaries, bbox[2]),
    "sourceOrder": source_char_indices(page, bbox),
}
```

Derive boundaries from the union of unique cell edges with the existing snap tolerance. Emit `ignoredFragments` for characters inside the candidate bbox that are neither inside a cell nor classified as caption/header/footer decoration. Keep the old `rows` field until Task 4 completes integration.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same command. Expected: all contract tests pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts/extract_tables.py lib/parse/tableStructure.ts tests/tableStructure.test.ts
git commit -m "feat(parse): preserve table cell geometry"
```

### Task 2: Canonical structural normalization

**Files:**
- Modify: `lib/parse/tableStructure.ts`
- Modify: `lib/rag/tableModel.ts`
- Modify: `tests/tableStructure.test.ts`
- Modify: `tests/tableModelSpans.test.ts`

**Interfaces:**
- Consumes: `RawTableV2`
- Produces: `canonicalizeRawTable(raw: RawTableV2): CanonicalizationResult`
- Produces: `buildTableModelFromCanonical(table: CanonicalTable): TableModel`

- [ ] **Step 1: Add RED cases for the four structural invariants**

Add exact tests for:

1. prose-like candidate without a stable 2-column/3-row grid returns `{ kind: "paragraph_fallback" }`;
2. wrapped fragments remain in the same cell but an empty leading cell does not merge physical rows;
3. a colspan parent populates only its covered header paths;
4. a rowspan value propagates only across its declared physical rows.

Representative assertion:

```ts
const result = canonicalizeRawTable(rawWithTwoRowSpan);
assert.equal(result.kind, "table");
assert.deepEqual(result.table.rows.map((row) => row.cells.map((cell) => cell.value)), [
  ["A", "first"],
  ["A", "second"],
  ["B", "third"],
]);
```

- [ ] **Step 2: Run only the two target files and verify RED**

```powershell
node --experimental-strip-types tests/tableStructure.test.ts
node --experimental-strip-types tests/tableModelSpans.test.ts
```

Expected: missing canonicalization functions or incorrect legacy forward-fill.

- [ ] **Step 3: Implement canonicalization**

The implementation must:

- accept line-grid candidates with at least 2x2 physical cells;
- accept borderless candidates only with at least three physical rows, two stable column anchors, and at least 80% non-title row occupancy;
- place each explicit source cell into covered physical slots;
- reject overlap/out-of-range spans;
- produce `headerPath` from explicit header spans;
- preserve `sourcePage` and `sourceBBox`;
- return a paragraph fallback with ordered source text when the table gate fails.

- [ ] **Step 4: Add the canonical TableModel adapter**

`buildTableModelFromCanonical` copies canonical header paths and row values directly. It must not call the legacy global null forward-fill.

- [ ] **Step 5: Run the target tests and verify GREEN**

Expected: both files pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/parse/tableStructure.ts lib/rag/tableModel.ts tests/tableStructure.test.ts tests/tableModelSpans.test.ts
git commit -m "fix(parse): normalize table spans from geometry"
```

### Task 3: Continuation compatibility and sidecar integration

**Files:**
- Modify: `lib/parse/tableStructure.ts`
- Modify: `lib/parse/tablesSidecar.ts`
- Modify: `tests/tableStructure.test.ts`
- Modify: `tests/pdfTableReadingOrder.test.ts`

**Interfaces:**
- Produces: `decideCanonicalContinuation(previous, current): ContinuationDecision`
- `ContinuationDecision` contains `merge: boolean` and exact warnings/reasons.

- [ ] **Step 1: Write continuation RED tests**

Cover:

- explicit `续表` plus compatible columns merges;
- adjacent tables with unequal leaf counts do not merge;
- equal leaf counts but normalized boundary delta above 3% do not merge;
- no title merges only when header-path similarity is at least 0.8;
- duplicate continuation headers are removed only when normalized header paths match.

- [ ] **Step 2: Run target tests and verify RED**

```powershell
node --experimental-strip-types tests/tableStructure.test.ts
node --experimental-strip-types tests/pdfTableReadingOrder.test.ts
```

- [ ] **Step 3: Implement continuation decisions**

Compare adjacent pages only. Normalize x boundaries relative to each table bbox. Require equal leaf count and maximum aligned boundary delta `<= 0.03`. For untitled tables require header token Jaccard `>= 0.8`; reject a conflicting independent title.

- [ ] **Step 4: Integrate V2 into `tablesSidecar.ts`**

Parse V2 output, canonicalize each candidate, convert paragraph fallbacks to paragraph Blocks, group compatible continuation tables, then call `buildTableModelFromCanonical`. Legacy `rows` remains a fallback only for `schemaVersion` absent output.

- [ ] **Step 5: Verify GREEN**

Expected: focused continuation and existing page 16–18 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/parse/tableStructure.ts lib/parse/tablesSidecar.ts tests/tableStructure.test.ts tests/pdfTableReadingOrder.test.ts
git commit -m "fix(parse): merge only compatible continuation tables"
```

### Task 4: Real-PDF parsing gold

**Files:**
- Create: `tests/fixtures/table-parsing/gold-v1.json`
- Create: `tests/tableParsingGold.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Gold entries identify `documentId`, `page`, `expectation`, and exact structural assertions.

- [ ] **Step 1: Add gold entries**

Include:

- page 31 and page 30 paragraph fallbacks with ordered required text;
- page 42 and page 29 exact target rows;
- page 14 exact merged-cell spans/header paths for all six known items;
- pages 17–18 continuation identity and the incompatible page 16/17 negative case.

Each table gold entry includes exact `headers`, `headerPaths`, `rows`, `sourcePages`, and selected `sourceBBoxes`.

- [ ] **Step 2: Write the real-PDF verifier and run RED**

The test loads each repository PDF from `.data/raw/<documentId>`, calls `extractBlocksWithTables`, and compares only the declared page/table gold. Missing PDFs fail with an explicit fixture path.

Run:

```powershell
node --experimental-strip-types tests/tableParsingGold.test.ts
```

Expected: at least one of the four historical defect classes fails before the final integration is complete.

- [ ] **Step 3: Make only fixture-proven corrections**

Tune candidate evidence, row-band assignment, span mapping, or continuation thresholds only when the failing gold provides a direct structural reason. Do not add document names, page numbers, or table text literals to production rules.

- [ ] **Step 4: Verify GREEN and import the test**

Run the focused test until all gold and adjacent negative controls pass, then add:

```ts
import "./tableStructure.test.ts";
import "./tableParsingGold.test.ts";
```

to `tests/index.ts`.

- [ ] **Step 5: Commit**

```powershell
git add tests/fixtures/table-parsing/gold-v1.json tests/tableParsingGold.test.ts tests/index.ts scripts/extract_tables.py lib/parse/tableStructure.ts lib/parse/tablesSidecar.ts
git commit -m "test(parse): lock representative table gold"
```

### Task 5: Reprocessing staging and diff

**Files:**
- Create: `lib/reprocess/tableReprocessStore.ts`
- Create: `lib/reprocess/tableReprocess.ts`
- Create: `tests/tableReprocess.test.ts`

**Interfaces:**
- Produces: `prepareTableReprocess(input): Promise<ReprocessPreparation>`
- Produces: `getTableReprocess(docId, stagingId): ReprocessPreparation`
- `ReprocessPreparation.status` is `ready | blocked | failed | published`.

- [ ] **Step 1: Write RED tests**

Use a temporary data root and dependency injection for parsing/embedding. Assert:

- prepare writes staging payload, manifest, hashes, and diff;
- prepare does not mutate active chunks/ragtables;
- failed structural gates return `blocked`;
- source-hash or base-hash drift is recorded for publish conflict;
- staging identifiers reject traversal characters.

- [ ] **Step 2: Run focused RED**

```powershell
node --experimental-strip-types tests/tableReprocess.test.ts
```

- [ ] **Step 3: Implement the staging store**

Persist under `.data/reprocess/<docId>/<stagingId>/` using sibling temp files and rename. Manifest hashes cover the staged Chunk/RagTable payload and diff report.

- [ ] **Step 4: Implement prepare and diff**

Reuse the same document parse/build functions as `/process`, but inject a sink so staging receives outputs instead of calling `replaceRagTablesForDoc` or active persistence. Diff raw counts and exact per-table header/row/cell changes.

- [ ] **Step 5: Verify GREEN**

Expected: focused reprocessing tests pass.

- [ ] **Step 6: Commit**

```powershell
git add lib/reprocess/tableReprocessStore.ts lib/reprocess/tableReprocess.ts tests/tableReprocess.test.ts
git commit -m "feat(reprocess): stage table parsing updates"
```

### Task 6: Recoverable publish and protected APIs

**Files:**
- Modify: `lib/reprocess/tableReprocessStore.ts`
- Modify: `lib/reprocess/tableReprocess.ts`
- Create: `app/api/documents/[id]/reprocess/prepare/route.ts`
- Create: `app/api/documents/[id]/reprocess/[stagingId]/route.ts`
- Create: `app/api/documents/[id]/reprocess/[stagingId]/publish/route.ts`
- Modify: `tests/tableReprocess.test.ts`
- Create: `tests/tableReprocessApi.test.ts`
- Modify: `tests/index.ts`

**Interfaces:**
- Produces: `publishTableReprocess(input): Promise<Published | Conflict>`
- Produces: `recoverIncompleteTableReprocessTransactions(): void`

- [ ] **Step 1: Add publish/recovery RED tests**

Cover successful publish, second-call idempotency, stale baseline conflict, injected persistence failure rollback, and startup recovery from `applying`.

- [ ] **Step 2: Add protected API RED tests**

Follow the existing document management permission helpers. Assert 403 for unauthorized users, 404 for missing document/staging, 409 for conflict/blocked publish, and 200 for ready/status/published responses.

- [ ] **Step 3: Run focused RED**

```powershell
node --experimental-strip-types tests/tableReprocess.test.ts
node --experimental-strip-types tests/tableReprocessApi.test.ts
```

- [ ] **Step 4: Implement recoverable publish**

Write a transaction journal containing old and target document slices plus hashes. Transition `prepared → applying → committed`; on write failure restore old slices and mark `rolled_back`. Recovery completes already-matching targets or restores the old slices before serving mixed data.

- [ ] **Step 5: Implement API handlers**

Derive the actor server-side, reuse document-management authorization, validate identifiers before filesystem access, and never accept reviewer/owner identity from request JSON.

- [ ] **Step 6: Verify GREEN and import tests**

Add both reprocess tests to `tests/index.ts`; focused files must pass.

- [ ] **Step 7: Commit**

```powershell
git add lib/reprocess app/api/documents tests/tableReprocess.test.ts tests/tableReprocessApi.test.ts tests/index.ts
git commit -m "feat(reprocess): publish table repairs safely"
```

### Task 7: End-to-end verification and documentation

**Files:**
- Modify: `docs/auto-review-pilot-runbook.md`
- Modify: `docs/tech-design.md`
- Test: all files from Tasks 1–6

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Run one real explicit-reprocess dry run**

Use one repository PDF with representative gold. Record pre-prepare `.data/chunks.json` and `.data/ragtables.json` hashes. Verify prepare leaves both hashes unchanged and produces a ready diff.

- [ ] **Step 2: Publish and validate**

Publish the prepared staging version, verify Chunk/RagTable parser versions and target hashes agree, then run the existing numeric/citation assertions for the document.

- [ ] **Step 3: Run the single final grouped gate**

Run each command once, capture the exit code, and retain at most the last 120 log lines:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 4: Update documentation**

Document:

- representative four-class repair scope;
- explicit prepare/diff/publish flow;
- parser version and rollback behavior;
- honest wording: “代表性表格切分问题已修复”, not “所有 PDF 表格已解决”.

- [ ] **Step 5: Commit**

```powershell
git add docs/auto-review-pilot-runbook.md docs/tech-design.md
git commit -m "docs: record structural table repair workflow"
```

