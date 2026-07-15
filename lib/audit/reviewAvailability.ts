export type ReviewAvailability =
  | { canSubmit: true }
  | { canSubmit: false; error: string };

export function evaluateReviewAvailability(input: {
  integrityOk: boolean;
  sourceMatches: boolean;
  finalizedAt?: string;
}): ReviewAvailability {
  if (!input.integrityOk) {
    return { canSubmit: false, error: "审核副本完整性校验失败" };
  }
  if (!input.sourceMatches) {
    return { canSubmit: false, error: "原文件已变化，旧快照不能提交" };
  }
  if (input.finalizedAt !== undefined) {
    return { canSubmit: false, error: "审核结果已提交" };
  }
  return { canSubmit: true };
}
