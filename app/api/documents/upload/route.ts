import { NextRequest, NextResponse } from "next/server";
import type { Document, FileType } from "@/lib/types";
import { createDocument } from "@/lib/db/documents";
import { getStore } from "@/lib/db/store";
import { saveRawBuffer } from "@/lib/db/persist";
import { getUploadFiles } from "@/lib/documents/uploadForm";

const VALID_TYPES: FileType[] = [
  "技术规定",
  "用地分类",
  "控规导则",
  "停车标准",
  "公共服务设施标准",
  "其他",
];

/**
 * 上传文档并保存元数据。
 * 接受 multipart/form-data：file（可多个）, city, fileType。
 * 保存原始文件二进制，正文提取与切片在 /process 阶段完成（PDF/DOCX/TXT/MD 均支持）。
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "请使用 multipart/form-data 上传" },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const files = getUploadFiles(form);
  const city = (form.get("city") as string | null)?.trim();
  const fileTypeRaw = (form.get("fileType") as string | null)?.trim();
  const effectiveDateRaw = (form.get("effectiveDate") as string | null)?.trim();
  // 仅接受 YYYY-MM-DD；格式不对静默忽略（可选字段）
  const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDateRaw ?? "")
    ? effectiveDateRaw!
    : undefined;

  if (files.length === 0) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (!city) {
    return NextResponse.json({ error: "缺少城市" }, { status: 400 });
  }
  const fileType = (
    VALID_TYPES.includes(fileTypeRaw as FileType) ? fileTypeRaw : "其他"
  ) as FileType;

  const documents: Document[] = [];
  const failed: string[] = [];

  for (const file of files) {
    // 先读二进制再建档：读取失败时不留下"已登记却无内容"的空文档
    let buf: Buffer;
    try {
      buf = Buffer.from(await file.arrayBuffer());
    } catch {
      failed.push(file.name);
      continue;
    }

    const doc = await createDocument({
      fileName: file.name,
      city,
      fileType,
      effectiveDate,
    });
    getStore().rawBuffers[doc.id] = buf;
    saveRawBuffer(doc.id, buf);
    documents.push(doc);
  }

  if (documents.length === 0) {
    return NextResponse.json(
      { error: `读取文件内容失败：${failed.join("、")}` },
      { status: 400 }
    );
  }

  return NextResponse.json({
    document: documents[0],
    documents,
    ...(failed.length > 0 ? { failed } : {}),
  });
}
