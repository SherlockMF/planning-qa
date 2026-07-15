import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createArtifactStore,
  listArtifactSummaries,
  readArtifact,
  writeArtifactAtomic,
} from "../lib/audit/artifactStore.ts";
import type { AuditManifest, AutoReviewRun, HumanReviewRound } from "../lib/audit/types.ts";

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-store-"));
  const store = createArtifactStore({ rootDir, docId: "doc-1" });
  const autoReview: AutoReviewRun = {
    runId: "run-1",
    artifactId: "artifact-1",
    mode: "rules_only",
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:00:01.000Z",
    items: [],
    summary: { status: "unavailable", reviewedCount: 0, suspectedCount: 0, unavailableCount: 0 },
  };
  const initialReview: HumanReviewRound = {
    reviewId: "review-1",
    artifactId: "artifact-1",
    status: "pending",
    samplingPlan: { requiredItemIds: [], lowRiskSampleItemIds: [] },
    items: [],
  };
  const manifest: AuditManifest = {
    artifactId: "artifact-1",
    docId: "doc-1",
    documentFileName: "pilot.pdf",
    sourceFileSha256: "source-hash",
    createdAt: "2026-07-16T00:00:00.000Z",
    files: {},
  };
  return {
    rootDir,
    store,
    input: {
      manifest,
      reviewMarkdown: "# 自动审核\n\n人工审核：待开始",
      reviewHtml: "<!doctype html><p>自动审核</p><p>人工审核：待开始</p>",
      autoReview,
      initialReview,
    },
  };
}

test("rejects unsafe document, artifact, and review identifiers", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-store-safe-"));
  assert.throws(() => createArtifactStore({ rootDir, docId: "../doc" }), /invalid_identifier/);

  const { store, input } = fixture();
  await assert.rejects(
    () => writeArtifactAtomic(store, {
      ...input,
      manifest: { ...input.manifest, artifactId: "../artifact" },
    }),
    /invalid_identifier/,
  );
  await assert.rejects(
    () => writeArtifactAtomic(store, {
      ...input,
      initialReview: { ...input.initialReview, reviewId: "review/escape" },
    }),
    /invalid_identifier/,
  );
});

test("atomically writes a complete artifact and verifies integrity hashes", async () => {
  const { rootDir, store, input } = fixture();
  const manifest = await writeArtifactAtomic(store, input);
  const artifactDir = path.join(rootDir, "doc-1", "artifact-1");

  for (const relativePath of [
    "manifest.json",
    "review.md",
    "review.html",
    "auto-review.json",
    path.join("reviews", "review-1.json"),
  ]) {
    assert.equal(fs.existsSync(path.join(artifactDir, relativePath)), true, relativePath);
  }
  for (const relativePath of ["review.md", "review.html", "auto-review.json"]) {
    const digest = createHash("sha256")
      .update(fs.readFileSync(path.join(artifactDir, relativePath)))
      .digest("hex");
    assert.equal(manifest.files[relativePath].sha256, digest);
  }

  const artifact = await readArtifact(store, "artifact-1");
  assert.equal(artifact.integrity.ok, true);
  assert.deepEqual(artifact.reviewRounds.map((round) => round.reviewId), ["review-1"]);
  assert.deepEqual(await listArtifactSummaries(store), [{
    artifactId: "artifact-1",
    docId: "doc-1",
    createdAt: "2026-07-16T00:00:00.000Z",
    autoReviewMode: "rules_only",
    suspectedCount: 0,
    unavailableCount: 0,
    latestHumanReviewStatus: "pending",
  }]);
});

test("does not publish or leave temporary directories when atomic creation fails", async () => {
  const { rootDir, store, input } = fixture();
  await assert.rejects(
    () => writeArtifactAtomic(store, input, {
      beforePublish: async () => { throw new Error("simulated_write_failure"); },
    }),
    /simulated_write_failure/,
  );

  const docDir = path.join(rootDir, "doc-1");
  assert.deepEqual(fs.existsSync(docDir) ? fs.readdirSync(docDir) : [], []);
});

test("detects static artifact tampering", async () => {
  const { rootDir, store, input } = fixture();
  await writeArtifactAtomic(store, input);
  fs.writeFileSync(path.join(rootDir, "doc-1", "artifact-1", "review.md"), "tampered");

  const artifact = await readArtifact(store, "artifact-1");
  assert.equal(artifact.integrity.ok, false);
  assert.deepEqual(artifact.integrity.invalidFiles, ["review.md"]);
});
