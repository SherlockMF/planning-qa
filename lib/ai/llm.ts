// ============================================================================
// LLM 服务层（可替换）
// ----------------------------------------------------------------------------
// 默认提供一个「抽取式」mock LLM：它只会复述传入 chunks 的原文，绝不引入
// 模型常识或编造内容 —— 这正是本产品的安全底线。接入真实 LLM 时实现
// LLMProvider 接口并在 getLLMProvider() 切换即可。
// ============================================================================

import type { Chunk } from "@/lib/types";
import { addApiUsage, addEstimatedTokens, isTracking } from "./usage.ts";

/** 传给 LLM 的检索上下文片段。 */
export interface ContextChunk {
  index: number;
  fileName: string;
  city: string;
  sectionPath?: string;
  articleNo?: string;
  pageNumber?: number;
  structuredContext?: string;
  content: string;
}

export interface SynthesizeInput {
  question: string;
  city?: string;
  chunks: ContextChunk[];
}

export interface LLMProvider {
  readonly name: string;
  /** 根据问题与上下文片段生成「结论」正文（仅结论部分，依据/注意由模板拼接）。 */
  synthesizeConclusion(input: SynthesizeInput): Promise<string>;
}

/** 强约束系统提示词（真实 LLM 使用）。 */
export const SYSTEM_PROMPT = `你是控规/国土空间规划法规问答助手。
你只能根据提供的知识库片段回答问题。
如果片段中没有明确依据，请拒答。
不得使用常识、经验或模型记忆补充法规结论。
不得编造文件名、章节、条款、页码或数值。
回答必须包含结论、依据和注意事项。
如果用户问题涉及规划条件冲突判断、指标组合可行性、审批结论、投资测算、CAD/GIS解析，请拒答。

输出要求：
- 只输出【结论】正文部分，不要重复依据与注意事项。
- 结论中引用的每一个数值、定义、条款，都必须能在给定片段中找到。
- 不要使用"通常为""一般来说""行业经验是"等表述。

版本处理规则：
- 若同主题存在多份文件（version.effectiveDate 字段不同），以生效日期最新的文件为主要依据，
  同时在结论末尾注明"另有旧版本存在，以本结论引用的版本为准"。
- 若片段未携带生效日期，仍正常作答，不需额外提示。

表格相关约束（重要）：
- 不要手工重写或编造表格，不要输出 Markdown 表格（| --- | 形式）。
- 表格内容由系统根据命中的表格行自动渲染，你只需生成表格前后的解释文字，
  例如"相关条目如下："或对若干行的简要说明。
- 如果系统已附带表格，不要重复抄写表格里的字段、数值、单元格内容。
- 不得编造表格行、字段名、页码或指标值。`;

/** 把上下文片段拼成提示词中的引用块。对 PDF 碎片文本做轻量清洗，减少噪声。 */
export function buildContextBlock(chunks: ContextChunk[]): string {
  return chunks
    .map((c) => {
      const meta = [
        `片段[${c.index}]`,
        `文件：${c.fileName}`,
        c.sectionPath ? `章节：${c.sectionPath}` : null,
        c.articleNo ? `条款：${c.articleNo}` : null,
        c.pageNumber != null ? `页码：第${c.pageNumber}页` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      // 清理 PDF 提取产生的噪声：多余空格、页脚符、换行抖动
      const clean = c.content
        .replace(/—\d+—/g, "")
        .replace(/\[\[page:\d+\]\]/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const structured = c.structuredContext
        ? `\nstructured_metadata:\n${c.structuredContext}`
        : "";
      return `${meta}${structured}\n原文：${clean}`;
    })
    .join("\n\n---\n\n");
}

/**
 * 抽取式 mock LLM：
 * 选取最相关片段的原文作为结论主体，仅做轻量改写连接，绝不编造。
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock-extractive-llm";

  async synthesizeConclusion(input: SynthesizeInput): Promise<string> {
    const { chunks } = input;
    if (chunks.length === 0) {
      return "";
    }
    const primary = chunks[0];
    const lines: string[] = [primary.content.trim()];

    const second = chunks[1];
    if (second && hasStrongOverlap(input.question, second.content, primary.content)) {
      lines.push(`此外，${extractCoreSentence(second.content, input.question)}`);
    }
    const text = lines.join("");
    if (isTracking()) {
      addEstimatedTokens(
        input.question,
        ...chunks.map((c) => c.content),
        text
      );
    }
    return text;
  }
}

/** 判断候选片段是否与问题强相关（共享具体用地代码/用地类型/数值），且不与主片段重复。 */
function hasStrongOverlap(
  question: string,
  candidate: string,
  primary: string
): boolean {
  const SPECIFIC_RE =
    /[A-Za-z]\d{1,2}|[一二三四]类居住用地|商业用地|商务金融用地|工业用地|\d+(?:\.\d+)?\s*(?:%|％|平方米|米|个|户)/g;
  const qTokens = new Set((question.match(SPECIFIC_RE) ?? []).map((s) => s.toUpperCase()));
  if (qTokens.size === 0) return false;
  const cTokens = new Set((candidate.match(SPECIFIC_RE) ?? []).map((s) => s.toUpperCase()));
  for (const t of qTokens) {
    if (cTokens.has(t) && !primary.toUpperCase().includes(t)) return true;
  }
  return false;
}

/**
 * 真实 LLM Provider 占位实现（OpenAI 兼容 Chat Completions）。
 * 设置 LLM_API_URL / LLM_API_KEY / LLM_MODEL 后启用。
 */
export class RemoteLLMProvider implements LLMProvider {
  readonly name = "remote-llm";
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(url: string, apiKey: string, model: string) {
    this.url = url;
    this.apiKey = apiKey;
    this.model = model;
  }

  async synthesizeConclusion(input: SynthesizeInput): Promise<string> {
    const context = buildContextBlock(input.chunks);
    const user = `用户城市：${input.city ?? "未指定"}
用户问题：${input.question}

可用知识库片段：
${context}

请仅依据以上片段，输出【结论】正文。`;

    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM API error: ${res.status}`);
    }
    const data = await res.json();
    addApiUsage(data.usage);
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

/**
 * 智谱 GLM LLM Provider（开放平台 v4 接口，OpenAI 风格 Chat Completions）。
 * 端点：https://open.bigmodel.cn/api/paas/v4/chat/completions
 * 鉴权：Authorization: Bearer <ZHIPU_API_KEY>（v4 直接使用 API Key，无需 JWT 签名）。
 */
export class ZhipuLLMProvider implements LLMProvider {
  readonly name = "zhipu-glm";
  private url =
    process.env.ZHIPU_API_URL ??
    "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  /** GLM 返回空时自动降级为抽取式 mock，避免误拒答。 */
  private readonly fallback = new MockLLMProvider();
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async synthesizeConclusion(input: SynthesizeInput): Promise<string> {
    const context = buildContextBlock(input.chunks);
    const user = `用户城市：${input.city ?? "未指定"}
用户问题：${input.question}

可用知识库片段：
${context}

请仅依据以上片段，用1-3句话直接给出结论。不要输出"抱歉"，不要重复依据格式。`;

    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: 512,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Zhipu GLM API error: ${res.status} ${detail}`);
    }
    const data = await res.json();
    addApiUsage(data.usage);
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";

    // GLM 返回空 → fallback 到抽取式 mock（零编造，原文复述）
    if (!text) return this.fallback.synthesizeConclusion(input);
    return text;
  }
}

/** 从片段中抽取与问题最相关的一句话作为结论核心。 */
function extractCoreSentence(content: string, question: string): string {
  const sentences = content
    .split(/(?<=[。；;！!])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return content.trim();

  const qTokens = new Set(
    (question.toLowerCase().match(/[一-龥a-z0-9]+/g) ?? []).flatMap((w) =>
      w.length > 1 ? [w, ...splitHan(w)] : [w]
    )
  );
  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    let score = 0;
    for (const t of qTokens) {
      if (t && s.toLowerCase().includes(t)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  // 若问题命中明显，返回命中句；否则返回整段，避免遗漏关键定义。
  return bestScore > 0 ? best : content.trim();
}

function splitHan(w: string): string[] {
  const han = w.match(/[一-龥]/g);
  return han ?? [];
}

let provider: LLMProvider | null = null;

/**
 * 获取当前 LLM Provider（单例）。优先级：
 *   1. 智谱 GLM（设置了 ZHIPU_API_KEY）
 *   2. 通用 OpenAI 兼容端点（设置了 LLM_API_URL/KEY/MODEL）
 *   3. 内置 mock（抽取式，零外部依赖）
 */
export function getLLMProvider(): LLMProvider {
  if (provider) return provider;

  const zhipuKey = process.env.ZHIPU_API_KEY;
  if (zhipuKey) {
    const model = process.env.ZHIPU_LLM_MODEL ?? "glm-4.6";
    provider = new ZhipuLLMProvider(zhipuKey, model);
    return provider;
  }

  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (url && key && model) {
    provider = new RemoteLLMProvider(url, key, model);
  } else {
    provider = new MockLLMProvider();
  }
  return provider;
}

/** 工具：把 Chunk 转为 ContextChunk。 */
export function toContextChunk(chunk: Chunk, index: number): ContextChunk {
  return {
    index,
    fileName: chunk.fileName,
    city: chunk.city,
    sectionPath: chunk.sectionPath,
    articleNo: chunk.articleNo,
    pageNumber: chunk.pageNumber,
    structuredContext: buildStructuredContext(chunk),
    content: chunk.displayText ?? chunk.content,
  };
}

function buildStructuredContext(chunk: Chunk): string | undefined {
  const lines: string[] = [];
  add(lines, "objectId", chunk.objectId);
  add(lines, "objectType", chunk.objectType);
  add(lines, "chunkType", chunk.chunkType);
  add(lines, "chunkRole", chunk.chunkRole);
  add(lines, "clauseNo", chunk.clauseNo);
  add(lines, "normativeLevel", chunk.normativeLevel);
  add(lines, "mandatory", chunk.mandatory == null ? undefined : String(chunk.mandatory));
  add(lines, "code", chunk.code);
  add(lines, "parentCode", chunk.parentCode);
  add(lines, "itemName", chunk.itemName);
  add(lines, "tableId", chunk.tableId ?? chunk.sourceTableId);
  add(lines, "tableTitle", chunk.tableTitle);
  add(lines, "tableType", chunk.tableType);
  add(lines, "sourceRowIndex", chunk.sourceRowIndex == null ? undefined : String(chunk.sourceRowIndex));
  add(lines, "rowKey", chunk.rowKey);

  if (chunk.fields) {
    for (const [key, value] of Object.entries(chunk.fields)) {
      add(lines, `field.${key}`, value);
    }
  }

  if (chunk.versionInfo) {
    for (const [key, value] of Object.entries(chunk.versionInfo)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        add(lines, `version.${key}`, String(value));
      }
    }
  }

  return lines.length ? lines.join("\n") : undefined;
}

function add(lines: string[], key: string, value: string | undefined): void {
  const clean = value?.trim();
  if (clean) lines.push(`${key}=${clean}`);
}
