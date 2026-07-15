import { createHash } from "node:crypto";

import {
  assertSafeIdentifier,
  createArtifactStore,
  listArtifactSummaries,
  readArtifact,
  type ArtifactStore,
} from "../../../../../lib/audit/artifactStore.ts";
import {
  createReviewRound,
  finalizeReviewRound,
  saveReviewDraft,
} from "../../../../../lib/audit/reviewRounds.ts";
import type {
  HumanReviewItem,
  HumanReviewRound,
} from "../../../../../lib/audit/types.ts";
import type { Document } from "../../../../../lib/types.ts";

type ArtifactParams = { id: string; artifactId: string };
type ReviewParams = ArtifactParams & { reviewId: string };

export interface ReviewArtifactApiDependencies {
  artifactRoot?: string;
  getDocument: (id: string) => Promise<Document | undefined>;
  resolveUserId: (request: Request) => string;
  canManage: (userId: string, document: Document) => boolean;
  getSourceBuffer: (docId: string) => Buffer | undefined;
  now?: () => string;
  createReviewId?: () => string;
}

export interface ReviewArtifactApi {
  listArtifacts(request: Request, params: { id: string }): Promise<Response>;
  readArtifact(request: Request, params: ArtifactParams): Promise<Response>;
  listReviews(request: Request, params: ArtifactParams): Promise<Response>;
  createReview(request: Request, params: ArtifactParams): Promise<Response>;
  readReview(request: Request, params: ReviewParams): Promise<Response>;
  updateReview(request: Request, params: ReviewParams): Promise<Response>;
}

export function createReviewArtifactApi(
  dependencies: ReviewArtifactApiDependencies,
): ReviewArtifactApi {
  async function access(request: Request, docId: string) {
    assertSafeIdentifier(docId);
    const document = await dependencies.getDocument(docId);
    if (!document) throw new ApiError(404, "文档不存在");
    const userId = dependencies.resolveUserId(request);
    if (!dependencies.canManage(userId, document)) {
      throw new ApiError(403, "当前账号无权管理该文档");
    }
    return {
      document,
      userId,
      store: createArtifactStore({
        rootDir: dependencies.artifactRoot,
        docId,
        now: dependencies.now,
        createReviewId: dependencies.createReviewId,
      }),
    };
  }

  async function loadIntactArtifact(store: ArtifactStore, artifactId: string) {
    assertSafeIdentifier(artifactId);
    const artifact = await readArtifact(store, artifactId);
    if (!artifact.integrity.ok) {
      throw new ApiError(409, "审核产物完整性校验失败", {
        invalidFiles: artifact.integrity.invalidFiles,
      });
    }
    return artifact;
  }

  async function requireCurrentSource(store: ArtifactStore, artifactId: string) {
    const artifact = await loadIntactArtifact(store, artifactId);
    const source = dependencies.getSourceBuffer(store.docId);
    const actualHash = source ? createHash("sha256").update(source).digest("hex") : undefined;
    if (!actualHash || actualHash !== artifact.manifest.sourceFileSha256) {
      throw new ApiError(409, "当前原文件与审核快照不一致，不能提交新的审核结果");
    }
    return artifact;
  }

  return {
    async listArtifacts(request, params) {
      return respond(async () => {
        const { store } = await access(request, params.id);
        return json({ artifacts: await listArtifactSummaries(store) });
      });
    },

    async readArtifact(request, params) {
      return respond(async () => {
        const { store } = await access(request, params.id);
        const artifact = await loadIntactArtifact(store, params.artifactId);
        const format = new URL(request.url).searchParams.get("format") ?? "manifest";
        if (!(["manifest", "auto-review", "html", "markdown"] as const).includes(format as never)) {
          throw new ApiError(400, "审核产物格式无效");
        }
        if (format === "html") {
          return new Response(artifact.reviewHtml, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        if (format === "markdown") {
          return new Response(artifact.reviewMarkdown, {
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          });
        }
        return json(format === "auto-review"
          ? { autoReview: artifact.autoReview, integrity: artifact.integrity }
          : { manifest: artifact.manifest, integrity: artifact.integrity });
      });
    },

    async listReviews(request, params) {
      return respond(async () => {
        const { store } = await access(request, params.id);
        const artifact = await loadIntactArtifact(store, params.artifactId);
        return json({ reviews: artifact.reviewRounds });
      });
    },

    async createReview(request, params) {
      return respond(async () => {
        const { store, userId } = await access(request, params.id);
        const artifact = await requireCurrentSource(store, params.artifactId);
        const body = await readBody(request);
        const parentReviewId = optionalString(body.parentReviewId);
        if (artifact.reviewRounds.length === 0) {
          if (parentReviewId) throw new ApiError(400, "首轮审核不能指定父轮次");
        } else {
          if (!parentReviewId) throw new ApiError(400, "发起复审必须指定已提交的父轮次");
          const parent = artifact.reviewRounds.find((round) => round.reviewId === parentReviewId);
          if (!parent) throw new ApiError(400, "父审核轮次不属于当前产物");
          if (!parent.finalizedAt) throw new ApiError(400, "只能基于已提交轮次发起复审");
        }
        const review = await createReviewRound(store, params.artifactId, userId, parentReviewId);
        return json({ review }, 201);
      });
    },

    async readReview(request, params) {
      return respond(async () => {
        assertSafeIdentifier(params.reviewId);
        const { store } = await access(request, params.id);
        const artifact = await loadIntactArtifact(store, params.artifactId);
        const review = artifact.reviewRounds.find((round) => round.reviewId === params.reviewId);
        if (!review) throw new ApiError(404, "审核轮次不存在");
        return json({ review });
      });
    },

    async updateReview(request, params) {
      return respond(async () => {
        assertSafeIdentifier(params.reviewId);
        const { store, userId } = await access(request, params.id);
        await requireCurrentSource(store, params.artifactId);
        const body = await readBody(request);
        if (body.action !== "save_draft" && body.action !== "finalize") {
          throw new ApiError(400, "审核操作无效");
        }
        if (!Array.isArray(body.items)) throw new ApiError(400, "审核项格式无效");
        const items = body.items as HumanReviewItem[];
        const review = body.action === "save_draft"
          ? await saveReviewDraft(store, params.artifactId, params.reviewId, userId, items)
          : await finalizeReviewRound(store, params.artifactId, params.reviewId, userId, items);
        return json({ review });
      });
    },
  };
}

let defaultApi: Promise<ReviewArtifactApi> | undefined;

export function getReviewArtifactApi(): Promise<ReviewArtifactApi> {
  defaultApi ??= createDefaultReviewArtifactApi();
  return defaultApi;
}

async function createDefaultReviewArtifactApi(): Promise<ReviewArtifactApi> {
  const [{ getDocument }, { getStore }, permissions] = await Promise.all([
    import("../../../../../lib/db/documents.ts"),
    import("../../../../../lib/db/store.ts"),
    import("../../../../../lib/knowledge/permissions.ts"),
  ]);
  return createReviewArtifactApi({
    getDocument,
    resolveUserId: (request) => permissions.resolveKnowledgeUser({
      userId: new URL(request.url).searchParams.get("userId") ?? undefined,
    }).id,
    canManage: (userId, document) => permissions.canManageDocumentInManagement(
      permissions.resolveKnowledgeUser({ userId }),
      document,
    ),
    getSourceBuffer: (docId) => getStore().rawBuffers[docId],
  });
}

class ApiError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function respond(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...error.details }, error.status);
    const code = error instanceof Error ? error.message : String(error);
    if (code === "invalid_identifier" || code === "unsafe_artifact_path") {
      return json({ error: "审核路径参数无效" }, 400);
    }
    if (code.includes("ENOENT") || code === "review_not_found") {
      return json({ error: "审核产物或轮次不存在" }, 404);
    }
    if (
      code === "artifact_integrity_failed"
      || code === "review_finalized"
      || code === "review_owned_by_another_user"
      || code === "review_already_exists"
    ) {
      return json({ error: "审核状态冲突，不能执行当前操作" }, 409);
    }
    if (
      code === "required_items_incomplete"
      || code === "invalid_audit_item"
      || code === "issue_details_required"
      || code === "review_comment_too_long"
      || code === "reviewer_required"
      || code === "parent_review_not_found"
      || code === "parent_review_not_finalized"
    ) {
      return json({ error: "审核内容不完整或不合法", detail: code }, 400);
    }
    console.error("[audit-review-api]", error);
    return json({ error: "审核服务暂时不可用" }, 500);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "请求内容无效");
  }
  return body as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export type { HumanReviewRound };
