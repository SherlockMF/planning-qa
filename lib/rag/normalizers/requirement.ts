import type { Block } from "../../types";
import type {
  NormativeLevel,
  RequirementObject,
  StructuredTableObject,
} from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const OBLIGATION_PATTERNS: Array<[RegExp, NormativeLevel]> = [
  [/(不得|禁止|严禁|不应)/, "forbidden"],
  [/(必须)/, "must"],
  [/(应当|应)/, "shall"],
  [/(宜|原则上应)/, "should"],
  [/(可|参照|结合实际)/, "may"],
  [/(鼓励)/, "encouraged"],
];

export function extractRequirementObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree,
  tables: StructuredTableObject[]
): RequirementObject[] {
  const out: RequirementObject[] = [];

  blocks.forEach((block, index) => {
    if (block.type !== "paragraph" && block.type !== "list_item") return;
    const sentences = splitSentences(block.normalizedText).filter((text) =>
      extractObligationKeywords(text).length > 0
    );
    for (const sentence of sentences) {
      const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
      out.push({
        id: stableObjectId(docId, "requirement", [index, sentence.slice(0, 100)]),
        docId,
        objectType: "requirement",
        title: sentence.slice(0, 30),
        content: sentence,
        sectionPath,
        sectionPathText: sectionPathText(sectionPath),
        sourcePageStart: block.pageStart,
        sourcePageEnd: block.pageEnd,
        sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
        sourceBlockIds: [blockIdAt(index)],
        requirementText: sentence,
        normativeLevel: normativeLevel(sentence),
        obligationKeywords: extractObligationKeywords(sentence),
        keywords: extractObligationKeywords(sentence),
        confidence: 0.82,
      } as RequirementObject);
    }
  });

  for (const table of tables) {
    if (table.tableType !== "requirement_table") continue;
    for (const row of table.rows) {
      const text = requirementTextFromFields(row.fields) ?? row.content;
      if (!text) continue;
      out.push({
        id: stableObjectId(docId, "requirement", [row.id, text.slice(0, 80)]),
        docId,
        objectType: "requirement",
        title: row.rowKey,
        content: text,
        sectionPath: row.sectionPath,
        sectionPathText: sectionPathText(row.sectionPath),
        sourcePageStart: row.sourcePageStart,
        sourcePageEnd: row.sourcePageEnd,
        sourcePages: row.sourcePages,
        sourceBlockIds: row.sourceBlockIds,
        sourceTableId: row.sourceTableId,
        sourceRowIndex: row.rowIndex,
        parentObjectId: row.id,
        requirementText: text,
        subject: row.rowKey,
        normativeLevel: normativeLevel(text),
        keywords: [row.rowKey, ...extractObligationKeywords(text)].filter(Boolean) as string[],
        confidence: 0.78,
      });
    }
  }

  return out;
}

export function extractObligationKeywords(text: string): string[] {
  const keywords = new Set<string>();
  for (const keyword of [
    "必须",
    "应",
    "应当",
    "不得",
    "禁止",
    "严禁",
    "原则上应",
    "宜",
    "可",
    "鼓励",
    "参照",
    "结合实际",
  ]) {
    if (text.includes(keyword)) keywords.add(keyword);
  }
  return [...keywords];
}

export function normativeLevel(text: string): NormativeLevel {
  for (const [re, level] of OBLIGATION_PATTERNS) {
    if (re.test(text)) return level;
  }
  return "unknown";
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。；;！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function requirementTextFromFields(fields: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(fields)) {
    if (/要求|内容|说明|引导|管控/.test(key) && value.trim()) return value.trim();
  }
  return undefined;
}
