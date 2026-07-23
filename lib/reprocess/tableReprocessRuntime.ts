import type { Block, Chunk, Document, RagTable } from "../types.ts";
import { getEmbeddingProvider } from "../ai/embedding.ts";
import { buildChunksWithObjects } from "../rag/chunk.ts";
import {
  buildRagTablesFromChunks,
  buildRagTablesFromObjects,
} from "../rag/ragTable.ts";
import { extractText } from "../parse/extractText.ts";
import { extractBlocksWithTables } from "../parse/tablesSidecar.ts";
import { getStore } from "../db/store.ts";
import { saveChunksStrict, saveRagTablesStrict } from "../db/persist.ts";
import {
  prepareTableReprocess,
  publishTableReprocess,
  recoverIncompleteTableReprocessTransactions,
  type ReprocessBuildResult,
  type ReprocessRepository,
} from "./tableReprocess.ts";

export const tableReprocessRepository: ReprocessRepository = {
  read() {
    const store = getStore();
    return { chunks: store.chunks, ragTables: store.ragTables };
  },
  writeChunks(chunks) {
    saveChunksStrict(chunks);
    getStore().chunks = chunks;
  },
  writeRagTables(ragTables) {
    saveRagTablesStrict(ragTables);
    getStore().ragTables = ragTables;
  },
};

export async function prepareDocumentTableReprocess(
  document: Document,
  sourceBuffer: Buffer,
  stagingId?: string
) {
  recoverIncompleteTableReprocessTransactions({
    repository: tableReprocessRepository,
  });
  const active = tableReprocessRepository.read();
  return prepareTableReprocess({
    docId: document.id,
    stagingId,
    sourceBuffer,
    activeChunks: active.chunks,
    activeRagTables: active.ragTables,
    build: async () => buildDocumentIndex(document, sourceBuffer),
  });
}

export async function publishDocumentTableReprocess(
  document: Document,
  sourceBuffer: Buffer,
  stagingId: string
) {
  recoverIncompleteTableReprocessTransactions({
    repository: tableReprocessRepository,
  });
  return publishTableReprocess({
    docId: document.id,
    stagingId,
    repository: tableReprocessRepository,
    sourceBuffer,
  });
}

async function buildDocumentIndex(
  document: Document,
  sourceBuffer: Buffer
): Promise<ReprocessBuildResult> {
  let input: { blocks?: Block[]; text?: string };
  if (document.fileName.toLowerCase().endsWith(".pdf")) {
    input = { blocks: await extractBlocksWithTables(sourceBuffer) };
  } else {
    input = { text: await extractText(sourceBuffer, document.fileName) };
  }

  const buildResult = buildChunksWithObjects(document, input);
  if (!buildResult.drafts.length) {
    throw new Error("reprocess_empty_document");
  }
  const embedder = getEmbeddingProvider();
  const embeddings = await embedder.embedBatch(
    buildResult.drafts.map(
      (draft) =>
        draft.embeddingText ??
        `${draft.sectionPath ?? ""} ${draft.clauseNo ?? ""} ${draft.tableTitle ?? ""} ${draft.content}`
    )
  );
  const createdAt = new Date().toISOString();
  const chunks: Chunk[] = buildResult.drafts.map((draft, index) => ({
    ...draft,
    fileName: document.fileName,
    city: document.city,
    embedding: embeddings[index],
    createdAt,
    articleNo: draft.clauseNo ?? draft.tableTitle,
    pageNumber: draft.pageStart,
    versionInfo:
      document.effectiveDate && !draft.versionInfo?.effectiveDate
        ? {
            ...(draft.versionInfo ?? {}),
            effectiveDate: document.effectiveDate,
          }
        : draft.versionInfo,
  }));
  const docTitle = document.fileName.replace(/\.(pdf|docx|txt|md)$/i, "");
  let ragTables: RagTable[] = buildRagTablesFromObjects(
    buildResult.knowledgeObjects,
    docTitle,
    chunks
  );
  if (!ragTables.length) {
    ragTables = buildRagTablesFromChunks(chunks, () => docTitle);
  }
  return { chunks, ragTables };
}
