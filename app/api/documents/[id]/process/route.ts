import { NextRequest, NextResponse } from "next/server";
import { getDocument, updateDocument } from "@/lib/db/documents";
import {
  canManageDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";
import { processDocument } from "@/lib/db/chunks";
import { getStore } from "@/lib/db/store";
import { extractText } from "@/lib/parse/extractText";
import { extractBlocksWithTables } from "@/lib/parse/tablesSidecar";
import type { Block } from "@/lib/types";

// 文本提取与 embedding 可能较慢，放宽超时
export const maxDuration = 300;

/**
 * 解析文档：
 *  - PDF → IR（Block[]）→ 文档画像 → 结构化切片；
 *  - DOCX/TXT/MD → 纯文本 → 同一编排器切片。
 * 再生成 embedding → 入库。
 */
export async function POST(
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
  if (!canManageDocumentInManagement(user, doc)) {
    return NextResponse.json({ error: "当前账号无权管理该文档" }, { status: 403 });
  }

  await updateDocument(doc.id, { status: "processing" });

  try {
    const buf = getStore().rawBuffers[doc.id];
    if (!buf) {
      // 内置演示/种子文档没有原始文件，但带预置切片。对它们点"处理"不应标失败、
      // 踢出检索 —— 检测到已有切片则保持 indexed 并提示无需解析。
      const hasChunks = getStore().chunks.some((c) => c.documentId === doc.id);
      if (hasChunks) {
        await updateDocument(doc.id, { status: "indexed" });
        return NextResponse.json(
          { skipped: true, message: "该文档为内置演示文档，已预置切片，无需重新解析。" },
          { status: 200 }
        );
      }
      // 真正缺内容的上传文档：以前会落"占位 chunk"误导用户，改为明确失败。
      await updateDocument(doc.id, { status: "failed" });
      return NextResponse.json(
        { error: "原始文件缺失，无法解析。请删除该记录后重新上传文件。" },
        { status: 400 }
      );
    }

    let blocks: Block[] | undefined;
    let text: string | undefined;
    let extractedChars = 0;

    if (doc.fileName.toLowerCase().endsWith(".pdf")) {
      blocks = await extractBlocksWithTables(buf);
      extractedChars = blocks.reduce(
        (s, b) => s + b.normalizedText.length,
        0
      );
    } else {
      text = await extractText(buf, doc.fileName);
      extractedChars = text.length;
    }

    const count = await processDocument(doc, { blocks, text });
    const updated = await updateDocument(doc.id, { status: "indexed" });
    return NextResponse.json({
      document: updated,
      chunkCount: count,
      extractedChars,
    });
  } catch (err) {
    await updateDocument(doc.id, { status: "failed" });
    return NextResponse.json(
      { error: "处理失败", detail: String(err) },
      { status: 500 }
    );
  }
}
