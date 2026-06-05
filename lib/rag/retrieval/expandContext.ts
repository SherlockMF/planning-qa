import type { KnowledgeObject } from "../objects";

export function expandContext(
  hits: KnowledgeObject[],
  allObjects: KnowledgeObject[]
): KnowledgeObject[] {
  const byId = new Map(allObjects.map((obj) => [obj.id, obj]));
  const out = new Map<string, KnowledgeObject>();

  const add = (obj: KnowledgeObject | undefined) => {
    if (obj) out.set(obj.id, obj);
  };

  for (const hit of hits) {
    add(hit);
    add(hit.parentObjectId ? byId.get(hit.parentObjectId) : undefined);
    add(hit.prevObjectId ? byId.get(hit.prevObjectId) : undefined);
    add(hit.nextObjectId ? byId.get(hit.nextObjectId) : undefined);
    for (const childId of hit.childObjectIds ?? []) add(byId.get(childId));

    if (
      hit.objectType === "classification_code" &&
      "parentCode" in hit &&
      hit.parentCode
    ) {
      for (const obj of allObjects) {
        if (obj.objectType === "classification_code" && obj.code === hit.parentCode) add(obj);
      }
    }
  }

  return [...out.values()];
}
