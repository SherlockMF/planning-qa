import { parseScaleCellTiers } from "./tables/scaleCellTiers.ts";

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
  if (isSingleCategorizedServiceScaleRow(citations, question)) return null;

  const aggregatedScaleTiers = aggregateScaleTierConclusion(citations, question);
  if (aggregatedScaleTiers) return aggregatedScaleTiers;

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
  const best = candidates[0];
  if (!best || (question.trim() && best.score <= 0)) return null;
  // 脏规模值（粘连床位/面积、散文进规模字段）不得被提炼成确定性结论。
  if (hasCorruptScaleLines(best.lines)) return null;
  return joinAsConclusion(best.lines);
}

function aggregateScaleTierConclusion(
  citations: StructuredEvidenceSignal[],
  question: string
): string | null {
  const q = question.trim();
  if (!isGeneralScaleQuestion(q) || /服务规模|多少处|几处|千人/.test(q)) return null;
  if (isDetailedRequirementQuestion(q)) return null;

  const paired = citations.flatMap((citation, index) => {
    const lines = extractUsefulStructuredLines(citation);
    if (lines.length === 0) return [];

    const fromExplicit = extractExplicitScaleTier(lines);
    if (fromExplicit.length > 0) {
      return fromExplicit.map((item) => ({ ...item, index }));
    }
    return extractScaleTierFromAreaLines(lines).map((item) => ({ ...item, index }));
  });
  if (paired.length < 2) return null;

  paired.sort((a, b) => a.sortValue - b.sortValue || a.index - b.index);
  const unique = [...new Set(paired.map((item) => item.text))];
  if (unique.length < 2) return null;

  const firstMeta = citations
    .map(extractUsefulStructuredLines)
    .flat()
    .filter((line) => /^(指标对象|来源表格|设施名称)：/.test(line));
  const meta = [
    ...new Map(
      firstMeta
        .filter((line) => /配置指标表|设施名称|指标对象/.test(line))
        .map((line) => [line.split(/[：:]/, 1)[0], line] as const)
    ).values(),
  ].slice(0, 3);

  const serviceScale = citations
    .map(extractUsefulStructuredLines)
    .flat()
    .find((line) => /^服务规模：/.test(line));

  const joined = joinAsConclusion(
    [...meta, ...unique, serviceScale].filter(Boolean) as string[]
  );
  if (/50\s*[-—～~]\s*500\s*床/.test(joined) && /2000\s*[-—～~]\s*15000/.test(joined)) {
    return null;
  }
  return joined;
}

function extractExplicitScaleTier(
  lines: string[]
): Array<{ text: string; sortValue: number }> {
  if (!lines.some((line) => /分档：/.test(line))) return [];
  const tier = lines.find((line) => /分档：/.test(line));
  const area = lines.find(
    (line) =>
      /建筑面积/.test(line) &&
      /平方米\s*\/\s*处|平米\s*\/\s*处|一般规模/.test(line) &&
      !/千人|用地|分档/.test(line)
  );
  if (!tier || !area) return [];
  const tierText = tier.replace(/^[^：:]+[：:]/, "").trim();
  const areaText = area.replace(/^[^：:]+[：:]/, "").trim();
  if (/床/.test(areaText) || !/\d/.test(areaText)) return [];
  return [
    {
      text: `${tierText}：建筑面积${areaText}`,
      sortValue: numericSortValue(tierText),
    },
  ];
}

function extractScaleTierFromAreaLines(
  lines: string[]
): Array<{ text: string; sortValue: number }> {
  const areaLine = lines.find(
    (line) =>
      /建筑面积/.test(line) &&
      (/平方米\s*\/\s*处|平米\s*\/\s*处|一般规模/.test(line) || /床/.test(line)) &&
      !/千人|用地|分档/.test(line)
  );
  if (!areaLine) return [];
  const raw = areaLine.replace(/^[^：:]+[：:]/, "").trim();
  const parsed = parseScaleCellTiers(raw);
  if (!parsed.ok) return [];
  return parsed.tiers.map((tier) => ({
    text: `${tier.bedRangeRaw}：建筑面积${tier.buildingAreaRaw}`,
    sortValue: numericSortValue(tier.bedRangeRaw),
  }));
}

function hasCorruptScaleLines(lines: string[]): boolean {
  return lines.some((line) => {
    if (!/一般规模|建筑面积|用地面积|规模性指标|服务规模/.test(line)) return false;
    return (
      /床\s*\d+\s*[-—～~]\s*\d{2,4}\d{3,}/.test(line) ||
      /\d{2,4}\s*[-—～~]\s*\d{2,4}\d{3,5}\s*[-—～~]\s*\d{3,5}/.test(line) ||
      /\d+\s*\/\s*户\s*\d{3,}/.test(line) ||
      isProseScaleValue(line)
    );
  });
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

function isSingleCategorizedServiceScaleRow(
  citations: StructuredEvidenceSignal[],
  question: string
): boolean {
  if (!/服务规模|多少处|几处/.test(question.trim())) return false;
  const rows = citations
    .map(extractUsefulStructuredLines)
    .filter((lines) => lines.some((line) => /^服务规模：/.test(line)));
  return (
    rows.length === 1 &&
    rows[0].some((line) => /^列\d+：[ABC]类$/.test(line))
  );
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
    (a, b) => {
      const scoreDiff =
        structuredEvidenceQuestionScore(extractUsefulStructuredLines(b), question) -
        structuredEvidenceQuestionScore(extractUsefulStructuredLines(a), question);
      if (scoreDiff !== 0) return scoreDiff;
      const tieDiff =
        citationQuestionTieBreak(b, question) - citationQuestionTieBreak(a, question);
      if (tieDiff !== 0) return tieDiff;
      if (/服务规模|多少处|几处/.test(question.trim())) {
        return citationServiceScaleSortValue(a) - citationServiceScaleSortValue(b);
      }
      return 0;
    }
  );
}

export function preferCleanStructuredCitations<T extends StructuredEvidenceSignal>(
  citations: T[],
  question: string
): T[] {
  if (isDrawingDeliverableQuestion(question)) {
    const cleanDeliverables = citations.filter(
      (citation) => isCleanCitation(citation) && citation.chunkType === "deliverable"
    );
    if (cleanDeliverables.length > 0) return cleanDeliverables;
  }

  const hasCleanStructuredAnswer = citations.some((citation) => {
    const lines = extractUsefulStructuredLines(citation);
    return lines.length >= 2 && structuredEvidenceQuestionScore(lines, question) > 0;
  });
  if (!hasCleanStructuredAnswer) return citations;

  const filtered = citations.filter(isCleanCitation);
  if (filtered.length === 0) return citations;
  const ranked = rankStructuredEvidenceForQuestion(filtered, question);
  return preferIndicatorTableForGeneralScale(ranked, question);
}

function preferIndicatorTableForGeneralScale<T extends StructuredEvidenceSignal>(
  citations: T[],
  question: string
): T[] {
  const q = question.trim();
  const asksGeneralScale =
    isGeneralScaleQuestion(q) &&
    !isDetailedRequirementQuestion(q) &&
    !/服务规模|多少处|几处|千人/.test(q);
  if (!asksGeneralScale) return citations;

  const indicatorRows = citations.filter((citation) => {
    const excerpt = citation.excerpt ?? "";
    return (
      /配置指标表/.test(excerpt) &&
      (/平方米\s*\/\s*处|分档|一般规模/.test(excerpt) || /床/.test(excerpt))
    );
  });
  return indicatorRows.length > 0 ? indicatorRows : citations;
}

function citationServiceScaleSortValue(citation: StructuredEvidenceSignal): number {
  const discriminator = extractUsefulStructuredLines(citation).find((line) =>
    /办学规模|一般规模|规模性指标/.test(line)
  );
  return numericSortValue(discriminator);
}

function isCleanCitation(citation: StructuredEvidenceSignal): boolean {
  return (
    !citation.lowFidelity &&
    citation.excerptDisplayPolicy !== "source_page_required" &&
    (citation.extractionWarnings?.length ?? 0) === 0
  );
}

function isDrawingDeliverableQuestion(question: string): boolean {
  return /图纸|图则|成果|提交|说明文件|说明书|附件|数据库|材料/.test(
    question.trim()
  );
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
  const merged: string[] = [];
  for (const rawLine of excerpt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^【结构化/.test(line)) continue;
    if (line.includes("：") || line.includes(":")) {
      merged.push(line);
      continue;
    }
    // 格内换行续行（如面积数值）并回上一字段，避免丢掉「2000-4000」。
    if (merged.length > 0) merged[merged.length - 1] += `\n${line}`;
  }
  return merged;
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
      if (/千人/.test(line)) continue;
      // 排除千人指标列「建筑面积 (平方米)」，只留「平方米/处」或分档。
      if (
        /^建筑面积[^：:]*：/.test(line) &&
        !/平方米\s*\/\s*处|平米\s*\/\s*处|一般规模|分档/.test(line)
      ) {
        continue;
      }
      if (/^用地面积[^：:]*：/.test(line) && !/平方米\s*\/\s*处|一般规模/.test(line)) {
        continue;
      }
      if (/分档|一般规模|规模性指标|平方米\s*\/\s*处|平米\s*\/\s*处/.test(line)) {
        keep.add(line);
      } else if (/建筑面积/.test(line) && /床|\n/.test(line)) {
        keep.add(line);
      }
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
    // 问面积/一般规模时，数值指标表优先；使用说明/布局引导不能靠前。
    if (/配置指标表/.test(text)) score += 6;
    if (/配置要求表/.test(text)) score -= 4;
    if (/指标使用说明|布局引导要求/.test(text)) score -= 6;
    if (/详细配置要求/.test(text) && !hasConcreteScaleNumber(text)) score -= 5;
    if (hasConcreteScaleNumber(text)) score += 8;
    if (/规模性指标\.一般规模/.test(text) && !isProseScaleValue(text)) score += 5;
    if (/建筑面积|用地面积|床/.test(text)) score += 2;
  }
  if (/一般/.test(q) && /一般规模/.test(text)) score += 4;
  if (asksThousandIndicator && /千人指标/.test(text)) score += 8;
  if (asksServiceScale && /服务规模/.test(text)) score += 8;
  if (/15分钟|步行|可达|85%|比例|使用说明/.test(q) && /详细配置要求|指标使用说明/.test(text)) {
    score += 4;
  }

  return score;
}

function citationQuestionTieBreak(citation: StructuredEvidenceSignal, question: string): number {
  const excerpt = citation.excerpt ?? "";
  const asksDetailedRequirement = isDetailedRequirementQuestion(question);
  const asksServiceScale = /服务规模|多少处|几处/.test(question.trim());
  const asksGeneralScale =
    isGeneralScaleQuestion(question.trim()) && !asksDetailedRequirement && !asksServiceScale;
  let score = 0;

  if (/来源表格：.*配置指标表/.test(excerpt)) {
    if (asksGeneralScale || asksServiceScale) score += 5;
    if (asksDetailedRequirement) score -= 1;
  }
  if (/来源表格：.*配置要求表/.test(excerpt)) {
    if (asksDetailedRequirement) score += 3;
    if (asksGeneralScale || asksServiceScale) score -= 4;
  }
  if (asksGeneralScale) {
    if (hasConcreteScaleNumber(excerpt)) score += 4;
    if (/指标使用说明|布局引导要求/.test(excerpt)) score -= 5;
    if (/规模性指标|一般规模|建筑面积|用地面积/.test(excerpt)) score += 1;
  }
  if (asksServiceScale && /服务规模/.test(excerpt)) score += 1;
  if (asksDetailedRequirement && /详细配置要求|配置要求/.test(excerpt)) score += 1;

  return score;
}

/** 规模字段应是数值/区间，不应是科室说明长文。 */
function isProseScaleValue(text: string): boolean {
  const scaleLine = text
    .split(/\r?\n/)
    .find((line) => /规模性指标|一般规模/.test(line) && !/来源表格/.test(line));
  if (!scaleLine) return false;
  const value = scaleLine.replace(/^[^：:]+[：:]/, "").trim();
  if (!value) return false;
  if (/\d/.test(value) && value.replace(/[^\d]/g, "").length >= 3 && value.length <= 40) {
    return false;
  }
  return /[一-龥]{12,}/.test(value);
}

function hasConcreteScaleNumber(text: string): boolean {
  return (
    /(?:建筑面积|用地面积|一般规模|列\d+)[^\n]{0,20}\d{3,5}/.test(text) ||
    /[ABC]类[^\n]{0,30}\d{3,5}/.test(text) ||
    /类[ABC][^\n]{0,30}\d{3,5}/.test(text) ||
    /\b(?:3500|4500|5500|2000|4000|15000)\b/.test(text)
  );
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
