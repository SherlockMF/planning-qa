// ============================================================================
// 批次创建时固化的模型 / RAG 配置快照（用于可比性门禁）
// ============================================================================

import { getEmbeddingProvider } from "../ai/embedding.ts";
import { DEFAULT_CITY } from "../city.ts";

export function captureModelConfigSnapshot(): Record<
  string,
  string | number | boolean | null
> {
  return {
    llmProvider: process.env.ZHIPU_API_KEY
      ? "zhipu"
      : process.env.LLM_API_URL
        ? "remote"
        : "mock",
    llmModel:
      process.env.ZHIPU_LLM_MODEL ??
      process.env.LLM_MODEL ??
      "mock-llm",
    embedding: getEmbeddingProvider().signature,
  };
}

export function captureRagConfigSnapshot(): Record<
  string,
  string | number | boolean | null
> {
  return {
    city: DEFAULT_CITY,
    // 与线上评测一致的固定并发；变更并发不算答案语义，但影响限流行为，纳入快照
    evaluationConcurrency: 3,
  };
}
