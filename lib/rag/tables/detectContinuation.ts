import type { TableModel } from "../../types";

export interface ContinuationDecision {
  isContinuation: boolean;
  similarity: number;
  warnings: string[];
}

const CONTINUATION_TITLE_RE = /续表|接上表|续/;

export function detectContinuation(
  previous: { model: TableModel; pageEnd: number },
  current: { model: TableModel; pageStart: number }
): ContinuationDecision {
  const warnings: string[] = [];
  const adjacentPage = current.pageStart <= previous.pageEnd + 1;
  const title = current.model.title ?? "";
  const continuationTitle = CONTINUATION_TITLE_RE.test(title);
  const sameTitle =
    !!current.model.title &&
    !!previous.model.title &&
    stripContinuation(current.model.title) === stripContinuation(previous.model.title);
  const similarHeaders = headerSimilarity(previous.model.headers, current.model.headers);
  const columnClose =
    Math.abs(previous.model.headers.length - current.model.headers.length) <= 1;
  const missingCompleteTitle = !current.model.title || continuationTitle;

  if (!adjacentPage) warnings.push("non_adjacent_page");
  if (!columnClose) warnings.push("column_count_changed");
  if (similarHeaders < 0.75) warnings.push("low_header_similarity");

  const isContinuation =
    adjacentPage &&
    columnClose &&
    (continuationTitle || sameTitle || (missingCompleteTitle && similarHeaders >= 0.75));

  return { isContinuation, similarity: similarHeaders, warnings };
}

export function headerSimilarity(a: string[], b: string[]): number {
  const left = new Set(a.map(normalizeHeader).filter(Boolean));
  const right = new Set(b.map(normalizeHeader).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection++;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function normalizeHeader(header: string): string {
  return header
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s\-—–、，,。；;:：/]+/g, "")
    .toLowerCase();
}

function stripContinuation(title: string): string {
  return title.replace(CONTINUATION_TITLE_RE, "").replace(/\s+/g, "").trim();
}
