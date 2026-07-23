import type { CanonicalTable } from "./canonicalTable.ts";

export type ContinuationDecision =
  | { merge: true; reason: "explicit_continuation" | "matching_structure" }
  | {
      merge: false;
      reason:
        | "not_adjacent"
        | "leaf_column_count_mismatch"
        | "column_boundary_mismatch"
        | "conflicting_title"
        | "header_similarity_too_low";
    };

const CONTINUATION_TITLE_RE = /续表|接上表|续$/;

export function decideCanonicalContinuation(
  previous: CanonicalTable,
  current: CanonicalTable
): ContinuationDecision {
  if (current.pageStart !== previous.pageEnd + 1) {
    return { merge: false, reason: "not_adjacent" };
  }
  if (current.columns.length !== previous.columns.length) {
    return { merge: false, reason: "leaf_column_count_mismatch" };
  }
  if (!boundariesCompatible(previous, current)) {
    return { merge: false, reason: "column_boundary_mismatch" };
  }

  const currentTitle = current.title?.trim() ?? "";
  if (CONTINUATION_TITLE_RE.test(currentTitle)) {
    return { merge: true, reason: "explicit_continuation" };
  }
  const previousTitle = normalizeText(previous.title ?? "");
  const normalizedCurrentTitle = normalizeText(currentTitle);
  if (
    normalizedCurrentTitle
    && normalizedCurrentTitle !== previousTitle
  ) {
    return { merge: false, reason: "conflicting_title" };
  }
  if (headerSimilarity(previous, current) < 0.8) {
    return { merge: false, reason: "header_similarity_too_low" };
  }
  return { merge: true, reason: "matching_structure" };
}

function boundariesCompatible(
  previous: CanonicalTable,
  current: CanonicalTable
): boolean {
  const left = normalizeBoundaries(
    previous.physicalBoundaries.vertical,
    previous.sourceBBox
  );
  const right = normalizeBoundaries(
    current.physicalBoundaries.vertical,
    current.sourceBBox
  );
  if (left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]) <= 0.03);
}

function normalizeBoundaries(
  boundaries: number[],
  bbox: CanonicalTable["sourceBBox"]
): number[] {
  const width = bbox[2] - bbox[0];
  if (width <= 0) return [];
  return boundaries.map((value) => (value - bbox[0]) / width);
}

function headerSimilarity(
  previous: CanonicalTable,
  current: CanonicalTable
): number {
  const left = headerTokens(previous);
  const right = headerTokens(current);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / union.size;
}

function headerTokens(table: CanonicalTable): Set<string> {
  return new Set(
    table.columns
      .flatMap((column) => column.headerPath)
      .map(normalizeText)
      .filter(Boolean)
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[（）()]/g, "").toLowerCase();
}
