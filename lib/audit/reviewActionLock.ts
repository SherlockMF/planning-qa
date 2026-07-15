export type ReviewActionLock = { current: boolean };

export function tryAcquireReviewActionLock(lock: ReviewActionLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseReviewActionLock(lock: ReviewActionLock): void {
  lock.current = false;
}
