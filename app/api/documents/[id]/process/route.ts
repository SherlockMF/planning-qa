import { NextRequest, NextResponse } from "next/server";
import { getDocument, updateDocument } from "@/lib/db/documents";
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
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  await updateDocument(doc.id, { status: "processing" });

  try {
    const buf = getStore().rawBuffers[doc.id];
    let blocks: Block[] | undefined;
    let text: string | undefined;
    let extractedChars = 0;

    if (buf) {
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
