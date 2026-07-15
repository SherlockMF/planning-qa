import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

import type { Document } from "../lib/types.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const moduleWithHooks = nodeModule as unknown as {
  registerHooks(input: {
    resolve(
      specifier: string,
      context: { parentURL?: string },
      nextResolve: (
        specifier: string,
        context: { parentURL?: string }
      ) => unknown
    ): unknown;
  }): unknown;
};

moduleWithHooks.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith("@/")) {
      const resolved = path.resolve(projectRoot, specifier.slice(2));
      const target = path.extname(resolved) ? resolved : `${resolved}.ts`;
      return nextResolve(pathToFileURL(target).href, context);
    }
    if (
      specifier.startsWith(".") &&
      context.parentURL &&
      !path.extname(specifier)
    ) {
      const resolved = fileURLToPath(new URL(specifier, context.parentURL));
      if (fs.existsSync(`${resolved}.ts`)) {
        return nextResolve(pathToFileURL(`${resolved}.ts`).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const modulesPromise = Promise.all([
  import("next/server.js"),
  import("../lib/audit/artifactStore.ts"),
  import("../lib/audit/createReviewArtifact.ts"),
  import("../lib/audit/reviewItems.ts"),
  import("../lib/db/store.ts"),
  import("../app/api/documents/[id]/review-artifacts/route.ts"),
  import("../app/api/documents/[id]/review-artifacts/[artifactId]/route.ts"),
  import(
    "../app/api/documents/[id]/review-artifacts/[artifactId]/review/route.ts"
  ),
]).then(
  ([nextServer, artifactStore, createArtifact, reviewItems, store, list, artifact, review]) => ({
    NextRequest: nextServer.NextRequest,
    artifactStore,
    sha256Buffer: createArtifact.sha256Buffer,
    sha256Text: reviewItems.sha256Text,
    store,
    listGET: list.GET,
    artifactGET: artifact.GET,
    reviewGET: review.GET,
    reviewPUT: review.PUT,
  })
);

interface RouteFixture {
  documentId: string;
  artifactId: string;
  sourceBuffer: Buffer;
  reviewPath: string;
  artifactPath: string;
  listPath: string;
  cleanup(): void;
}

type GenericRouteHandler = (
  req: unknown,
  context: { params: Record<string, string> }
) => Promise<Response>;

async function createRouteFixture(): Promise<RouteFixture> {
  const modules = await modulesPromise;
  await modules.store.ensureSeeded();
  const store = modules.store.getStore();
  const originalDocuments = store.documents;
  const documentId = `doc-review-${randomUUID()}`;
  const artifactId = `artifact-${randomUUID()}`;
  const sourceBuffer = Buffer.from(`source:${documentId}`, "utf8");
  const hadRawBuffer = Object.prototype.hasOwnProperty.call(
    store.rawBuffers,
    documentId
  );
  const originalRawBuffer = store.rawBuffers[documentId];
  const document: Document = {
    id: documentId,
    fileName: "review-test.pdf",
    city: "测试市",
    fileType: "项目资料",
    category: "项目资料",
    projectId: "project-tod",
    projectOwnerId: "user-manager-tod",
    enabled: true,
    status: "indexed",
    createdAt: "2026-07-15T00:00:00.000Z",
  };
  store.documents = [...originalDocuments, document];
  store.rawBuffers[documentId] = sourceBuffer;

  const reviewMd = "# Review\n";
  const reviewHtml = "<!doctype html><html><body>Review</body></html>";
  modules.artifactStore.createArtifactDirectory({
    rootDir: modules.artifactStore.DEFAULT_ARTIFACT_ROOT,
    documentId,
    manifest: {
      schemaVersion: 1,
      artifactId,
      generatedAt: "2026-07-15T00:00:00.000Z",
      document: {
        id: documentId,
        fileName: document.fileName,
        sourceFileSha256: modules.sha256Buffer(sourceBuffer),
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
      items: [
        {
          auditItemId: "plain_section:obj-1",
          objectType: "plain_section",
          title: "审核项",
          sourceBlockIds: ["block-1"],
          knowledgeObjectId: "obj-1",
          chunkIds: ["chunk-1"],
          confidence: 0.95,
          warnings: [],
          contentSha256: modules.sha256Text("正文"),
          selectedForReview: true,
          selectionReason: "stable_sample",
        },
      ],
      files: {
        reviewMdSha256: modules.sha256Text(reviewMd),
        reviewHtmlSha256: modules.sha256Text(reviewHtml),
      },
    },
    reviewMd,
    reviewHtml,
    result: {
      schemaVersion: 1,
      artifactId,
      status: "pending",
      items: [],
    },
  });

  const listPath = `/api/documents/${documentId}/review-artifacts`;
  const artifactPath = `${listPath}/${artifactId}`;
  return {
    documentId,
    artifactId,
    sourceBuffer,
    listPath,
    artifactPath,
    reviewPath: `${artifactPath}/review`,
    cleanup() {
      store.documents = originalDocuments;
      if (hadRawBuffer) {
        store.rawBuffers[documentId] = originalRawBuffer!;
      } else {
        delete store.rawBuffers[documentId];
      }

      const root = path.resolve(modules.artifactStore.DEFAULT_ARTIFACT_ROOT);
      const target = path.resolve(root, documentId);
      const relative = path.relative(root, target);
      assert.notEqual(relative, "");
      assert.equal(path.isAbsolute(relative), false);
      assert.equal(relative === ".." || relative.startsWith(`..${path.sep}`), false);
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}

async function withRouteFixture(
  run: (fixture: RouteFixture) => Promise<void>
): Promise<void> {
  const fixture = await createRouteFixture();
  try {
    await run(fixture);
  } finally {
    fixture.cleanup();
  }
}

async function request(
  pathname: string,
  userId: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> }
) {
  const { NextRequest } = await modulesPromise;
  const url = new URL(pathname, "http://localhost");
  url.searchParams.set("userId", userId);
  return new NextRequest(url, init);
}

function reviewBody(action: "save_draft" | "finalize") {
  return {
    action,
    items: [
      {
        auditItemId: "plain_section:obj-1",
        status: "passed",
        issueTypes: [],
        comment: "",
      },
    ],
  };
}

async function putRequest(pathname: string, userId: string, action: "save_draft" | "finalize") {
  return request(pathname, userId, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reviewBody(action)),
  });
}

test("shared guard rejects employees and missing documents across review routes", { concurrency: false }, async () => {
  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    const employeeCases = [
      [modules.listGET, fixture.listPath, { id: fixture.documentId }],
      [modules.artifactGET, fixture.artifactPath, { id: fixture.documentId, artifactId: fixture.artifactId }],
      [modules.reviewGET, fixture.reviewPath, { id: fixture.documentId, artifactId: fixture.artifactId }],
    ] as const;
    for (const [handler, pathname, params] of employeeCases) {
      const response = await (handler as unknown as GenericRouteHandler)(
        await request(pathname, "user-employee-riverfront"),
        { params }
      );
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json()).error, "当前账号无权审核该文档");
    }

    const missingId = `doc-missing-${randomUUID()}`;
    const missingCases = [
      [modules.listGET, `/api/documents/${missingId}/review-artifacts`, { id: missingId }],
      [modules.artifactGET, `/api/documents/${missingId}/review-artifacts/${fixture.artifactId}`, { id: missingId, artifactId: fixture.artifactId }],
      [modules.reviewGET, `/api/documents/${missingId}/review-artifacts/${fixture.artifactId}/review`, { id: missingId, artifactId: fixture.artifactId }],
    ] as const;
    for (const [handler, pathname, params] of missingCases) {
      const response = await (handler as unknown as GenericRouteHandler)(
        await request(pathname, "user-admin"),
        { params }
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json()).error, "文档不存在");
    }
  });
});

test("artifact responses enforce integrity before every format and harden HTML", { concurrency: false }, async () => {
  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    const params = { id: fixture.documentId, artifactId: fixture.artifactId };
    const html = await modules.artifactGET(
      await request(`${fixture.artifactPath}?format=html`, "user-admin"),
      { params }
    );
    assert.equal(html.status, 200);
    assert.equal(html.headers.get("cache-control"), "private, no-store");
    assert.equal(html.headers.get("x-content-type-options"), "nosniff");
    assert.equal(html.headers.get("x-frame-options"), "DENY");
    assert.equal(
      html.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );

    const manifest = await modules.artifactGET(
      await request(`${fixture.artifactPath}?format=manifest`, "user-admin"),
      { params }
    );
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get("cache-control"), "private, no-store");

    const invalidFormat = await modules.artifactGET(
      await request(`${fixture.artifactPath}?format=xml`, "user-admin"),
      { params }
    );
    assert.equal(invalidFormat.status, 400);
    assert.equal(
      invalidFormat.headers.get("cache-control"),
      "private, no-store"
    );

    const missingArtifact = await modules.artifactGET(
      await request(`${fixture.listPath}/artifact-missing`, "user-admin"),
      { params: { id: fixture.documentId, artifactId: "artifact-missing" } }
    );
    assert.equal(missingArtifact.status, 404);
    assert.equal(
      missingArtifact.headers.get("cache-control"),
      "private, no-store"
    );

    fs.appendFileSync(
      path.join(
        modules.artifactStore.DEFAULT_ARTIFACT_ROOT,
        fixture.documentId,
        fixture.artifactId,
        "review.html"
      ),
      "tampered",
      "utf8"
    );
    for (const format of ["html", "markdown", "manifest"] as const) {
      const response = await modules.artifactGET(
        await request(`${fixture.artifactPath}?format=${format}`, "user-admin"),
        { params }
      );
      assert.equal(response.status, 409);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.json()).error, "审核副本完整性校验失败");
    }
  });
});

test("list and review JSON responses are private and source changes block submission", { concurrency: false }, async () => {
  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    const params = { id: fixture.documentId, artifactId: fixture.artifactId };
    const list = await modules.listGET(
      await request(fixture.listPath, "user-admin"),
      { params: { id: fixture.documentId } }
    );
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("cache-control"), "private, no-store");

    const review = await modules.reviewGET(
      await request(fixture.reviewPath, "user-admin"),
      { params }
    );
    assert.equal(review.status, 200);
    assert.equal(review.headers.get("cache-control"), "private, no-store");

    delete modules.store.getStore().rawBuffers[fixture.documentId];
    const missingSource = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-admin", "save_draft"),
      { params }
    );
    assert.equal(missingSource.status, 409);
    assert.equal((await missingSource.json()).error, "原文件已变化，旧快照不能提交");
    assert.equal(missingSource.headers.get("cache-control"), "private, no-store");
  });

  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    modules.store.getStore().rawBuffers[fixture.documentId] = Buffer.from("changed", "utf8");
    const response = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-admin", "save_draft"),
      { params: { id: fixture.documentId, artifactId: fixture.artifactId } }
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "原文件已变化，旧快照不能提交");
  });
});

test("draft ownership and terminal states are exposed through availability", { concurrency: false }, async () => {
  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    const params = { id: fixture.documentId, artifactId: fixture.artifactId };
    const draft = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-admin", "save_draft"),
      { params }
    );
    assert.equal(draft.status, 200);
    assert.equal(draft.headers.get("cache-control"), "private, no-store");

    const managerRead = await modules.reviewGET(
      await request(fixture.reviewPath, "user-manager-tod"),
      { params }
    );
    assert.equal(managerRead.status, 200);
    const managerReadBody = await managerRead.json();
    assert.equal(managerReadBody.result.reviewerUserId, "user-admin");
    assert.equal(managerReadBody.result.status, "draft");
    assert.equal(managerReadBody.canSubmit, false);
    assert.equal(managerReadBody.error, "审核草稿已由其他用户领取");

    const managerWrite = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-manager-tod", "save_draft"),
      { params }
    );
    assert.equal(managerWrite.status, 409);
    assert.equal(
      (await managerWrite.json()).error,
      "审核草稿已由其他用户领取"
    );

    const finalized = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-admin", "finalize"),
      { params }
    );
    assert.equal(finalized.status, 200);
    const finalRead = await modules.reviewGET(
      await request(fixture.reviewPath, "user-admin"),
      { params }
    );
    assert.equal(finalRead.status, 200);
    const finalReadBody = await finalRead.json();
    assert.equal(finalReadBody.result.status, "passed");
    assert.equal(finalReadBody.canSubmit, false);
    assert.equal(finalReadBody.error, "审核结果已提交");
  });

  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    modules.artifactStore.replaceReviewResult(
      modules.artifactStore.DEFAULT_ARTIFACT_ROOT,
      fixture.documentId,
      fixture.artifactId,
      {
        schemaVersion: 1,
        artifactId: fixture.artifactId,
        reviewerUserId: "user-admin",
        status: "passed",
        items: [],
      }
    );
    const response = await modules.reviewGET(
      await request(fixture.reviewPath, "user-admin"),
      { params: { id: fixture.documentId, artifactId: fixture.artifactId } }
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.canSubmit, false);
    assert.equal(body.error, "审核结果已提交");
  });
});

test("re-reads the review result after awaiting the request body", { concurrency: false }, async () => {
  await withRouteFixture(async (fixture) => {
    const modules = await modulesPromise;
    const params = { id: fixture.documentId, artifactId: fixture.artifactId };
    let notifyBodyRequested!: () => void;
    const bodyRequested = new Promise<void>((resolve) => {
      notifyBodyRequested = resolve;
    });
    let releaseBody!: (body: ReturnType<typeof reviewBody>) => void;
    const delayedBody = new Promise<ReturnType<typeof reviewBody>>((resolve) => {
      releaseBody = resolve;
    });
    const delayedUrl = new URL(fixture.reviewPath, "http://localhost");
    delayedUrl.searchParams.set("userId", "user-manager-tod");
    const delayedRequest = {
      nextUrl: delayedUrl,
      json() {
        notifyBodyRequested();
        return delayedBody;
      },
    };

    const managerWrite = modules.reviewPUT(delayedRequest as never, { params });
    await bodyRequested;

    const adminWrite = await modules.reviewPUT(
      await putRequest(fixture.reviewPath, "user-admin", "save_draft"),
      { params }
    );
    assert.equal(adminWrite.status, 200);

    releaseBody(reviewBody("save_draft"));
    const managerResponse = await managerWrite;
    assert.equal(managerResponse.status, 409);
    assert.equal(
      (await managerResponse.json()).error,
      "审核草稿已由其他用户领取"
    );
    assert.equal(
      modules.artifactStore.loadArtifact(
        modules.artifactStore.DEFAULT_ARTIFACT_ROOT,
        fixture.documentId,
        fixture.artifactId
      ).result.reviewerUserId,
      "user-admin"
    );
  });
});
