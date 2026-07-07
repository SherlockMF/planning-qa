import type { KnowledgeObject } from "../objects";
import { buildExactIndex, normalizeExactKey } from "../retrieval/exactIndex.ts";
import {
  GOLDEN_QUESTIONS,
  NUMERIC_GOLDEN_QUESTIONS,
  type NumericGoldenQuestion,
} from "./goldenQuestions.ts";
import { checkAnswerValueAssertions } from "./answerValueAssertions.ts";

export type EvalResult = {
  query: string;
  expectedObjectTypes: string[];
  expectedKeywords: string[];
  topKObjectTypes: string[];
  hit: boolean;
  notes?: string;
};

export type NumericAnswerEvalResult = {
  query: string;
  sourceHint: string;
  expectedAnswerValues: string[];
  forbiddenAnswerValues: string[];
  answer: string;
  pass: boolean;
  missingValues: string[];
  forbiddenValuesFound: string[];
  error?: string;
};

export type NumericObjectEvalResult = NumericAnswerEvalResult & {
  matchedObjectIds: string[];
  matchedPages: number[];
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

export async function runNumericAnswerEval(
  answerQuestion: (query: string) => Promise<string>,
  questions: NumericGoldenQuestion[] = NUMERIC_GOLDEN_QUESTIONS
): Promise<NumericAnswerEvalResult[]> {
  const results: NumericAnswerEvalResult[] = [];
  for (const question of questions) {
    try {
      const answer = await answerQuestion(question.query);
      const assertion = checkAnswerValueAssertions(answer, question);
      results.push({
        query: question.query,
        sourceHint: question.sourceHint,
        expectedAnswerValues: question.expectedAnswerValues,
        forbiddenAnswerValues: question.forbiddenAnswerValues ?? [],
        answer,
        pass: assertion.pass,
        missingValues: assertion.missingValues,
        forbiddenValuesFound: assertion.forbiddenValuesFound,
      });
    } catch (error) {
      results.push({
        query: question.query,
        sourceHint: question.sourceHint,
        expectedAnswerValues: question.expectedAnswerValues,
        forbiddenAnswerValues: question.forbiddenAnswerValues ?? [],
        answer: "",
        pass: false,
        missingValues: question.expectedAnswerValues,
        forbiddenValuesFound: [],
        error: String(error),
      });
    }
  }
  return results;
}

export function runNumericObjectEval(
  objects: KnowledgeObject[],
  questions: NumericGoldenQuestion[] = NUMERIC_GOLDEN_QUESTIONS
): NumericObjectEvalResult[] {
  return questions.map((question) => {
    const expectedTypes = new Set(question.expectedObjectTypes);
    const normalizedKeywords = question.expectedKeywords.map(normalizeExactKey);
    const matches = objects.filter((obj) => {
      if (!expectedTypes.has(obj.objectType)) return false;
      const text = normalizeExactKey(knowledgeObjectText(obj));
      return normalizedKeywords.every((keyword) => text.includes(keyword));
    });
    const answer = matches.map(knowledgeObjectText).join("\n");
    const assertion = checkAnswerValueAssertions(answer, question);
    return {
      query: question.query,
      sourceHint: question.sourceHint,
      expectedAnswerValues: question.expectedAnswerValues,
      forbiddenAnswerValues: question.forbiddenAnswerValues ?? [],
      answer,
      pass: assertion.pass,
      missingValues: assertion.missingValues,
      forbiddenValuesFound: assertion.forbiddenValuesFound,
      matchedObjectIds: matches.map((obj) => obj.id),
      matchedPages: [
        ...new Set(
          matches
            .flatMap((obj) => obj.sourcePages ?? [obj.sourcePageStart])
            .filter((page): page is number => typeof page === "number")
        ),
      ],
    };
  });
}

function knowledgeObjectText(obj: KnowledgeObject): string {
  const parts = [obj.title, obj.content];
  const fields = "fields" in obj ? obj.fields : undefined;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      parts.push(`${key}：${value}`);
    }
  }
  return parts.filter(Boolean).join(" ");
}
