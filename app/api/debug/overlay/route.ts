import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db/store";
import { generateOverlay } from "@/lib/debug/overlayBridge";
import { generateCoordOverlay } from "@/lib/debug/coordOverlay";

// 渲染时间较长，放宽超时
export const maxDuration = 300;

/**
 * 为指定文档生成表格 overlay 调试图（页面 + 表格框 + 单元格网格 PNG）。
 * POST { docId }。输出到 debug/tables/{docId}/overlay/page-N.png。
 * 仅对有原始 PDF 的文档有效（mock/纯文本文档无 raw buffer）。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const docId = body?.docId;
  if (!docId || typeof docId !== "string") {
    return NextResponse.json({ error: "缺少 docId" }, { status: 400 });
  }
  const buf = getStore().rawBuffers[docId];
  if (!buf) {
    return NextResponse.json(
      { error: "该文档无原始 PDF（mock/纯文本文档不支持 overlay）" },
      { status: 404 }
    );
  }
  const extractor = body?.extractor === "coords" ? "coords" : "python";
  const result =
    extractor === "coords"
      ? await generateCoordOverlay(docId, buf)
      : await generateOverlay(docId, buf);
  return NextResponse.json({ extractor, ...result });
}
