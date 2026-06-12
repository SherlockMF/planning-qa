// ============================================================================
// 磁盘持久化（MVP）
// ----------------------------------------------------------------------------
// 把内存 store 落盘到 .data/ 目录，使文档 / 切片 / 向量 / 评测在服务重启后不丢失。
//   .data/documents.json   文档元数据
//   .data/chunks.json      切片（含 embedding）
//   .data/evaluation.json  评测题库
//   .data/raw/<docId>      上传文件原始二进制（供重新解析）
// 接入真实 DB 后可整体替换为数据库读写；上层接口不变。
// ============================================================================

import fs from "fs";
import path from "path";
import type { Chunk, Document, EvaluationItem, RagTable } from "@/lib/types";
import { getEmbeddingProvider } from "../ai/embedding.ts";

const DATA_DIR = path.join(process.cwd(), ".data");
const RAW_DIR = path.join(DATA_DIR, "raw");
const DOCS_FILE = path.join(DATA_DIR, "documents.json");
const CHUNKS_FILE = path.join(DATA_DIR, "chunks.json");
const RAGTABLES_FILE = path.join(DATA_DIR, "ragtables.json");
const EVAL_FILE = path.join(DATA_DIR, "evaluation.json");
const SCHEMA_FILE = path.join(DATA_DIR, "schema.json");

/**
 * Chunk 数据结构版本。
 *   v2：结构化重构（带 chunkType 等字段）。
 *   v3：表格一级对象 RagTable + chunk.rowId 绑定（P0 表格 RAG 闭环）。
 * 落盘 chunks 若版本低于此值，loadFromDisk 视为失效（不加载旧 chunk），
 * 由上层重新解析/重新播种，以保证 rowId 与 RagTable 一致。
 */
export const SCHEMA_VERSION = 3;

function ensureDirs() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

interface SchemaInfo {
  version: number;
  /** 写入 chunks 时使用的 embedding 提供方指纹（provider:model）。 */
  embedding?: string;
}

function readSchemaInfo(): SchemaInfo {
  try {
    if (!fs.existsSync(SCHEMA_FILE)) return { version: 1 }; // 无版本文件 → 旧数据
    const j = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));
    return {
      version: typeof j.version === "number" ? j.version : 1,
      embedding: typeof j.embedding === "string" ? j.embedding : undefined,
    };
  } catch {
    return { version: 1 };
  }
}

function writeSchemaVersion() {
  try {
    ensureDirs();
    fs.writeFileSync(
      SCHEMA_FILE,
      JSON.stringify({
        version: SCHEMA_VERSION,
        embedding: getEmbeddingProvider().signature,
      })
    );
  } catch (e) {
    console.error("[persist] writeSchemaVersion failed:", e);
  }
}

export interface PersistedData {
  documents: Document[];
  chunks: Chunk[];
  ragTables: RagTable[];
  evaluation: EvaluationItem[];
  rawBuffers: Record<string, Buffer>;
  /** 落盘 chunk 结构已过期（版本不匹配）→ 上层应清空 chunks 并提示重新解析。 */
  schemaStale: boolean;
}

/** 磁盘上是否已有持久化数据。 */
export function hasPersisted(): boolean {
  try {
    return fs.existsSync(DOCS_FILE);
  } catch {
    return false;
  }
}

/** 从磁盘加载全部数据；无数据或失败返回 null。 */
export function loadFromDisk(): PersistedData | null {
  try {
    if (!fs.existsSync(DOCS_FILE)) return null;
    const documents: Document[] = JSON.parse(
      fs.readFileSync(DOCS_FILE, "utf8")
    );

    const info = readSchemaInfo();
    // 结构版本过期，或 embedding 提供方/模型已切换（向量维度/语义空间不再兼容，
    // cosine 相似度会静默归零）→ 都视为 chunk 失效，走重建流程。
    // 旧数据无 embedding 字段时不判失效（无从比较），下次落盘补记指纹。
    const currentEmbedding = getEmbeddingProvider().signature;
    const embeddingStale =
      info.embedding != null && info.embedding !== currentEmbedding;
    if (embeddingStale) {
      console.warn(
        `[persist] embedding 提供方已切换（${info.embedding} → ${currentEmbedding}），` +
          "已落盘的向量失效，将重建索引（上传文档需重新解析）"
      );
    }
    const schemaStale = info.version < SCHEMA_VERSION || embeddingStale;

    // 版本过期：丢弃旧扁平 chunk（不加载），由上层重新解析/重新播种
    const chunks: Chunk[] =
      !schemaStale && fs.existsSync(CHUNKS_FILE)
        ? JSON.parse(fs.readFileSync(CHUNKS_FILE, "utf8"))
        : [];

    const ragTables: RagTable[] =
      !schemaStale && fs.existsSync(RAGTABLES_FILE)
        ? JSON.parse(fs.readFileSync(RAGTABLES_FILE, "utf8"))
        : [];

    const evaluation: EvaluationItem[] = fs.existsSync(EVAL_FILE)
      ? JSON.parse(fs.readFileSync(EVAL_FILE, "utf8"))
      : [];

    const rawBuffers: Record<string, Buffer> = {};
    if (fs.existsSync(RAW_DIR)) {
      for (const f of fs.readdirSync(RAW_DIR)) {
        rawBuffers[f] = fs.readFileSync(path.join(RAW_DIR, f));
      }
    }
    return { documents, chunks, ragTables, evaluation, rawBuffers, schemaStale };
  } catch (e) {
    console.error("[persist] loadFromDisk failed:", e);
    return null;
  }
}

export function saveDocuments(documents: Document[]) {
  try {
    ensureDirs();
    fs.writeFileSync(DOCS_FILE, JSON.stringify(documents));
  } catch (e) {
    console.error("[persist] saveDocuments failed:", e);
  }
}

export function saveChunks(chunks: Chunk[]) {
  try {
    ensureDirs();
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunks));
    writeSchemaVersion(); // 落盘时标记当前结构版本
  } catch (e) {
    console.error("[persist] saveChunks failed:", e);
  }
}

export function saveRagTables(ragTables: RagTable[]) {
  try {
    ensureDirs();
    fs.writeFileSync(RAGTABLES_FILE, JSON.stringify(ragTables));
  } catch (e) {
    console.error("[persist] saveRagTables failed:", e);
  }
}

export function saveEvaluationFile(evaluation: EvaluationItem[]) {
  try {
    ensureDirs();
    fs.writeFileSync(EVAL_FILE, JSON.stringify(evaluation));
  } catch (e) {
    console.error("[persist] saveEvaluation failed:", e);
  }
}

export function saveRawBuffer(id: string, buf: Buffer) {
  try {
    ensureDirs();
    fs.writeFileSync(path.join(RAW_DIR, id), buf);
  } catch (e) {
    console.error("[persist] saveRawBuffer failed:", e);
  }
}

export function deleteRawBuffer(id: string) {
  try {
    const p = path.join(RAW_DIR, id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error("[persist] deleteRawBuffer failed:", e);
  }
}
