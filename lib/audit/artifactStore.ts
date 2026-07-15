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
    fs.writeFileSync(childPath(tempDir, "review.md"), input.reviewMd, "utf8");
    fs.writeFileSync(
      childPath(tempDir, "review.html"),
      input.reviewHtml,
      "utf8"
    );
    fs.writeFileSync(
      childPath(tempDir, "review-result.json"),
      JSON.stringify(input.result, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      childPath(tempDir, "manifest.json"),
      JSON.stringify(input.manifest, null, 2),
      "utf8"
    );
    fs.renameSync(tempDir, finalDir);
    return finalDir;
  } catch (error) {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, tempDir);
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
    fs.readFileSync(childPath(directory, "manifest.json"), "utf8")
  );
  const result: ReviewResult = JSON.parse(
    fs.readFileSync(childPath(directory, "review-result.json"), "utf8")
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
    reviewMd: fs.readFileSync(childPath(directory, "review.md"), "utf8"),
    reviewHtml: fs.readFileSync(childPath(directory, "review.html"), "utf8"),
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

  const target = childPath(loaded.directory, "review-result.json");
  const token = randomUUID();
  const temp = childPath(loaded.directory, `.review-result-${token}.tmp`);
  const backup = childPath(loaded.directory, `.review-result-${token}.bak`);
  let targetMoved = false;

  try {
    fs.writeFileSync(temp, JSON.stringify(result, null, 2), "utf8");
    fs.renameSync(target, backup);
    targetMoved = true;
    fs.renameSync(temp, target);
    targetMoved = false;
    fs.rmSync(backup, { force: true });
  } catch (error) {
    fs.rmSync(temp, { force: true });
    if (targetMoved && fs.existsSync(backup) && !fs.existsSync(target)) {
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    fs.rmSync(temp, { force: true });
    if (fs.existsSync(target)) fs.rmSync(backup, { force: true });
  }
}

export function listReviewArtifacts(
  documentId: string,
  rootDir = DEFAULT_ARTIFACT_ROOT
): ReviewArtifactSummary[] {
  validateId("documentId", documentId);
  const docDir = childPath(rootDir, documentId);
  if (!fs.existsSync(docDir)) return [];

  return fs
    .readdirSync(docDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".tmp-") &&
        SAFE_ID.test(entry.name)
    )
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
