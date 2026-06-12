// ============================================================================
// Embedding 服务层（可替换）
// ----------------------------------------------------------------------------
// 默认提供一个本地确定性 mock embedding，用于在没有真实 Embedding API 时
// 跑通向量检索链路。接入真实服务时，只需实现 EmbeddingProvider 接口并在
// getEmbeddingProvider() 中切换即可，上层 RAG 代码无需改动。
// ============================================================================

import { addApiUsage, addEstimatedTokens, isTracking } from "./usage.ts";

export const EMBEDDING_DIM = 256;

export interface EmbeddingProvider {
  readonly name: string;
  /** 提供方+模型指纹。落盘 chunk 时记录，加载时不一致则视为向量失效需重建。 */
  readonly signature: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/** 简单中文/英文分词：抽取连续中文片段（按 2-gram）与英文/数字词。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();

  // 英文单词与数字
  const latin = normalized.match(/[a-z0-9]+/g);
  if (latin) tokens.push(...latin);

  // 中文：抽取每个中文字符，并生成 2-gram（更接近词义）
  const han = normalized.match(/[一-龥]/g);
  if (han) {
    tokens.push(...han);
    for (let i = 0; i < han.length - 1; i++) {
      tokens.push(han[i] + han[i + 1]);
    }
  }
  return tokens;
}

/** 稳定字符串哈希（FNV-1a 变体）。 */
function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 本地确定性 mock embedding：
 * 将分词后的 token 哈希到固定维度的稀疏向量并做 L2 归一化。
 * 共享 token 越多，cosine 相似度越高 —— 足以演示向量检索效果。
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock-local-embedding";
  readonly signature = `mock-local-embedding:${EMBEDDING_DIM}`;

  async embed(text: string): Promise<number[]> {
    const vec = this.compute(text);
    if (isTracking()) addEstimatedTokens(text);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out = texts.map((t) => this.compute(t));
    if (isTracking()) addEstimatedTokens(...texts);
    return out;
  }

  private compute(text: string): number[] {
    const vec = new Array<number>(EMBEDDING_DIM).fill(0);
    const tokens = tokenize(text);
    for (const t of tokens) {
      const idx = hashToken(t) % EMBEDDING_DIM;
      const sign = (hashToken(t + "#") & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return vec.map((v) => v / norm);
  }
}

/**
 * 真实 Embedding Provider 占位实现示例（OpenAI 兼容接口）。
 * 设置 EMBEDDING_API_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL 后启用。
 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly name = "remote-embedding";
  readonly signature: string;
  constructor(
    private url: string,
    private apiKey: string,
    private model: string
  ) {
    this.signature = `remote-embedding:${model}`;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Embedding API error: ${res.status}`);
    }
    const data = await res.json();
    addApiUsage(data.usage);
    return data.data.map((d: { embedding: number[] }) => d.embedding);
  }
}

/**
 * 智谱 GLM Embedding Provider（开放平台 v4，OpenAI 风格 /embeddings）。
 * 端点：https://open.bigmodel.cn/api/paas/v4/embeddings
 * 默认模型 embedding-3。鉴权同 LLM：Authorization: Bearer <ZHIPU_API_KEY>。
 */
export class ZhipuEmbeddingProvider implements EmbeddingProvider {
  readonly name = "zhipu-embedding";
  readonly signature: string;
  private url =
    process.env.ZHIPU_EMBEDDING_API_URL ??
    "https://open.bigmodel.cn/api/paas/v4/embeddings";

  constructor(
    private apiKey: string,
    private model: string
  ) {
    this.signature = `zhipu-embedding:${model}`;
  }

  // 智谱 embeddings 单次请求的 input 数量上限，分批发送以支持大文档
  private static readonly BATCH = 16;
  // 单条文本字符上限：智谱 embedding-3 拒绝过长输入（实测约数千字即报 1210），保守截断
  private static readonly MAX_CHARS = 1500;

  /** 清洗输入：去首尾空白、空串替换为占位、超长截断，避免触发智谱 1210 参数错误。 */
  private sanitize(texts: string[]): string[] {
    return texts.map((t) => {
      let s = (t ?? "").trim();
      if (s.length === 0) s = "（空）";
      if (s.length > ZhipuEmbeddingProvider.MAX_CHARS) {
        s = s.slice(0, ZhipuEmbeddingProvider.MAX_CHARS);
      }
      return s;
    });
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.request([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += ZhipuEmbeddingProvider.BATCH) {
      const slice = texts.slice(i, i + ZhipuEmbeddingProvider.BATCH);
      const vecs = await this.request(slice);
      out.push(...vecs);
    }
    return out;
  }

  private async request(input: string[]): Promise<number[][]> {
    const safe = this.sanitize(input);
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: safe }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zhipu Embedding API error: ${res.status} ${detail}`);
    }
    const data = await res.json();
    addApiUsage(data.usage);
    // 按 index 排序，确保与输入顺序一致
    const items = (data.data ?? []) as { index: number; embedding: number[] }[];
    return items
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

let provider: EmbeddingProvider | null = null;

/**
 * 获取当前 Embedding Provider（单例）。优先级：
 *   1. 智谱 GLM（设置了 ZHIPU_API_KEY）
 *   2. 通用 OpenAI 兼容端点（设置了 EMBEDDING_API_URL/KEY/MODEL）
 *   3. 内置 mock（确定性伪向量，零外部依赖）
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;

  const zhipuKey = process.env.ZHIPU_API_KEY;
  if (zhipuKey) {
    const model = process.env.ZHIPU_EMBEDDING_MODEL ?? "embedding-3";
    provider = new ZhipuEmbeddingProvider(zhipuKey, model);
    return provider;
  }

  const url = process.env.EMBEDDING_API_URL;
  const key = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (url && key && model) {
    provider = new RemoteEmbeddingProvider(url, key, model);
  } else {
    provider = new MockEmbeddingProvider();
  }
  return provider;
}

/** 余弦相似度。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // 假定输入向量已 L2 归一化；否则结果仍单调可用
  return dot;
}
