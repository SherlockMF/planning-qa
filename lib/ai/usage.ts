// ============================================================================
// 单次请求 Token 用量追踪（AsyncLocalStorage）
// ----------------------------------------------------------------------------
// 评测逐题运行时，在 withUsageTracking 作用域内汇总 LLM / Embedding 的
// API usage；mock 模式下按字符数粗估。支持并发评测 worker（每题独立上下文）。
// ============================================================================

import { AsyncLocalStorage } from "async_hooks";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const als = new AsyncLocalStorage<TokenUsage>();

export async function withUsageTracking<T>(
  fn: () => Promise<T>
): Promise<{
  value?: T;
  usage: TokenUsage;
  durationMs: number;
  error?: unknown;
}> {
  const usage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const t0 = Date.now();
  try {
    const value = await als.run(usage, fn);
    return { value, usage: { ...usage }, durationMs: Date.now() - t0 };
  } catch (error) {
    return {
      usage: { ...usage },
      durationMs: Date.now() - t0,
      error,
    };
  }
}

/** 累加 API 返回的 usage 字段（OpenAI / 智谱兼容格式）。 */
export function addApiUsage(raw?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): void {
  const store = als.getStore();
  if (!store || !raw) return;
  const p = raw.prompt_tokens ?? 0;
  const c = raw.completion_tokens ?? 0;
  const t = raw.total_tokens ?? p + c;
  store.promptTokens += p;
  store.completionTokens += c;
  store.totalTokens += t;
}

/** mock 或未返回 usage 时，按文本长度粗估 token（中英文混合约 2 字符/token）。 */
export function addEstimatedTokens(...texts: (string | undefined)[]): void {
  const store = als.getStore();
  if (!store) return;
  const chars = texts.reduce((n, t) => n + (t?.length ?? 0), 0);
  if (chars <= 0) return;
  const est = Math.max(1, Math.ceil(chars / 2));
  store.promptTokens += est;
  store.totalTokens += est;
}

export function isTracking(): boolean {
  return als.getStore() != null;
}
