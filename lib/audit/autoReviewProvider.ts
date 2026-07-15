import type {
  AuditReviewItem,
  AutoIssueType,
  AutoRuleSignal,
  ModelAutoReviewAssessment,
} from "./types.ts";

const ISSUE_TYPES = new Set<AutoIssueType>([
  "reading_order_noise",
  "row_boundary_contamination",
  "column_misalignment",
  "merged_cell_scope_error",
  "missing_content",
  "source_mapping_error",
  "semantic_assignment_error",
  "other",
]);
const DEFAULT_ZHIPU_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_ZHIPU_MODEL = "glm-4v-flash";

export interface ReviewPageImage {
  mimeType: string;
  base64: string;
}

export interface AutoReviewProviderInput {
  item: AuditReviewItem;
  ruleSignals: AutoRuleSignal[];
  pageImage: ReviewPageImage;
}

export interface AutoReviewProvider {
  metadata: { name: string; model: string };
  review(input: AutoReviewProviderInput): Promise<ModelAutoReviewAssessment>;
}

export interface CreateAutoReviewProviderOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export async function parseModelAssessment(raw: string): Promise<ModelAutoReviewAssessment> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_auto_review_json");
  }
  if (!isRecord(value)) throw new Error("invalid_auto_review_response");
  if (value.status !== "clean" && value.status !== "suspected_issue") {
    throw new Error("invalid_auto_review_status");
  }
  if (typeof value.riskScore !== "number" || !Number.isFinite(value.riskScore)
    || value.riskScore < 0 || value.riskScore > 100) {
    throw new Error("invalid_auto_review_risk_score");
  }
  if (!Array.isArray(value.issueTypes)) throw new Error("invalid_auto_review_issue_types");
  if (value.issueTypes.length > 4) throw new Error("too_many_auto_review_issue_types");
  if (!value.issueTypes.every((issueType): issueType is AutoIssueType =>
    typeof issueType === "string" && ISSUE_TYPES.has(issueType as AutoIssueType)
  )) {
    throw new Error("invalid_auto_review_issue_type");
  }
  if (!isBoundedText(value.summary, 1, 600)) throw new Error("missing_auto_review_summary");
  if (!isBoundedText(value.sourceEvidence, 1, 1000)) {
    throw new Error("missing_auto_review_source_evidence");
  }
  return {
    status: value.status,
    riskScore: value.riskScore,
    issueTypes: value.issueTypes,
    summary: value.summary.trim(),
    sourceEvidence: value.sourceEvidence.trim(),
  };
}

export function createAutoReviewProvider(
  options: CreateAutoReviewProviderOptions = {},
): AutoReviewProvider | undefined {
  const env = options.env ?? process.env;
  if (env.AUTO_REVIEW_ENABLED !== "1") return undefined;

  const dedicatedKey = env.AUTO_REVIEW_API_KEY?.trim();
  const zhipuKey = env.ZHIPU_API_KEY?.trim();
  const apiKey = dedicatedKey || zhipuKey;
  if (!apiKey) return undefined;

  const usesDedicatedEndpoint = Boolean(dedicatedKey);
  const url = env.AUTO_REVIEW_API_URL?.trim()
    || (usesDedicatedEndpoint ? undefined : env.ZHIPU_API_URL?.trim() || DEFAULT_ZHIPU_URL);
  if (!url) return undefined;
  const model = env.AUTO_REVIEW_MODEL?.trim() || DEFAULT_ZHIPU_MODEL;
  const timeoutMs = positiveInteger(env.AUTO_REVIEW_TIMEOUT_MS, 30_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const metadata = {
    name: usesDedicatedEndpoint ? "auto_review_compatible" : "zhipu_auto_review",
    model,
  };

  return {
    metadata,
    async review(input) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: buildPrompt(input) },
              {
                type: "image_url",
                image_url: { url: `data:${input.pageImage.mimeType};base64,${input.pageImage.base64}` },
              },
            ],
          }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`auto_review_provider_http_${response.status}`);
      const payload: unknown = await response.json();
      const content = extractResponseContent(payload);
      return parseModelAssessment(content);
    },
  };
}

function buildPrompt(input: AutoReviewProviderInput): string {
  return [
    "你是独立的文档切分风险审核器。只对照原页和给定结构判断，不修改解析结果。",
    "只返回一个 JSON 对象，字段必须为 status、riskScore、issueTypes、summary、sourceEvidence。",
    'status 只能是 "clean" 或 "suspected_issue"；riskScore 为 0..100；issueTypes 最多 4 个。',
    `审核项：${JSON.stringify({
      auditItemId: input.item.auditItemId,
      objectType: input.item.objectType,
      title: input.item.title,
      content: input.item.content,
      source: input.item.source,
      tableContext: input.item.tableContext,
      ruleSignals: input.ruleSignals,
    })}`,
  ].join("\n");
}

function extractResponseContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("invalid_auto_review_provider_response");
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
    throw new Error("invalid_auto_review_provider_response");
  }
  return first.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
