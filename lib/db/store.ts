// ============================================================================
// 内存数据存储（MVP）
// ----------------------------------------------------------------------------
// 使用进程级单例保存 documents / chunks / evaluation。开发服务器为单进程，
// 数据在请求间持久；HMR 时通过挂载到 globalThis 避免重复播种。
// 接入真实 DB（Supabase / PostgreSQL + pgvector）时，替换 lib/db/* 各模块的
// 读写实现即可，上层接口保持不变。
// ============================================================================

import type { Chunk, Document, EvaluationItem, RagTable } from "@/lib/types";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { buildRagTablesFromChunks } from "@/lib/rag/ragTable";
import { MOCK_CHUNKS, MOCK_DOCUMENTS } from "./mockData";
import { MOCK_EVALUATION } from "./mockEvaluation";
import {
  loadFromDisk,
  saveChunks,
  saveDocuments,
  saveEvaluationFile,
  saveRagTables,
} from "./persist";

interface DataStore {
  documents: Document[];
  chunks: Chunk[];
  /** 表格一级对象（最终展示与结构化回查的数据源）。 */
  ragTables: RagTable[];
  evaluation: EvaluationItem[];
  /** 上传文档的原始二进制内容（按 documentId 索引），供处理时提取文本与切片。 */
  rawBuffers: Record<string, Buffer>;
  seeded: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __PLANNING_QA_STORE__: DataStore | undefined;
}

function createStore(): DataStore {
  return {
    documents: [],
    chunks: [],
    ragTables: [],
    evaluation: [],
    rawBuffers: {},
    seeded: false,
  };
}

/** 从当前 store.documents 解析文档标题（供 RagTable.docTitle 兜底）。 */
function docTitleResolver(): (documentId: string) => string {
  return (id) => {
    const doc = store.documents.find((d) => d.id === id);
    return doc ? doc.fileName.replace(/\.(pdf|docx|txt|md)$/i, "") : id;
  };
}

const store: DataStore =
  globalThis.__PLANNING_QA_STORE__ ?? (globalThis.__PLANNING_QA_STORE__ = createStore());

let seedPromise: Promise<void> | null = null;

/** 确保 mock 数据已播种（含 chunk embedding 计算）。幂等。 */
export async function ensureSeeded(): Promise<void> {
  if (store.seeded) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    // 1. 优先从磁盘恢复（服务重启后数据不丢）
    const persisted = loadFromDisk();
    if (persisted) {
      store.documents = persisted.documents;
      store.evaluation =
        persisted.evaluation.length > 0
          ? persisted.evaluation
          : MOCK_EVALUATION.map((e) => ({ ...e }));
      store.rawBuffers = persisted.rawBuffers;

      if (persisted.schemaStale) {
        // chunk 结构已升级：旧 chunk 作废。
        //  - 重新播种内置 mock chunk（保证 demo 可用）；
        //  - 从 mock chunk 合成 RagTable 并回填 rowId；
        //  - 有原始文件的上传文档置回 pending，提示用户「重新解析」。
        const embedder = getEmbeddingProvider();
        const embeddings = await embedder.embedBatch(
          MOCK_CHUNKS.map(
            (c) => `${c.sectionPath ?? ""} ${c.clauseNo ?? ""} ${c.content}`
          )
        );
        store.chunks = MOCK_CHUNKS.map((c, i) => ({
          ...c,
          embedding: embeddings[i],
        }));
        // 补齐升级后新增的内置 mock 文档（如演示指标表文档），否则其 chunk
        // 因 documentId 不在 documents 中而无法被检索。
        for (const md of MOCK_DOCUMENTS) {
          if (!store.documents.some((d) => d.id === md.id)) {
            store.documents.push({ ...md });
          }
        }
        store.ragTables = buildRagTablesFromChunks(store.chunks, docTitleResolver());
        store.documents = store.documents.map((d) =>
          store.rawBuffers[d.id] ? { ...d, status: "pending" } : d
        );
        store.seeded = true;
        saveDocuments(store.documents);
        saveChunks(store.chunks);
        saveRagTables(store.ragTables);
        return;
      }

      store.chunks = persisted.chunks;
      store.ragTables = persisted.ragTables;
      store.seeded = true;
      return;
    }

    // 2. 首次启动：播种内置 mock 数据并落盘
    const embedder = getEmbeddingProvider();

    store.documents = [...MOCK_DOCUMENTS];

    const embeddings = await embedder.embedBatch(
      MOCK_CHUNKS.map((c) => `${c.sectionPath ?? ""} ${c.articleNo ?? ""} ${c.content}`)
    );
    store.chunks = MOCK_CHUNKS.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
    }));
    // 从 mock chunk 合成 RagTable，并就地回填 chunk.rowId（建立绑定）
    store.ragTables = buildRagTablesFromChunks(store.chunks, docTitleResolver());

    store.evaluation = MOCK_EVALUATION.map((e) => ({ ...e }));
    store.seeded = true;

    saveDocuments(store.documents);
    saveChunks(store.chunks);
    saveRagTables(store.ragTables);
    saveEvaluationFile(store.evaluation);
  })();

  return seedPromise;
}

export function getStore(): DataStore {
  return store;
}
