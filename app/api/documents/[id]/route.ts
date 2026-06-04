import { NextRequest, NextResponse } from "next/server";
import { deleteDocument, updateDocument } from "@/lib/db/documents";

/** 切换"是否参与检索"等元数据。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const patch = await req.json().catch(() => ({}));
  const allowed: Record<string, unknown> = {};
  if (typeof patch.enabled === "boolean") allowed.enabled = patch.enabled;

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
