// ============================================================================
// Chunk 数据访问层
// ============================================================================

import type { Block, Chunk, Document } from "@/lib/types";
import { cityMatches } from "../city.ts";
import { ensureSeeded, getStore } from "./store";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import {
  buildChunksWithObjects,
  type DraftChunk,
} from "@/lib/rag/chunk";
import { buildRagTablesFromChunks, buildRagTablesFromObjects } from "@/lib/rag/ragTable";
import { replaceRagTablesForDoc } from "./ragTables";
import { saveChunks } from "./persist";
import { writeAllTableDebug, tableDebugEnabled } from "@/lib/debug/tableDebug";
import { writeRagPipelineDebug } from "@/lib/rag/debug";

/** 仅返回参与检索（enabled 且 indexed）文档对应的 chunks。 */
export async function listSearchableChunks(city?: string): Promise<Chunk[]> {
  await ensureSeeded();
  const store = getStore();
  const enabledDocIds = new Set(
    store.documents
      .filter((d) => d.enabled && d.status === "indexed")
      .map((d) => d.id)
  );
  return store.chunks.filter((c) => {
    if (!enabledDocIds.has(c.documentId)) return false;
    // 归一化匹配（"北京"="北京市"），"未知/通用"城市的文档对任何查询可见
    if (!cityMatches(c.city, city)) return false;
    return true;
  });
}

export async function listChunksByDocument(
  documentId: string
): Promise<Chunk[]> {
  await ensureSeeded();
  return getStore().chunks.filter((c) => c.documentId === documentId);
}

/**
 * 处理文档：结构化切片 + 生成 embedding + 入库。
 * 入参 input 提供 blocks（PDF IR）或 text（DOCX/TXT/MD）；都没有则生成占位 chunk。
 */
export async function processDocument(
  doc: Document,
  input: { blocks?: Block[]; text?: string } = {}
): Promise<number> {
  await ensureSeeded();
  const store = getStore();

  // 移除该文档旧 chunks（支持重新解析）
  store.chunks = store.chunks.filter((c) => c.documentId !== doc.id);

  const buildResult = buildChunksWithObjects(doc, input);
  const drafts: DraftChunk[] = buildResult.drafts;
  if (drafts.length === 0) {
    // 不再落占位 chunk 假装成功：零内容意味着提取/切片失败，
    // 让 /process 路由捕获后把文档标为 failed，用户可见可重试。
    throw new Error(
      "未能从文档中提取到任何内容（可能为扫描件、加密文件或不支持的格式）"
    );
  }

  const embedder = getEmbeddingProvider();
  // 检索文本融合：章节路径 + 条款/表名 + 正文，提升召回
  const embeddings = await embedder.embedBatch(
    drafts.map(
      (p) =>
        p.embeddingText ?? `${p.sectionPath ?? ""} ${p.clauseNo ?? ""} ${p.tableTitle ?? ""} ${p.content}`
    )
  );

  const chunks: Chunk[] = drafts.map((p, i) => ({
    ...p,
    fileName: doc.fileName,
    city: doc.city,
    embedding: embeddings[i],
    createdAt: new Date().toISOString(),
    // 向后兼容派生字段（旧 UI/检索仍读 articleNo/pageNumber）
    articleNo: p.clauseNo ?? p.tableTitle,
    pageNumber: p.pageStart,
    // 手动填写的生效日期兜底注入版本信息（文本中解析到的日期优先），
    // 供 rerank 版本优先级与 LLM 多版本规则使用
    versionInfo:
      doc.effectiveDate && !p.versionInfo?.effectiveDate
        ? { ...(p.versionInfo ?? {}), effectiveDate: doc.effectiveDate }
        : p.versionInfo,
  }));

  // 表格一级对象：从本文档 chunk 合成 RagTable，并就地回填 chunk.rowId/tableType。
  // 必须在 saveChunks 之前，使落盘的 chunk 已带 rowId（与 RagTable 绑定一致）。
  const docTitle = doc.fileName.replace(/\.(pdf|docx|txt|md)$/i, "");
  let ragTables = buildRagTablesFromObjects(buildResult.knowledgeObjects, docTitle, chunks);
  if (!ragTables.length) {
    ragTables = buildRagTablesFromChunks(chunks, () => docTitle);
  }

  store.chunks.push(...chunks);
  saveChunks(store.chunks);
  replaceRagTablesForDoc(doc.id, ragTables);

  // 调试输出：每张表 json/html/txt，供人工定位错列漏行（DEBUG_TABLES=0 关闭）
  if (tableDebugEnabled() && ragTables.length) {
    try {
      writeAllTableDebug(ragTables);
    } catch (e) {
      console.error("[processDocument] table debug write failed:", e);
    }
  }
  try {
    writeRagPipelineDebug({
      docId: doc.id,
      blocks: buildResult.blocks,
      cleanedBlocks: buildResult.cleanedBlocks,
      profile: buildResult.profile,
      sectionTree: buildResult.sectionTree,
      knowledgeObjects: buildResult.knowledgeObjects,
      retrievalChunks: drafts,
      versionInfo: buildResult.versionInfo,
      warnings: [
        ...buildResult.warnings,
        ...(buildResult.fallbackUsed ? ["fallback_to_legacy_chunkBlocks"] : []),
      ],
    });
  } catch (e) {
    console.error("[processDocument] rag debug write failed:", e);
  }
  return chunks.length;
}
