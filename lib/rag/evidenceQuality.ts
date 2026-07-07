import type { ChunkType, Citation } from "@/lib/types";

const QUALITY_CHECK_CHUNK_TYPES = new Set<ChunkType>([
  "table_full",
  "table_row",
  "indicator",
  "requirement",
]);

export type ExtractionWarning =
  | "scrambled_numeric_unit"
  | "noisy_extraction_text";

export type EvidenceIssueCategory =
  | "numeric_value_corruption"
  | "reading_order_noise"
  | "table_text_glue";

export type EvidenceDisplayPolicy =
  | "show_extracted_text"
  | "source_page_required";

export interface EvidenceQuality {
  warnings: ExtractionWarning[];
  categories: EvidenceIssueCategory[];
  blocksAnswer: boolean;
  displayPolicy: EvidenceDisplayPolicy;
}

export function detectExtractionWarnings(input: {
  chunkType?: ChunkType;
  text: string;
}): ExtractionWarning[] {
  return classifyEvidenceQuality(input).warnings;
}

export function classifyEvidenceQuality(input: {
  chunkType?: ChunkType;
  text: string;
}): EvidenceQuality {
  if (!input.chunkType || !QUALITY_CHECK_CHUNK_TYPES.has(input.chunkType)) {
    return cleanQuality();
  }

  const text = stripStableLegalNumbers(input.text);
  const cjkDigitCjk = hasSuspiciousCjkDigitCjk(text);
  const digitCjkDigit = hasSuspiciousDigitCjkDigit(text);
  const orphanNumberList = /[、，,]\s*\d+\s*[、，,]/.test(text);
  const splitNumberComma = /\d\s+\d\s*,\s*\d+/.test(text);
  const brokenDecimal = /\d+\.\s*[、，,]/.test(text);
  const numberedListWithIdeographicComma = /\d+\.\s*、/.test(text);
  const brokenPercent = /[、，,]\s*[、，,]\s*\d+%/.test(text);
  const scrambledTenThousandPeople = /\d+万\.\d+人\d+/.test(text);
  const paragraphTableGlue =
    /[一-龥]\d{1,3}\s+\d?[一-龥]/.test(text) ||
    /含\s*\d+[一-龥]/.test(text) ||
    /\d+\)\s*万/.test(text);

  const categories: EvidenceIssueCategory[] = [];
  if (scrambledTenThousandPeople) {
    categories.push("numeric_value_corruption");
  }
  if (paragraphTableGlue) {
    categories.push("table_text_glue");
  }
  if (
    !scrambledTenThousandPeople &&
    (cjkDigitCjk ||
      digitCjkDigit ||
      orphanNumberList ||
      splitNumberComma ||
      brokenDecimal ||
      numberedListWithIdeographicComma ||
      brokenPercent)
  ) {
    categories.push("reading_order_noise");
  }

  if (categories.length === 0) return cleanQuality();

  const blocksAnswer = categories.includes("numeric_value_corruption");
  const warnings: ExtractionWarning[] = blocksAnswer
    ? ["scrambled_numeric_unit"]
    : ["noisy_extraction_text"];

  return {
    warnings,
    categories: [...new Set(categories)],
    blocksAnswer,
    displayPolicy: "source_page_required",
  };
}

export function applyLowFidelityFallback(
  conclusion: string,
  citations: Partial<Citation>[]
): string {
  const needsSourceReview = citations.some(
    (c) =>
      c.lowFidelity ||
      c.excerptDisplayPolicy === "source_page_required" ||
      (c.extractionWarnings?.length ?? 0) > 0
  );
  if (!needsSourceReview) return conclusion;
  return "已找到相关原文位置，但表格提取存在疑似数值或单位乱序，系统不直接引用解析出的具体数值。请以引用的原文页面为准。";
}

export function hasAnswerBlockingWarning(
  warnings: ExtractionWarning[] | string[] | undefined
): boolean {
  return (warnings ?? []).includes("scrambled_numeric_unit");
}

function stripStableLegalNumbers(text: string): string {
  return text
    .replace(/第\d+条/g, "")
    .replace(/\d+\.\d+(?:\.\d+)?/g, "");
}

function hasSuspiciousCjkDigitCjk(text: string): boolean {
  const normalQuantityRight = /[个分秒米人户处座班张条项类级层年月日%％㎡平至到]/;
  for (const m of text.matchAll(/[一-龥]\d[一-龥]/g)) {
    const token = m[0];
    const right = token.at(-1) ?? "";
    if (!normalQuantityRight.test(right)) return true;
  }
  return false;
}

function hasSuspiciousDigitCjkDigit(text: string): boolean {
  for (const m of text.matchAll(/\d[一-龥]\d/g)) {
    const token = m[0];
    const middle = token.charAt(1);
    if (!/[至到]/.test(middle)) return true;
  }
  return false;
}

function cleanQuality(): EvidenceQuality {
  return {
    warnings: [],
    categories: [],
    blocksAnswer: false,
    displayPolicy: "show_extracted_text",
  };
}
