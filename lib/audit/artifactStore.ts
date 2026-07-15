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

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function childPath(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  if (!isWithin(resolvedRoot, resolved)) {
    throw new Error("artifact path escaped root");
  }
  return resolved;
}

interface RootBoundary {
  configuredRoot: string;
  canonicalRoot: string;
}

function hasPath(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function rootBoundary(root: string, create: boolean): RootBoundary {
  const configuredRoot = path.resolve(root);
  if (create) fs.mkdirSync(configuredRoot, { recursive: true });
  return {
    configuredRoot,
    canonicalRoot: fs.realpathSync.native(configuredRoot),
  };
}

function assertSafePath(
  boundary: RootBoundary,
  target: string,
  allowMissing: boolean
): void {
  const resolvedTarget = path.resolve(target);
  if (!isWithin(boundary.configuredRoot, resolvedTarget)) {
    throw new Error("artifact path escaped root");
  }

  const relative = path.relative(boundary.configuredRoot, resolvedTarget);
  const parts = relative === "" ? [] : relative.split(path.sep);
  let current = boundary.configuredRoot;
  for (const part of parts) {
    current = path.join(current, part);
    if (!hasPath(current)) {
      if (allowMissing) return;
      fs.lstatSync(current);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error("artifact path contains symlink or reparse point");
    }
    const canonical = fs.realpathSync.native(current);
    if (!isWithin(boundary.canonicalRoot, canonical)) {
      throw new Error("artifact path escaped root");
    }
  }
}

function writeNewFile(
  boundary: RootBoundary,
  target: string,
  content: string
): void {
  assertSafePath(boundary, path.dirname(target), false);
  assertSafePath(boundary, target, true);
  fs.writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
  assertSafePath(boundary, target, false);
}

function readSafeFile(boundary: RootBoundary, target: string): string {
  assertSafePath(boundary, target, false);
  return fs.readFileSync(target, "utf8");
}

function removeSafeFile(boundary: RootBoundary, target: string): void {
  if (!hasPath(target)) return;
  assertSafePath(boundary, target, false);
  fs.rmSync(target, { force: true });
}

export interface LoadedArtifact {
  directory: string;
  manifest: AuditManifest;
  reviewMd: string;
  reviewHtml: string;
  result: ReviewResult;
}

function validatePublication(input: {
  documentId: string;
  manifest: AuditManifest;
  reviewMd: string;
  reviewHtml: string;
  result: ReviewResult;
}): void {
  if (
    input.manifest.document.id !== input.documentId ||
    input.result.artifactId !== input.manifest.artifactId
  ) {
    throw new Error("artifact identity mismatch");
  }
  if (input.manifest.schemaVersion !== 1 || input.result.schemaVersion !== 1) {
    throw new Error("unsupported schema version");
  }
  if (sha256Text(input.reviewMd) !== input.manifest.files.reviewMdSha256) {
    throw new Error("review_md_hash_mismatch");
  }
  if (sha256Text(input.reviewHtml) !== input.manifest.files.reviewHtmlSha256) {
    throw new Error("review_html_hash_mismatch");
  }
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
  validatePublication(input);
  const root = input.rootDir ?? DEFAULT_ARTIFACT_ROOT;
  const boundary = rootBoundary(root, true);
  const docDir = childPath(boundary.configuredRoot, input.documentId);
  const finalDir = childPath(
    boundary.configuredRoot,
    input.documentId,
    input.manifest.artifactId
  );
  const tempDir = childPath(
    boundary.configuredRoot,
    input.documentId,
    `.tmp-${input.manifest.artifactId}`
  );

  assertSafePath(boundary, docDir, true);
  fs.mkdirSync(docDir, { recursive: true });
  assertSafePath(boundary, docDir, false);
  assertSafePath(boundary, finalDir, true);
  if (fs.existsSync(finalDir)) throw new Error("artifact already exists");
  assertSafePath(boundary, tempDir, true);
  fs.mkdirSync(tempDir);
  assertSafePath(boundary, tempDir, false);

  try {
    writeNewFile(
      boundary,
      childPath(tempDir, "review.md"),
      input.reviewMd
    );
    writeNewFile(
      boundary,
      childPath(tempDir, "review.html"),
      input.reviewHtml
    );
    writeNewFile(
      boundary,
      childPath(tempDir, "review-result.json"),
      JSON.stringify(input.result, null, 2)
    );
    writeNewFile(
      boundary,
      childPath(tempDir, "manifest.json"),
      JSON.stringify(input.manifest, null, 2)
    );
    assertSafePath(boundary, tempDir, false);
    assertSafePath(boundary, finalDir, true);
    fs.renameSync(tempDir, finalDir);
    assertSafePath(boundary, finalDir, false);
    return finalDir;
  } catch (error) {
    if (hasPath(tempDir)) {
      assertSafePath(boundary, tempDir, false);
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
  const boundary = rootBoundary(rootDir, false);
  const directory = childPath(boundary.configuredRoot, documentId, artifactId);
  assertSafePath(boundary, directory, false);
  const manifest: AuditManifest = JSON.parse(
    readSafeFile(boundary, childPath(directory, "manifest.json"))
  );
  const result: ReviewResult = JSON.parse(
    readSafeFile(boundary, childPath(directory, "review-result.json"))
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
    reviewMd: readSafeFile(boundary, childPath(directory, "review.md")),
    reviewHtml: readSafeFile(boundary, childPath(directory, "review.html")),
    result,
  };
}

export function verifyArtifactIntegrity(
  artifact: LoadedArtifact
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (
    sha256Text(artifact.reviewMd) !== artifact.manifest.files.reviewMdSha256
  ) {
    errors.push("review_md_hash_mismatch");
  }
  if (
    sha256Text(artifact.reviewHtml) !== artifact.manifest.files.reviewHtmlSha256
  ) {
    errors.push("review_html_hash_mismatch");
  }
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
  if (result.artifactId !== artifactId) {
    throw new Error("artifact identity mismatch");
  }

  const boundary = rootBoundary(rootDir, false);
  assertSafePath(boundary, loaded.directory, false);
  const target = childPath(loaded.directory, "review-result.json");
  const token = randomUUID();
  const temp = childPath(loaded.directory, `.review-result-${token}.tmp`);
  const backup = childPath(loaded.directory, `.review-result-${token}.bak`);
  let targetMoved = false;

  try {
    assertSafePath(boundary, target, false);
    writeNewFile(boundary, temp, JSON.stringify(result, null, 2));
    assertSafePath(boundary, backup, true);
    fs.renameSync(target, backup);
    targetMoved = true;
    assertSafePath(boundary, backup, false);
    assertSafePath(boundary, temp, false);
    assertSafePath(boundary, target, true);
    fs.renameSync(temp, target);
    targetMoved = false;
    assertSafePath(boundary, target, false);
    removeSafeFile(boundary, backup);
  } catch (error) {
    if (targetMoved && hasPath(backup) && !hasPath(target)) {
      assertSafePath(boundary, backup, false);
      assertSafePath(boundary, target, true);
      fs.renameSync(backup, target);
      assertSafePath(boundary, target, false);
    }
    removeSafeFile(boundary, temp);
    if (hasPath(target)) removeSafeFile(boundary, backup);
    throw error;
  }
}

export function listReviewArtifacts(
  documentId: string,
  rootDir = DEFAULT_ARTIFACT_ROOT
): ReviewArtifactSummary[] {
  validateId("documentId", documentId);
  const resolvedRoot = path.resolve(rootDir);
  if (!hasPath(resolvedRoot)) return [];
  const boundary = rootBoundary(resolvedRoot, false);
  const docDir = childPath(boundary.configuredRoot, documentId);
  assertSafePath(boundary, docDir, true);
  if (!hasPath(docDir)) return [];
  assertSafePath(boundary, docDir, false);

  return fs
    .readdirSync(docDir, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith(".tmp-") &&
        SAFE_ID.test(entry.name)
    )
    .filter((entry) => {
      const artifactDir = childPath(docDir, entry.name);
      assertSafePath(boundary, artifactDir, false);
      return entry.isDirectory();
    })
    .map((entry) => loadArtifact(rootDir, documentId, entry.name))
    .map((artifact) => ({
      documentId,
      artifactId: artifact.manifest.artifactId,
      generatedAt: artifact.manifest.generatedAt,
      status: artifact.result.status,
      reviewerUserId: artifact.result.reviewerUserId,
      finalizedAt: artifact.result.finalizedAt,
      focusItemCount: artifact.manifest.summary.focusItemCount,
      issueCount: artifact.result.items.filter((item) => item.status === "issue")
        .length,
    }))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}
