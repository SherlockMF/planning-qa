import { NextRequest, NextResponse } from "next/server";
import type { KnowledgeCategory, KnowledgeRoleId, PermissionLevel } from "@/lib/types";
import { deleteDocument, getDocument, updateDocument } from "@/lib/db/documents";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import {
  canManageDocumentInManagement,
  KNOWLEDGE_USERS,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";

/** 切换"是否参与检索"等元数据。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const patch = await req.json().catch(() => ({}));
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const user = resolveDocumentRequestUser(req, patch);
  if (!canManageDocumentInManagement(user, doc)) {
    return NextResponse.json({ error: "当前账号无权管理该文档" }, { status: 403 });
  }

  const allowed: Record<string, unknown> = {};
  if (typeof patch.enabled === "boolean") allowed.enabled = patch.enabled;
  const category =
    typeof patch.category === "string" ? patch.category.trim() : "";
  if (KNOWLEDGE_CATEGORIES.includes(category as KnowledgeCategory)) {
    allowed.category = category;
  }
  if (typeof patch.owner === "string") allowed.owner = patch.owner.trim();
  if (typeof patch.department === "string") {
    allowed.department = patch.department.trim();
  }
  if ([1, 2, 3].includes(Number(patch.permissionLevel))) {
    allowed.permissionLevel = Number(patch.permissionLevel) as PermissionLevel;
  }
  if (typeof patch.projectId === "string") {
    allowed.projectId = patch.projectId.trim() || undefined;
  }
  if (typeof patch.projectName === "string") {
    allowed.projectName = patch.projectName.trim() || undefined;
  }
  if (
    typeof patch.projectOwnerId === "string" &&
    (patch.projectOwnerId === "" ||
      KNOWLEDGE_USERS.some((u) => u.id === patch.projectOwnerId))
  ) {
    allowed.projectOwnerId = patch.projectOwnerId || undefined;
  }
  if (Array.isArray(patch.accessibleUserIds)) {
    const knownUserIds = new Set(KNOWLEDGE_USERS.map((u) => u.id));
    allowed.accessibleUserIds = patch.accessibleUserIds.filter(
      (id: unknown) => typeof id === "string" && knownUserIds.has(id)
    );
  }
  const nextProjectOwnerId =
    Object.prototype.hasOwnProperty.call(allowed, "projectOwnerId")
      ? (allowed.projectOwnerId as string | undefined)
      : doc.projectOwnerId;
  if (nextProjectOwnerId) {
    const ids = new Set(
      Array.isArray(allowed.accessibleUserIds)
        ? (allowed.accessibleUserIds as string[])
        : doc.accessibleUserIds ?? []
    );
    ids.add(nextProjectOwnerId);
    allowed.accessibleUserIds = [...ids];
  }

  const updated = await updateDocument(params.id, allowed);
  if (!updated) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ document: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const user = resolveDocumentRequestUser(req);
  if (!canManageDocumentInManagement(user, doc)) {
    return NextResponse.json({ error: "当前账号无权管理该文档" }, { status: 403 });
  }

  const ok = await deleteDocument(params.id);
  if (!ok) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

function resolveDocumentRequestUser(
  req: NextRequest,
  body?: { userId?: unknown; userRole?: unknown }
) {
  const params = req.nextUrl.searchParams;
  return resolveKnowledgeUser({
    userId:
      (typeof body?.userId === "string" ? body.userId : undefined) ??
      params.get("userId") ??
      undefined,
    userRole:
      ((typeof body?.userRole === "string" ? body.userRole : undefined) ??
        params.get("userRole") ??
        undefined) as KnowledgeRoleId | undefined,
  });
}
