import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/db/documents";
import { getStore } from "@/lib/db/store";
import { resolveKnowledgeUser, canAccessDocument } from "@/lib/knowledge/permissions";
import { renderDocPage } from "@/lib/debug/pageImage";

// 渲染可能较慢（首次），放宽超时
export const maxDuration = 120;

/**
 * 渲染并返回文档某页的真实 PDF 页面 PNG（用于「引用原文」展示原始页面）。
 * GET ?n=<页码,1-based>&userId=<模拟账号>&dpi=<可选>
 * 权限：与检索一致（canAccessDocument）；无原始 PDF（mock/纯文本/种子文档）返回 404。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const user = resolveKnowledgeUser({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
  });
  if (!canAccessDocument(user, doc)) {
    return NextResponse.json({ error: "当前账号无权访问该文档" }, { status: 403 });
  }

  const pageNo = Number(req.nextUrl.searchParams.get("n") ?? "1");
  if (!Number.isInteger(pageNo) || pageNo < 1) {
    return NextResponse.json({ error: "页码无效" }, { status: 400 });
  }
  const dpiRaw = Number(req.nextUrl.searchParams.get("dpi") ?? "150");
  const dpi = Number.isFinite(dpiRaw) ? Math.min(220, Math.max(72, dpiRaw)) : 150;

  const buf = getStore().rawBuffers[doc.id];
  if (!buf) {
    return NextResponse.json(
      { error: "该文档无原始 PDF（演示/纯文本文档不支持页面预览）" },
      { status: 404 }
    );
  }

  const result = await renderDocPage(doc.id, buf, pageNo, dpi);
  if (result.error || !result.pngPath) {
    return NextResponse.json(
      { error: result.error ?? "渲染失败" },
      { status: 422 }
    );
  }

  const fs = await import("fs");
  const png = fs.readFileSync(result.pngPath);
  return new NextResponse(png, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
