// ============================================================================
// 文档数据访问层
// ============================================================================

import type { Document, FileType } from "@/lib/types";
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
    enabled: true,
    status: "pending",
    createdAt: new Date().toISOString(),
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
