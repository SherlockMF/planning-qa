import { NextRequest, NextResponse } from "next/server";
import type { KnowledgeCategory, PermissionLevel } from "@/lib/types";
import { deleteDocument, updateDocument } from "@/lib/db/documents";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { KNOWLEDGE_USERS } from "@/lib/knowledge/permissions";

/** 切换"是否参与检索"等元数据。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const patch = await req.json().catch(() => ({}));
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

  const updated = await updateDocument(params.id, allowed);
  if (!updated) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ document: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ok = await deleteDocument(params.id);
  if (!ok) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
