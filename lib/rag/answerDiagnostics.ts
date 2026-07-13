export interface AnswerDiagnostics {
  rawConclusion: string;
  sanitizedConclusion: string;
  displayConclusion: string;
  fallbackReasons: string[];
  wasReplaced: boolean;
}

export function buildAnswerDiagnostics(input: {
  rawConclusion: string;
  sanitizedConclusion: string;
  displayConclusion: string;
  fallbackReasons: string[];
}): AnswerDiagnostics | undefined {
  const rawConclusion = input.rawConclusion.trim();
  const sanitizedConclusion = input.sanitizedConclusion.trim();
  const displayConclusion = input.displayConclusion.trim();
  const wasReplaced =
    sanitizedConclusion.length > 0 && sanitizedConclusion !== displayConclusion;

  if (!rawConclusion && !wasReplaced && input.fallbackReasons.length === 0) {
    return undefined;
  }

  return {
    rawConclusion,
    sanitizedConclusion,
    displayConclusion,
    fallbackReasons: input.fallbackReasons,
    wasReplaced,
  };
}
