import type { Block, DocProfile } from "../../types";
import type { KnowledgeObject, StructuredTableObject } from "../objects";
import type { SectionTree } from "../sectionTree";
import { buildStructuredTableObjects } from "../tables/tableObjects.ts";
import { extractClassificationCodeObjects } from "./classificationCode.ts";
import { extractIndicatorItemObjects } from "./indicator.ts";
import { extractClauseObjects } from "./clause.ts";
import { extractDefinitionObjects } from "./definition.ts";
import { extractRequirementObjects } from "./requirement.ts";
import { extractDeliverableObjects } from "./deliverable.ts";
import { extractChecklistObjects } from "./checklist.ts";
import { extractProcedureObjects } from "./procedure.ts";
import { extractReferenceBasisObjects } from "./referenceBasis.ts";
import { extractPlainSectionObjects } from "./plainSection.ts";

export interface ExtractKnowledgeObjectsInput {
  docId: string;
  blocks: Block[];
  sectionTree: SectionTree;
  tables?: unknown[];
  profile: DocProfile;
}

export function extractKnowledgeObjects(
  input: ExtractKnowledgeObjectsInput
): KnowledgeObject[] {
  const objects: KnowledgeObject[] = [];
  const warnings: string[] = [];

  const run = <T extends KnowledgeObject>(
    label: string,
    fn: () => T[]
  ): T[] => {
    try {
      return fn();
    } catch (error) {
      warnings.push(`${label}: ${String(error)}`);
      return [];
    }
  };

  const tableObjects = run("table", () =>
    buildStructuredTableObjects(input.docId, input.blocks, input.sectionTree)
  );
  const structuredTables = tableObjects as StructuredTableObject[];
  objects.push(...tableObjects);
  objects.push(...structuredTables.flatMap((table) => table.rows));

  objects.push(
    ...run("classificationCode", () =>
      extractClassificationCodeObjects(input.docId, structuredTables)
    )
  );
  objects.push(
    ...run("indicator", () =>
      extractIndicatorItemObjects(input.docId, structuredTables)
    )
  );
  objects.push(
    ...run("clause", () =>
      extractClauseObjects(input.docId, input.blocks, input.sectionTree)
    )
  );
  objects.push(
    ...run("definition", () =>
      extractDefinitionObjects(input.docId, input.blocks, input.sectionTree)
    )
  );
  objects.push(
    ...run("requirement", () =>
      extractRequirementObjects(
        input.docId,
        input.blocks,
        input.sectionTree,
        structuredTables
      )
    )
  );
  objects.push(
    ...run("deliverable", () =>
      extractDeliverableObjects(
        input.docId,
        input.blocks,
        input.sectionTree,
        structuredTables
      )
    )
  );
  objects.push(
    ...run("checklist", () =>
      extractChecklistObjects(
        input.docId,
        input.blocks,
        input.sectionTree,
        structuredTables
      )
    )
  );
  objects.push(
    ...run("procedure", () =>
      extractProcedureObjects(input.docId, input.blocks, input.sectionTree)
    )
  );
  objects.push(
    ...run("referenceBasis", () =>
      extractReferenceBasisObjects(input.docId, input.blocks, input.sectionTree)
    )
  );
  objects.push(
    ...run("plainSection", () =>
      extractPlainSectionObjects(input.docId, input.blocks, input.sectionTree)
    )
  );

  linkSequential(objects);
  if (warnings.length && objects.length) {
    objects[0].warnings = [...(objects[0].warnings ?? []), ...warnings];
  }
  return objects;
}

function linkSequential(objects: KnowledgeObject[]): void {
  for (let i = 0; i < objects.length; i++) {
    if (i > 0) objects[i].prevObjectId = objects[i - 1].id;
    if (i < objects.length - 1) objects[i].nextObjectId = objects[i + 1].id;
  }
}
