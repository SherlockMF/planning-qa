export interface AnswerValueAssertionSpec {
  expectedAnswerValues?: string[];
  forbiddenAnswerValues?: string[];
}

export interface AnswerValueAssertionResult {
  pass: boolean;
  missingValues: string[];
  forbiddenValuesFound: string[];
}

export function checkAnswerValueAssertions(
  answer: string,
  spec: AnswerValueAssertionSpec
): AnswerValueAssertionResult {
  const missingValues = (spec.expectedAnswerValues ?? []).filter(
    (value) => !answer.includes(value)
  );
  const forbiddenValuesFound = (spec.forbiddenAnswerValues ?? []).filter((value) =>
    answer.includes(value)
  );

  return {
    pass: missingValues.length === 0 && forbiddenValuesFound.length === 0,
    missingValues,
    forbiddenValuesFound,
  };
}
