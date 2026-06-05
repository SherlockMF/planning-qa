import type { Block } from "../../types";
import type {
  DeliverableRequirementObject,
  DrawingRequirementObject,
  StructuredTableObject,
} from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const DELIVERABLE_RE = /成果要求|成果|附件|数据库|附表|清单|编制内容|应包括|至少包括|必选|选做|▲/;
const DRAWING_RE = /图纸要求|图纸目录|图纸|图则|导则|比例尺/;

export function extractDeliverableObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree,
  tables: StructuredTableObject[]
): Array<DeliverableRequirementObject | DrawingRequirementObject> {
  const out: Array<DeliverableRequirementObject | DrawingRequirementObject> = [];

  blocks.forEach((block, index) => {
    if (block.type !== "paragraph" && block.type !== "list_item") return;
    const text = block.normalizedText;
    if (!DELIVERABLE_RE.test(text) && !DRAWING_RE.test(text)) return;
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
    if (DRAWING_RE.test(text)) {
      out.push({
        id: stableObjectId(docId, "drawing_requirement", [index, text.slice(0, 80)]),
        docId,
        objectType: "drawing_requirement",
        title: text.slice(0, 40),
        content: text,
        sectionPath,
        sectionPathText: sectionPathText(sectionPath),
        sourcePageStart: block.pageStart,
        sourcePageEnd: block.pageEnd,
        sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
        sourceBlockIds: [blockIdAt(index)],
        drawingName: extractName(text),
        requirementText: text,
        mandatory: isMandatory(text),
        relatedSection: sectionPath.at(-1),
        confidence: 0.74,
      });
      return;
    }
    out.push({
      id: stableObjectId(docId, "deliverable_requirement", [index, text.slice(0, 80)]),
      docId,
      objectType: "deliverable_requirement",
      title: extractName(text) ?? text.slice(0, 40),
      content: text,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      deliverableType: deliverableType(text),
      itemTitle: extractName(text) ?? text.slice(0, 40),
      requirementText: text,
      mandatory: isMandatory(text),
      confidence: 0.72,
    });
  });

  for (const table of tables) {
    if (table.tableType !== "deliverable_table") continue;
    for (const row of table.rows) {
      const text = Object.entries(row.fields)
        .map(([k, v]) => `${k}：${v}`)
        .join("。");
      const title = row.rowKey ?? extractName(text) ?? table.tableTitle ?? "成果要求";
      const isDrawing = DRAWING_RE.test(text);
      out.push(
        isDrawing
          ? {
              id: stableObjectId(docId, "drawing_requirement", [row.id, text.slice(0, 80)]),
              docId,
              objectType: "drawing_requirement",
              title,
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
              drawingName: title,
              requirementText: text,
              mandatory: isMandatory(text),
              relatedSection: row.sectionPath.at(-1),
              confidence: 0.8,
            }
          : {
              id: stableObjectId(docId, "deliverable_requirement", [row.id, text.slice(0, 80)]),
              docId,
              objectType: "deliverable_requirement",
              title,
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
              deliverableType: deliverableType(text),
              itemTitle: title,
              requirementText: text,
              mandatory: isMandatory(text),
              confidence: 0.8,
            }
      );
    }
  }

  return out;
}

function deliverableType(text: string): DeliverableRequirementObject["deliverableType"] {
  if (/图纸|图则/.test(text)) return "drawing";
  if (/表|附表/.test(text)) return "table";
  if (/清单/.test(text)) return "list";
  if (/数据库/.test(text)) return "database";
  if (/附件/.test(text)) return "appendix";
  if (/文本|说明书|报告/.test(text)) return "text";
  return "unknown";
}

function isMandatory(text: string): boolean | undefined {
  if (/必选|必须|应包括|至少包括|▲/.test(text)) return true;
  if (/选做|可/.test(text)) return false;
  return undefined;
}

function extractName(text: string): string | undefined {
  return text.match(/^([^：:，,。；;]{2,30})/)?.[1]?.trim();
}
