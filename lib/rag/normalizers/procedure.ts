import type { Block } from "../../types";
import type { ProcedureStepObject } from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const PROCEDURE_RE = /流程|程序|步骤|阶段|办理|审查|审批|报审|操作/;
const STEP_RE = /^\s*(?:第?[一二三四五六七八九十0-9]+步|步骤[一二三四五六七八九十0-9]+|\d+[、.．])/;

export function extractProcedureObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree
): ProcedureStepObject[] {
  const out: ProcedureStepObject[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== "list_item" && block.type !== "paragraph") return;
    const text = block.normalizedText;
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
    if (
      !PROCEDURE_RE.test(sectionPath.join(" ")) &&
      !(PROCEDURE_RE.test(text) && STEP_RE.test(text))
    ) {
      return;
    }
    out.push({
      id: stableObjectId(docId, "procedure_step", [index, text.slice(0, 80)]),
      docId,
      objectType: "procedure_step",
      title: text.slice(0, 40),
      content: text,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      procedureName: sectionPath.find((s) => PROCEDURE_RE.test(s)),
      stepNo: block.listMarker ?? text.match(STEP_RE)?.[0]?.trim(),
      stepText: text,
      confidence: 0.64,
      warnings: STEP_RE.test(text) ? undefined : ["procedure_from_section_context"],
    });
  });
  return out;
}
