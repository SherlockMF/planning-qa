import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/db/documents";
import { listChunksByDocument } from "@/lib/db/chunks";

/** 返回某文档的全部切片，用于"切分查看"页检视分块效果。 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const chunks = await listChunksByDocument(params.id);
  return NextResponse.json({
    document: doc,
    count: chunks.length,
    totalChars: chunks.reduce((s, c) => s + c.content.length, 0),
    // 不回传 embedding（体积大且无展示价值）
    chunks: chunks.map((c) => ({ ...c, embedding: undefined })),
  });
}
