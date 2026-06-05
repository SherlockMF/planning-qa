import type { KnowledgeObject } from "../objects";
import { buildExactIndex, normalizeExactKey } from "../retrieval/exactIndex.ts";
import { GOLDEN_QUESTIONS } from "./goldenQuestions.ts";

export type EvalResult = {
  query: string;
  expectedObjectTypes: string[];
  expectedKeywords: string[];
  topKObjectTypes: string[];
  hit: boolean;
  notes?: string;
};

export function runObjectEval(objects: KnowledgeObject[]): EvalResult[] {
  const exact = buildExactIndex(objects);
  return GOLDEN_QUESTIONS.map((question) => {
    const normalizedKeywords = question.expectedKeywords.map(normalizeExactKey);
    const objectIds = new Set(
      exact
        .filter((entry) => normalizedKeywords.some((keyword) => entry.normalizedKey.includes(keyword) || keyword.includes(entry.normalizedKey)))
        .map((entry) => entry.objectId)
    );
    const top = objects.filter((obj) => objectIds.has(obj.id)).slice(0, 5);
    const topKObjectTypes: string[] = top.map((obj) => obj.objectType);
    const hit = question.expectedObjectTypes.some((type) => topKObjectTypes.includes(type));
    return {
      query: question.query,
      expectedObjectTypes: question.expectedObjectTypes,
      expectedKeywords: question.expectedKeywords,
      topKObjectTypes,
      hit,
      notes: hit ? undefined : "expected object type not found in exact-key preview",
    };
  });
}
