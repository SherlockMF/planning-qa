export type FeedbackType = "helpful" | "not_helpful" | "need_human";

export interface FeedbackRecord {
  targetId: string;
  type: FeedbackType;
  userId?: string;
  submittedAt: string;
}

const feedbackStore = new Map<string, FeedbackRecord>();

export function saveFeedbackRecord(input: {
  targetId: string;
  type: FeedbackType;
  userId?: string;
}): FeedbackRecord {
  const record: FeedbackRecord = {
    targetId: input.targetId,
    type: input.type,
    userId: input.userId,
    submittedAt: new Date().toISOString(),
  };
  feedbackStore.set(input.targetId, record);
  return record;
}

export function getFeedbackRecord(targetId: string): FeedbackRecord | undefined {
  return feedbackStore.get(targetId);
}
