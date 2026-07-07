export interface StructuredEvidenceSignal {
  lowFidelity?: boolean;
  extractionWarnings?: string[];
  excerptDisplayPolicy?: "show_extracted_text" | "source_page_required";
  chunkType?: string;
  excerpt?: string;
}

export function recoverConclusionFromStructuredEvidence(
  citations: StructuredEvidenceSignal[],
  question = ""
): string | null {
  const aggregatedServiceScale = aggregateServiceScaleConclusion(citations, question);
  if (aggregatedServiceScale) return aggregatedServiceScale;

  const candidates: Array<{ lines: string[]; score: number }> = [];

  for (const citation of citations) {
    const usefulLines = extractUsefulStructuredLines(citation);
    if (usefulLines.length < 2) continue;

    candidates.push({
      lines: selectStructuredConclusionLines(usefulLines, question),
      score: structuredEvidenceQuestionScore(usefulLines, question),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? joinAsConclusion(candidates[0].lines) : null;
}

function aggregateServiceScaleConclusion(
  citations: StructuredEvidenceSignal[],
  question: string
): string | null {
  if (!/服务规模|多少处|几处/.test(question.trim())) return null;

  const rows = citations
    .map(extractUsefulStructuredLines)
    .filter((lines) => lines.some((line) => /^服务规模：/.test(line)));
  if (rows.length <= 1) return null;

  const firstMeta = rows[0].filter((line) =>
    /^(指标对象|来源表格|设施名称)：/.test(line)
  );
  const rowItems = rows.flatMap((lines, index) => {
    const discriminator = lines.find((line) =>
      /办学规模|一般规模|规模性指标/.test(line)
    );
    const serviceScale = lines.find((line) => /^服务规模：/.test(line));
    return serviceScale
      ? [{
          text: [discriminator, serviceScale].filter(Boolean).join("，"),
          sortValue: numericSortValue(discriminator),
          index,
        }]
      : [];
  });
  rowItems.sort((a, b) => a.sortValue - b.sortValue || a.index - b.index);
  const uniqueRows = [...new Set(rowItems.map((item) => item.text))];
  if (uniqueRows.length <= 1) return null;
  return joinAsConclusion([...firstMeta, ...uniqueRows]);
}

function numericSortValue(text: string | undefined): number {
  const match = text?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

export function rankStructuredEvidenceForQuestion<T extends StructuredEvidenceSignal>(
  citations: T[],
  question: string
): T[] {
  return [...citations].sort(
    (a, b) =>
      structuredEvidenceQuestionScore(extractUsefulStructuredLines(b), question) -
      structuredEvidenceQuestionScore(extractUsefulStructuredLines(a), question)
  );
}

export function preferCleanStructuredCitations<T extends StructuredEvidenceSignal>(
  citations: T[],
  question: string
): T[] {
  const hasCleanStructuredAnswer = citations.some((citation) => {
    const lines = extractUsefulStructuredLines(citation);
    return lines.length >= 2 && structuredEvidenceQuestionScore(lines, question) > 0;
  });
  if (!hasCleanStructuredAnswer) return citations;

  const filtered = citations.filter(
    (citation) =>
      !citation.lowFidelity &&
      citation.excerptDisplayPolicy !== "source_page_required" &&
      (citation.extractionWarnings?.length ?? 0) === 0
  );
  if (filtered.length === 0) return citations;
  if (!/服务规模|多少处|几处/.test(question.trim())) return filtered;
  return [...filtered].sort(
    (a, b) =>
      citationServiceScaleSortValue(a) - citationServiceScaleSortValue(b)
  );
}

function citationServiceScaleSortValue(citation: StructuredEvidenceSignal): number {
  const discriminator = extractUsefulStructuredLines(citation).find((line) =>
    /办学规模|一般规模|规模性指标/.test(line)
  );
  return numericSortValue(discriminator);
}

function joinAsConclusion(lines: string[]): string {
  return lines
    .map((line) => line.replace(/[。；;]\s*$/, "").trim())
    .filter(Boolean)
    .join("。");
}

function extractUsefulStructuredLines(citation: StructuredEvidenceSignal): string[] {
  if (
    citation.lowFidelity ||
    citation.excerptDisplayPolicy === "source_page_required" ||
    (citation.extractionWarnings?.length ?? 0) > 0
  ) {
    return [];
  }

  const excerpt = citation.excerpt?.trim() ?? "";
  if (!excerpt.startsWith("【结构化指标项】")) return [];
  return excerpt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^【结构化/.test(line) && line.includes("："));
}

function selectStructuredConclusionLines(lines: string[], question: string): string[] {
  const q = question.trim();
  if (!q) return lines;
  const asksDetailedRequirement = isDetailedRequirementQuestion(q);
  const asksThousandIndicator = /千人/.test(q);
  const asksServiceScale = /服务规模|多少处|几处/.test(q);
  const asksGeneralScale =
    isGeneralScaleQuestion(q) &&
    !asksDetailedRequirement &&
    !asksThousandIndicator &&
    !asksServiceScale;

  const keep = new Set<string>();
  for (const line of lines) {
    if (/^(指标对象|来源表格|设施名称)：/.test(line)) keep.add(line);
  }

  if (asksDetailedRequirement) {
    for (const line of lines) {
      if (/配置要求|详细配置要求/.test(line)) keep.add(line);
    }
  } else if (asksThousandIndicator) {
    for (const line of lines) if (/千人指标/.test(line)) keep.add(line);
  } else if (asksServiceScale) {
    for (const line of lines) if (/服务规模/.test(line)) keep.add(line);
  } else if (asksGeneralScale) {
    for (const line of lines) {
      if (/一般规模|建筑面积|用地面积|规模性指标/.test(line)) keep.add(line);
    }
  } else {
    return lines;
  }

  return keep.size > 0
    ? lines
        .filter((line) => keep.has(line))
        .map((line) => focusDetailedRequirementLine(line, q))
    : lines;
}

function structuredEvidenceQuestionScore(lines: string[], question: string): number {
  const text = lines.join("\n");
  const q = question.trim();
  let score = 0;
  const asksDetailedRequirement = isDetailedRequirementQuestion(q);
  const asksThousandIndicator = /千人/.test(q);
  const asksServiceScale = /服务规模|多少处|几处/.test(q);
  const asksGeneralScale =
    isGeneralScaleQuestion(q) &&
    !asksDetailedRequirement &&
    !asksThousandIndicator &&
    !asksServiceScale;

  if (asksDetailedRequirement) {
    if (/详细配置要求/.test(text)) score += 8;
    if (/配置要求表/.test(text)) score += 2;
    if (/规模性指标\.一般规模/.test(text)) score -= 4;
  }
  if (asksGeneralScale) {
    if (/规模性指标\.一般规模/.test(text)) score += 5;
    if (/建筑面积|用地面积/.test(text)) score += 2;
    if (/配置指标表/.test(text)) score += 1;
    if (/配置要求表/.test(text)) score -= 1;
  }
  if (/一般/.test(q) && /一般规模/.test(text)) score += 4;
  if (asksThousandIndicator && /千人指标/.test(text)) score += 8;
  if (asksServiceScale && /服务规模/.test(text)) score += 8;
  if (/15分钟|步行|可达|85%|比例|使用说明/.test(q) && /详细配置要求|指标使用说明/.test(text)) {
    score += 4;
  }

  return score;
}

function isDetailedRequirementQuestion(question: string): boolean {
  return /业务用房|辅助空间|比例|不低于|不少于|不小于|急救|A级|B级|病床|床位|每张床|15分钟|步行|可达|科室|隔离|留观/.test(
    question
  );
}

function isGeneralScaleQuestion(question: string): boolean {
  return /一般规模|一般.*面积|面积.*一般|多少面积|多大面积|多少.*(?:平方米|平米)|建筑面积|用地面积|规模/.test(
    question
  );
}

function focusDetailedRequirementLine(line: string, question: string): string {
  const prefix = "详细配置要求：";
  if (!line.startsWith(prefix)) return line;

  const body = line.slice(prefix.length);
  const terms = detailedRequirementTerms(question);
  if (terms.length === 0) return line;

  const sentences = body.match(/(?:\d+\.)?[^。；;]+[。；;]?/g) ?? [body];
  const matched = sentences.filter((sentence) =>
    terms.some((term) => sentence.includes(term))
  );

  return matched.length > 0 ? `${prefix}${matched.join("")}` : line;
}

function detailedRequirementTerms(question: string): string[] {
  const candidates = [
    "业务用房",
    "辅助空间",
    "比例",
    "不低于",
    "不少于",
    "不小于",
    "急救",
    "A级",
    "B级",
    "病床",
    "床位",
    "15分钟",
    "步行",
    "可达",
    "科室",
    "隔离",
    "留观",
  ];
  const terms = candidates.filter((term) => question.includes(term));
  if (/每张床/.test(question) && !terms.includes("病床")) terms.push("病床");
  return terms;
}
