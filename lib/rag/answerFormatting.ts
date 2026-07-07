interface ConclusionCitationSignal {
  lowFidelity?: boolean;
  extractionWarnings?: string[];
  excerptDisplayPolicy?: "show_extracted_text" | "source_page_required";
}

export interface ConclusionReflection {
  needsFallback: boolean;
  reasons: string[];
}

export interface FinalizedConclusion {
  text: string;
  reflection: ConclusionReflection;
}

export function sanitizeConclusionText(text: string): string {
  const withoutInternalMarkers = stripInternalMarkers(text);
  const nestedConclusion = extractTemplateSection(withoutInternalMarkers, "结论");
  return (nestedConclusion ?? withoutInternalMarkers).trim();
}

export function finalizeConclusionText(
  conclusion: string,
  citations: ConclusionCitationSignal[]
): FinalizedConclusion {
  const text = sanitizeConclusionText(conclusion);
  const reasons = reflectConclusionText(text, citations);
  if (reasons.length === 0) {
    return { text, reflection: { needsFallback: false, reasons } };
  }

  const needsSourceReview = citations.some(
    (c) =>
      c.lowFidelity ||
      c.excerptDisplayPolicy === "source_page_required" ||
      (c.extractionWarnings?.length ?? 0) > 0
  );

  return {
    text: needsSourceReview
      ? "已定位到相关原文位置，但自动提炼结果存在不完整或抽取噪声风险，系统不直接提炼为确定结论。请打开引用的原文页面核对后使用。"
      : "已检索到相关依据，但自动提炼结果不完整，系统不直接输出半截结论。请结合下方引用原文核对。",
    reflection: { needsFallback: true, reasons },
  };
}

export function isIncompleteConclusionText(text: string): boolean {
  return reflectConclusionText(text, []).length > 0;
}

function extractTemplateSection(text: string, title: string): string | null {
  const parts = text
    .split(/【(结论|依据|注意|无法确定|原因|建议)】/)
    .filter((s) => s !== "");
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i]?.trim() === title) {
      return (parts[i + 1] ?? "").trim();
    }
  }
  return null;
}

function stripInternalMarkers(text: string): string {
  if (/^【结构化/.test(text.trimStart())) {
    const m = text.match(/\n原文[：:]\n?([\s\S]+)/);
    if (m) return m[1].replace(/\n{3,}/g, "\n\n").trim();
  }

  return text
    .replace(/【结构化[^】]+】/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function reflectConclusionText(
  text: string,
  _citations: ConclusionCitationSignal[]
): string[] {
  const trimmed = text.trim();
  const reasons: string[] = [];

  if (!trimmed) reasons.push("empty_conclusion");
  if (/[，,、；;：:]$/.test(trimmed)) reasons.push("dangling_separator");
  if (/(?:和|及|或|以及|包括|其中|原则上|不低于|不少于|为)$/.test(trimmed)) {
    reasons.push("dangling_connector");
  }
  if (/(?:^|[^\d])\d+(?:\.\d+)?$/.test(trimmed)) {
    reasons.push("dangling_number");
  }

  return reasons;
}
