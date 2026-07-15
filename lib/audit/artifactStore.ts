import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  AuditManifest,
  AutoReviewRun,
  HumanReviewRound,
  ReviewArtifactSummary,
} from "./types.ts";

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const INTEGRITY_FILES = ["review.md", "review.html", "auto-review.json"] as const;

export interface ArtifactStore {
  rootDir: string;
  docId: string;
  now: () => string;
  createReviewId: () => string;
}

export interface CreateArtifactStoreInput {
  rootDir?: string;
  docId: string;
  now?: () => string;
  createReviewId?: () => string;
}

export interface WriteArtifactInput {
  manifest: AuditManifest;
  reviewMarkdown: string;
  reviewHtml: string;
  autoReview: AutoReviewRun;
  initialReview: HumanReviewRound;
}

export interface ReadArtifactResult {
  manifest: AuditManifest;
  reviewMarkdown: string;
  reviewHtml: string;
  autoReview: AutoReviewRun;
  reviewRounds: HumanReviewRound[];
  integrity: { ok: boolean; invalidFiles: string[] };
}

export function createArtifactStore(input: CreateArtifactStoreInput): ArtifactStore {
  assertSafeIdentifier(input.docId);
  return {
    rootDir: path.resolve(input.rootDir ?? path.join(process.cwd(), "artifacts")),
    docId: input.docId,
    now: input.now ?? (() => new Date().toISOString()),
    createReviewId: input.createReviewId ?? (() => `review-${randomUUID()}`),
  };
}

export async function writeArtifactAtomic(
  store: ArtifactStore,
  input: WriteArtifactInput,
  hooks: { beforePublish?: () => Promise<void> } = {},
): Promise<AuditManifest> {
  const { manifest, initialReview } = input;
  assertSafeIdentifier(manifest.artifactId);
  assertSafeIdentifier(initialReview.reviewId);
  if (manifest.docId !== store.docId) throw new Error("artifact_document_mismatch");
  if (initialReview.artifactId !== manifest.artifactId) throw new Error("review_artifact_mismatch");

  const docDir = documentDirectory(store);
  const targetDir = artifactDirectory(store, manifest.artifactId);
  const temporaryDir = path.join(docDir, `.${manifest.artifactId}.tmp-${randomUUID()}`);
  await fs.promises.mkdir(docDir, { recursive: true });
  if (await exists(targetDir)) throw new Error("artifact_already_exists");

  try {
    await fs.promises.mkdir(path.join(temporaryDir, "reviews"), { recursive: true });
    const autoReviewJson = json(input.autoReview);
    const content = new Map<string, string>([
      ["review.md", input.reviewMarkdown],
      ["review.html", input.reviewHtml],
      ["auto-review.json", autoReviewJson],
    ]);
    const completedManifest: AuditManifest = {
      ...manifest,
      files: Object.fromEntries(
        [...content].map(([name, value]) => [name, { sha256: sha256(value) }]),
      ),
    };

    for (const [relativePath, value] of content) {
      await writeNewFileSynced(path.join(temporaryDir, relativePath), value);
    }
    await writeNewFileSynced(path.join(temporaryDir, "manifest.json"), json(completedManifest));
    await writeNewFileSynced(
      path.join(temporaryDir, "reviews", `${initialReview.reviewId}.json`),
      json(initialReview),
    );
    await hooks.beforePublish?.();
    await fs.promises.rename(temporaryDir, targetDir);
    return completedManifest;
  } catch (error) {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

export async function readArtifact(
  store: ArtifactStore,
  artifactId: string,
): Promise<ReadArtifactResult> {
  const artifactDir = artifactDirectory(store, artifactId);
  const [manifestText, reviewMarkdown, reviewHtml, autoReviewText] = await Promise.all([
    fs.promises.readFile(path.join(artifactDir, "manifest.json"), "utf8"),
    fs.promises.readFile(path.join(artifactDir, "review.md"), "utf8"),
    fs.promises.readFile(path.join(artifactDir, "review.html"), "utf8"),
    fs.promises.readFile(path.join(artifactDir, "auto-review.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as AuditManifest;
  if (manifest.artifactId !== artifactId || manifest.docId !== store.docId) {
    throw new Error("artifact_identity_mismatch");
  }
  const actualContent: Record<(typeof INTEGRITY_FILES)[number], string> = {
    "review.md": reviewMarkdown,
    "review.html": reviewHtml,
    "auto-review.json": autoReviewText,
  };
  const invalidFiles = INTEGRITY_FILES.filter(
    (name) => manifest.files[name]?.sha256 !== sha256(actualContent[name]),
  );

  const reviewsDir = path.join(artifactDir, "reviews");
  const reviewRounds = (await fs.promises.readdir(reviewsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .map((reviewId) => {
      assertSafeIdentifier(reviewId);
      return reviewId;
    });
  const rounds = await Promise.all(reviewRounds.map(async (reviewId) =>
    JSON.parse(await fs.promises.readFile(reviewFile(store, artifactId, reviewId), "utf8")) as HumanReviewRound
  ));
  rounds.sort((left, right) =>
    (left.startedAt ?? "").localeCompare(right.startedAt ?? "") || left.reviewId.localeCompare(right.reviewId)
  );

  return {
    manifest,
    reviewMarkdown,
    reviewHtml,
    autoReview: JSON.parse(autoReviewText) as AutoReviewRun,
    reviewRounds: rounds,
    integrity: { ok: invalidFiles.length === 0, invalidFiles },
  };
}

export async function listArtifactSummaries(store: ArtifactStore): Promise<ReviewArtifactSummary[]> {
  const docDir = documentDirectory(store);
  if (!(await exists(docDir))) return [];
  const entries = await fs.promises.readdir(docDir, { withFileTypes: true });
  const summaries: ReviewArtifactSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    assertSafeIdentifier(entry.name);
    const artifact = await readArtifact(store, entry.name);
    const latestRound = artifact.reviewRounds.at(-1);
    summaries.push({
      artifactId: artifact.manifest.artifactId,
      docId: artifact.manifest.docId,
      createdAt: artifact.manifest.createdAt,
      autoReviewMode: artifact.autoReview.mode,
      suspectedCount: artifact.autoReview.summary.suspectedCount,
      unavailableCount: artifact.autoReview.summary.unavailableCount,
      latestHumanReviewStatus: latestRound?.status,
    });
  }
  return summaries.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.artifactId.localeCompare(left.artifactId)
  );
}

export function artifactDirectory(store: ArtifactStore, artifactId: string): string {
  assertSafeIdentifier(artifactId);
  return resolveUnder(documentDirectory(store), artifactId);
}

export function reviewFile(store: ArtifactStore, artifactId: string, reviewId: string): string {
  assertSafeIdentifier(reviewId);
  return resolveUnder(artifactDirectory(store, artifactId), "reviews", `${reviewId}.json`);
}

export async function writeJsonAtomic(filePath: string, value: unknown, createOnly = false): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeNewFileSynced(temporaryPath, json(value));
    if (createOnly && await exists(filePath)) throw new Error("review_already_exists");
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
}

export function assertSafeIdentifier(value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("invalid_identifier");
}

function documentDirectory(store: ArtifactStore): string {
  return resolveUnder(store.rootDir, store.docId);
}

function resolveUnder(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("unsafe_artifact_path");
  }
  return resolved;
}

async function writeNewFileSynced(filePath: string, content: string): Promise<void> {
  const handle = await fs.promises.open(filePath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
