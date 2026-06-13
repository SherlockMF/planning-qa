// ============================================================================
// 文档数据访问层
// ============================================================================

import type { Document, FileType } from "@/lib/types";
import { categoryFromFileType } from "@/lib/knowledge/categories";
import { ensureSeeded, getStore } from "./store";
import {
  deleteRawBuffer,
  saveChunks,
  saveDocuments,
} from "./persist";

export async function listDocuments(): Promise<Document[]> {
  await ensureSeeded();
  return [...getStore().documents].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function getDocument(id: string): Promise<Document | undefined> {
  await ensureSeeded();
  return getStore().documents.find((d) => d.id === id);
}

export interface CreateDocumentInput {
  fileName: string;
  city: string;
  fileType: FileType;
  category?: Document["category"];
  owner?: string;
  department?: string;
  permissionLevel?: Document["permissionLevel"];
  projectId?: string;
  projectName?: string;
  projectOwnerId?: string;
  /** 文件生效日期（YYYY-MM-DD），可手动填写，用于多版本优先级判断 */
  effectiveDate?: string;
}

export async function createDocument(
  input: CreateDocumentInput
): Promise<Document> {
  await ensureSeeded();
  const doc: Document = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: input.fileName,
    city: input.city,
    fileType: input.fileType,
    category: input.category ?? categoryFromFileType(input.fileType),
    owner: input.owner ?? "知识库管理员",
    department: input.department ?? "知识管理部",
    permissionLevel: input.permissionLevel ?? 1,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectName ? { projectName: input.projectName } : {}),
    ...(input.projectOwnerId ? { projectOwnerId: input.projectOwnerId } : {}),
    enabled: true,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...(input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}),
  };
  getStore().documents.unshift(doc);
  saveDocuments(getStore().documents);
  return doc;
}

export async function updateDocument(
  id: string,
  patch: Partial<Document>
): Promise<Document | undefined> {
  await ensureSeeded();
  const doc = getStore().documents.find((d) => d.id === id);
  if (!doc) return undefined;
  Object.assign(doc, patch);
  saveDocuments(getStore().documents);
  return doc;
}

export async function deleteDocument(id: string): Promise<boolean> {
  await ensureSeeded();
  const store = getStore();
  const idx = store.documents.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  store.documents.splice(idx, 1);
  // 级联删除其 chunks
  store.chunks = store.chunks.filter((c) => c.documentId !== id);
  delete store.rawBuffers[id];
  saveDocuments(store.documents);
  saveChunks(store.chunks);
  deleteRawBuffer(id);
  return true;
}
