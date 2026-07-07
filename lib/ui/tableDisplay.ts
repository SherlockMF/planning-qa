import type { ChunkType } from "@/lib/types";

const TABLE_CHUNK_TYPES = new Set<ChunkType>(["table_full", "table_row"]);

export function shouldRenderAnswerTextAsTable(_answerText: string): boolean {
  return false;
}

export function isCitationTable(citation: {
  chunkType?: ChunkType;
  excerpt: string;
}): boolean {
  return citation.chunkType != null && TABLE_CHUNK_TYPES.has(citation.chunkType);
}
