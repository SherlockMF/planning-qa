import type { Document, KnowledgeUser } from "../types.ts";
import type { ReprocessPreparation } from "./tableReprocess.ts";

export interface TableReprocessApiDependencies {
  getDocument(id: string): Promise<Document | undefined>;
  getSourceBuffer(id: string): Buffer | undefined;
  resolveUser(userId?: string): KnowledgeUser;
  canManage(user: KnowledgeUser, document: Document): boolean;
  prepare(
    document: Document,
    source: Buffer,
    stagingId?: string
  ): Promise<ReprocessPreparation>;
  get(
    docId: string,
    stagingId: string
  ): ReprocessPreparation;
  publish(
    document: Document,
    source: Buffer,
    stagingId: string
  ): Promise<
    | ReprocessPreparation
    | { status: "conflict"; reason: string }
  >;
}

export async function prepareTableReprocessRequest(
  input: { docId: string; userId?: string; stagingId?: string },
  dependencies: TableReprocessApiDependencies
): Promise<{ status: number; body: unknown }> {
  const access = await resolveAccess(input, dependencies);
  if ("response" in access) return access.response;
  const source = dependencies.getSourceBuffer(input.docId);
  if (!source) return { status: 404, body: { error: "原始文件不存在" } };
  const prepared = await dependencies.prepare(
    access.document,
    source,
    input.stagingId
  );
  return {
    status: prepared.status === "failed" ? 500 : 200,
    body: { reprocess: prepared },
  };
}

export async function getTableReprocessRequest(
  input: { docId: string; userId?: string; stagingId: string },
  dependencies: TableReprocessApiDependencies
): Promise<{ status: number; body: unknown }> {
  const access = await resolveAccess(input, dependencies);
  if ("response" in access) return access.response;
  try {
    return {
      status: 200,
      body: { reprocess: dependencies.get(input.docId, input.stagingId) },
    };
  } catch (error) {
    if (String(error).includes("not_found")) {
      return { status: 404, body: { error: "重处理版本不存在" } };
    }
    throw error;
  }
}

export async function publishTableReprocessRequest(
  input: { docId: string; userId?: string; stagingId: string },
  dependencies: TableReprocessApiDependencies
): Promise<{ status: number; body: unknown }> {
  const access = await resolveAccess(input, dependencies);
  if ("response" in access) return access.response;
  const source = dependencies.getSourceBuffer(input.docId);
  if (!source) return { status: 404, body: { error: "原始文件不存在" } };
  try {
    const result = await dependencies.publish(
      access.document,
      source,
      input.stagingId
    );
    if (result.status === "conflict") {
      return { status: 409, body: { error: result.reason } };
    }
    return { status: 200, body: { reprocess: result } };
  } catch (error) {
    if (String(error).includes("not_found")) {
      return { status: 404, body: { error: "重处理版本不存在" } };
    }
    throw error;
  }
}

async function resolveAccess(
  input: { docId: string; userId?: string },
  dependencies: TableReprocessApiDependencies
): Promise<
  | { document: Document }
  | { response: { status: number; body: unknown } }
> {
  const document = await dependencies.getDocument(input.docId);
  if (!document) {
    return { response: { status: 404, body: { error: "文档不存在" } } };
  }
  const user = dependencies.resolveUser(input.userId);
  if (!dependencies.canManage(user, document)) {
    return {
      response: { status: 403, body: { error: "当前账号无权管理该文档" } },
    };
  }
  return { document };
}
