import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createArtifactStore, writeArtifactAtomic } from "../lib/audit/artifactStore.ts";
import type {
  AuditManifest,
  AuditReviewItem,
  AutoReviewRun,
  HumanReviewItem,
  HumanReviewRound,
} from "../lib/audit/types.ts";
import type { Document } from "../lib/types.ts";
import { createReviewArtifactApi } from "../app/api/documents/[id]/review-artifacts/access.ts";

const SOURCE = Buffer.from("review-api-source");
const MANAGER = "user-manager-riverfront";
const EMPLOYEE = "user-employee-riverfront";

test("protects artifact listing with document management permission", async (t) => {
  const fixture = await createFixture(t);

  const allowed = await fixture.api.listArtifacts(request(fixture.docId, MANAGER), {
    id: fixture.docId,
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).artifacts[0].artifactId, fixture.artifactId);

  const denied = await fixture.api.listArtifacts(request(fixture.docId, EMPLOYEE), {
    id: fixture.docId,
  });
  assert.equal(denied.status, 403);
});

test("returns explicit path, missing artifact, and integrity status codes", async (t) => {
  const fixture = await createFixture(t);

  const traversal = await fixture.api.readArtifact(request(fixture.docId, MANAGER), {
    id: fixture.docId,
    artifactId: "../outside",
  });
  assert.equal(traversal.status, 400);

  const missing = await fixture.api.readArtifact(request(fixture.docId, MANAGER), {
    id: fixture.docId,
    artifactId: "artifact-missing",
  });
  assert.equal(missing.status, 404);

  fs.writeFileSync(
    path.join(fixture.rootDir, fixture.docId, fixture.artifactId, "auto-review.json"),
    "{}",
  );
  const corrupted = await fixture.api.readArtifact(request(fixture.docId, MANAGER), {
    id: fixture.docId,
    artifactId: fixture.artifactId,
  });
  assert.equal(corrupted.status, 409);
  assert.deepEqual((await corrupted.json()).invalidFiles, ["auto-review.json"]);
});

test("derives the reviewer on the server and enforces finalize immutability", async (t) => {
  const fixture = await createFixture(t);
  const route = `${fixture.docId}/review-artifacts/${fixture.artifactId}/reviews/${fixture.reviewId}`;
  const passedItem = humanItem();

  const draft = await fixture.api.updateReview(
    request(route, MANAGER, "PATCH", {
      action: "save_draft",
      reviewerUserId: "user-admin",
      items: [passedItem],
    }),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  assert.equal(draft.status, 200);
  assert.equal((await draft.json()).review.reviewerUserId, MANAGER);

  const incomplete = await fixture.api.updateReview(
    request(route, MANAGER, "PATCH", { action: "finalize", items: [] }),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  assert.equal(incomplete.status, 400);

  const finalized = await fixture.api.updateReview(
    request(route, MANAGER, "PATCH", { action: "finalize", items: [passedItem] }),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  assert.equal(finalized.status, 200);
  assert.ok((await finalized.json()).review.finalizedAt);

  const overwrite = await fixture.api.updateReview(
    request(route, MANAGER, "PATCH", { action: "save_draft", items: [passedItem] }),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  assert.equal(overwrite.status, 409);
});

test("creates re-review only from a finalized parent and preserves the old round", async (t) => {
  const fixture = await createFixture(t);
  const reviewsRoute = `${fixture.docId}/review-artifacts/${fixture.artifactId}/reviews`;

  const beforeFinalize = await fixture.api.createReview(
    request(reviewsRoute, MANAGER, "POST", { parentReviewId: fixture.reviewId }),
    { id: fixture.docId, artifactId: fixture.artifactId },
  );
  assert.equal(beforeFinalize.status, 400);

  await fixture.api.updateReview(
    request(`${reviewsRoute}/${fixture.reviewId}`, MANAGER, "PATCH", {
      action: "finalize",
      items: [humanItem()],
    }),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  const rereview = await fixture.api.createReview(
    request(reviewsRoute, MANAGER, "POST", {
      parentReviewId: fixture.reviewId,
      reviewerUserId: "user-admin",
    }),
    { id: fixture.docId, artifactId: fixture.artifactId },
  );
  assert.equal(rereview.status, 201);
  const rereviewBody = await rereview.json();
  assert.equal(rereviewBody.review.parentReviewId, fixture.reviewId);
  assert.notEqual(rereviewBody.review.reviewId, fixture.reviewId);
  assert.equal(rereviewBody.review.reviewerUserId, undefined);

  const oldRound = await fixture.api.readReview(request(`${reviewsRoute}/${fixture.reviewId}`, MANAGER), {
    id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId,
  });
  assert.equal(oldRound.status, 200);
  assert.ok((await oldRound.json()).review.finalizedAt);

  const rounds = await fixture.api.listReviews(request(reviewsRoute, MANAGER), {
    id: fixture.docId, artifactId: fixture.artifactId,
  });
  assert.equal(rounds.status, 200);
  assert.equal((await rounds.json()).reviews.length, 2);
});

test("blocks mutations when the current source file no longer matches the manifest", async (t) => {
  const fixture = await createFixture(t);
  fixture.setSource(Buffer.from("changed-source"));

  const response = await fixture.api.updateReview(
    request(
      `${fixture.docId}/review-artifacts/${fixture.artifactId}/reviews/${fixture.reviewId}`,
      MANAGER,
      "PATCH",
      { action: "save_draft", items: [humanItem()] },
    ),
    { id: fixture.docId, artifactId: fixture.artifactId, reviewId: fixture.reviewId },
  );
  assert.equal(response.status, 409);
});

function request(pathname: string, userId: string, method = "GET", body?: unknown): Request {
  const pathWithApi = pathname.startsWith("doc-") ? `/api/documents/${pathname}` : pathname;
  return new Request(`http://localhost${pathWithApi}?userId=${encodeURIComponent(userId)}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function humanItem(): HumanReviewItem {
  return {
    auditItemId: "item-1",
    status: "passed",
    issueTypes: [],
    comment: "",
    reviewedAt: "2026-07-16T02:00:00.000Z",
  };
}

async function createFixture(t: TestContext) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-review-api-"));
  const docId = `doc-api-${suffix}`;
  const artifactId = `artifact-api-${suffix}`;
  const reviewId = `review-api-${suffix}`;
  const nextReviewId = `review-api-next-${suffix}`;
  const doc: Document = {
    id: docId,
    fileName: "review.pdf",
    fileType: "项目资料",
    city: "北京",
    category: "项目资料",
    owner: "李婷",
    department: "规划一所",
    permissionLevel: 2,
    projectId: "project-riverfront",
    projectOwnerId: MANAGER,
    accessibleUserIds: [MANAGER, EMPLOYEE],
    enabled: true,
    status: "indexed",
    createdAt: "2026-07-16T00:00:00.000Z",
  };
  let currentSource = SOURCE;

  const reviewItem: AuditReviewItem = {
    auditItemId: "item-1",
    objectType: "structured_table_row",
    title: "服务规模",
    content: "1000—5000户",
    warnings: [],
    selectedForReview: true,
    selectionReason: "table_coverage",
    source: { pageStart: 17, blockIds: ["block-1"], tableId: "table-1", rowIndex: 1, chunkIds: ["chunk-1"] },
  };
  const manifest: AuditManifest = {
    artifactId,
    docId,
    documentFileName: doc.fileName,
    sourceFileSha256: createHash("sha256").update(SOURCE).digest("hex"),
    createdAt: "2026-07-16T00:00:00.000Z",
    files: {},
    reviewItems: [reviewItem],
  };
  const autoReview: AutoReviewRun = {
    runId: "run-1",
    artifactId,
    mode: "rules_only",
    startedAt: "2026-07-16T00:00:00.000Z",
    finishedAt: "2026-07-16T00:01:00.000Z",
    items: [{
      auditItemId: "item-1",
      status: "suspected_issue",
      mode: "rules_only",
      riskScore: 70,
      riskLevel: "high",
      issueTypes: ["column_misalignment"],
      summary: "疑似错列",
      ruleSignals: [],
      source: reviewItem.source,
      reviewedAt: "2026-07-16T00:01:00.000Z",
    }],
    summary: { status: "completed", reviewedCount: 1, suspectedCount: 1, unavailableCount: 0 },
  };
  const initialReview: HumanReviewRound = {
    reviewId,
    artifactId,
    status: "pending",
    samplingPlan: { requiredItemIds: ["item-1"], lowRiskSampleItemIds: [] },
    items: [],
  };
  await writeArtifactAtomic(
    createArtifactStore({
      rootDir,
      docId,
      now: () => "2026-07-16T03:00:00.000Z",
      createReviewId: () => nextReviewId,
    }),
    { manifest, reviewMarkdown: "# review", reviewHtml: "<h1>review</h1>", autoReview, initialReview },
  );

  t.after(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  const api = createReviewArtifactApi({
    artifactRoot: rootDir,
    getDocument: async (id) => id === docId ? doc : undefined,
    resolveUserId: (req) => new URL(req.url).searchParams.get("userId") ?? "",
    canManage: (userId) => userId === MANAGER,
    getSourceBuffer: (id) => id === docId ? currentSource : undefined,
    now: () => "2026-07-16T03:00:00.000Z",
    createReviewId: () => nextReviewId,
  });
  return {
    api,
    rootDir,
    docId,
    artifactId,
    reviewId,
    setSource: (source: Buffer) => { currentSource = source; },
  };
}
