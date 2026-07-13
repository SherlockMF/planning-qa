import type { Chunk, RetrievedChunk } from "../../types";

export function expandServiceScaleSiblingRows(
  results: RetrievedChunk[],
  chunks: Chunk[],
  question: string
): RetrievedChunk[] {
  if (!/服务规模|多少处|几处/.test(question.trim())) return results;

  const out: RetrievedChunk[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    append(result);
    const anchor = result.chunk;
    if (!isServiceScaleRow(anchor)) continue;

    const tableId = anchor.tableId ?? anchor.sourceTableId;
    const rowKey = facilityKey(anchor);
    if (!tableId || !rowKey) continue;

    const siblings = chunks
      .filter(
        (chunk) =>
          chunk.documentId === anchor.documentId &&
          (chunk.tableId ?? chunk.sourceTableId) === tableId &&
          facilityKey(chunk) === rowKey &&
          chunk.id !== anchor.id &&
          isServiceScaleRow(chunk) &&
          !isSummaryServiceScaleRow(chunk)
      )
      .sort((a, b) => rowOrder(a) - rowOrder(b));

    for (const sibling of siblings) {
      append({
        ...result,
        chunk: sibling,
        keywordScore: result.keywordScore * 0.98,
        vectorScore: result.vectorScore * 0.98,
        rerankScore: result.rerankScore * 0.98,
        matchedKeywords: [...result.matchedKeywords],
      });
    }
  }

  return out;

  function append(item: RetrievedChunk) {
    if (seen.has(item.chunk.id)) return;
    seen.add(item.chunk.id);
    out.push(item);
  }
}

function isServiceScaleRow(chunk: Chunk): boolean {
  if (!chunk.fields?.["服务规模"]) return false;
  return chunk.chunkType === "indicator" || chunk.chunkType === "table_row";
}

function isSummaryServiceScaleRow(chunk: Chunk): boolean {
  return chunk.rowType === "summary" || chunk.fields?.["层级"] === "小计";
}

function facilityKey(chunk: Chunk): string {
  return (
    chunk.fields?.["设施名称"] ??
    chunk.fields?.["指标对象"] ??
    chunk.rowKey ??
    chunk.itemName ??
    ""
  ).trim();
}

function rowOrder(chunk: Chunk): number {
  const category = chunk.fields?.["列4"]?.trim();
  if (category === "A类") return 1;
  if (category === "B类") return 2;
  if (category === "C类") return 3;
  const index = chunk.sourceRowIndex;
  return typeof index === "number" ? index : Number.POSITIVE_INFINITY;
}
