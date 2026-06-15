import { NextRequest, NextResponse } from "next/server";
import type { Document, FileType, KnowledgeCategory } from "@/lib/types";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { ALL_FILE_TYPES } from "@/lib/knowledge/fileTypes";
import { KNOWLEDGE_USERS, resolveKnowledgeUser } from "@/lib/knowledge/permissions";
import { createDocument } from "@/lib/db/documents";
import { getStore } from "@/lib/db/store";
import { saveRawBuffer } from "@/lib/db/persist";
import { getUploadFiles } from "@/lib/documents/uploadForm";

const VALID_TYPES: FileType[] = ALL_FILE_TYPES;

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
  const categoryRaw = (form.get("category") as string | null)?.trim();
  const owner = (form.get("owner") as string | null)?.trim() || undefined;
  const department =
    (form.get("department") as string | null)?.trim() || undefined;
  const permissionLevelRaw = Number(form.get("permissionLevel") ?? 1);
  const projectId = (form.get("projectId") as string | null)?.trim() || undefined;
  const projectName =
    (form.get("projectName") as string | null)?.trim() || undefined;
  const projectOwnerIdRaw =
    (form.get("projectOwnerId") as string | null)?.trim() || undefined;
  const currentUser = resolveKnowledgeUser({
    userId: (form.get("userId") as string | null)?.trim() || undefined,
  });
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
  const categoryCandidate = categoryRaw ?? "";
  const category = KNOWLEDGE_CATEGORIES.includes(
    categoryCandidate as KnowledgeCategory
  )
    ? (categoryCandidate as KnowledgeCategory)
    : undefined;
  const permissionLevel =
    permissionLevelRaw === 2 || permissionLevelRaw === 3 ? permissionLevelRaw : 1;
  const projectOwnerId =
    projectOwnerIdRaw && KNOWLEDGE_USERS.some((u) => u.id === projectOwnerIdRaw)
      ? projectOwnerIdRaw
      : currentUser.role === "project_manager"
      ? currentUser.id
      : undefined;

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
      category,
      owner: owner ?? currentUser.name,
      department: department ?? currentUser.department,
      permissionLevel,
      projectId,
      projectName,
      projectOwnerId,
      accessibleUserIds: projectOwnerId ? [projectOwnerId] : undefined,
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
