import type { AuditReviewItem, AutoReviewRun } from "./types.ts";
import type { Document } from "../types.ts";

export const SPLIT_REMEDIATION_REMINDER =
  "本轮只识别切分风险，不修复切分结果；表格仍应按表格结构优化切分。";

export interface RenderReviewArtifactInput {
  document: Document;
  items: AuditReviewItem[];
  autoReview: AutoReviewRun;
}

export function renderReviewArtifact(input: RenderReviewArtifactInput): {
  markdown: string;
  html: string;
} {
  const automaticReviewer = input.autoReview.provider
    ? `${input.autoReview.provider.name} / ${input.autoReview.provider.model}`
    : "确定性规则";
  const itemSections = input.items.map((item) => {
    const result = input.autoReview.items.find((entry) => entry.auditItemId === item.auditItemId);
    return {
      title: safe(item.title || item.auditItemId),
      objectType: safe(item.objectType),
      content: safe(item.content),
      risk: safe(result ? `${result.riskLevel} / ${result.riskScore}` : "unavailable"),
      issueTypes: safe(result?.issueTypes.join(", ") || "无"),
      summary: safe(result?.summary || "无自动审核结果"),
      unavailableReason: safe(result?.unavailableReason || "无"),
      evidence: safe(result?.ruleSignals.map((signal) => signal.evidence).join("；") || "无"),
      source: safe(formatSource(item)),
    };
  });

  const markdown = [
    `# 审核归档：${safe(input.document.fileName)}`,
    "",
    "## 自动审核",
    "",
    `- 自动审核主体：${safe(automaticReviewer)}`,
    `- 自动审核模式：${safe(input.autoReview.mode)}`,
    `- 自动审核时间：${safe(input.autoReview.finishedAt)}`,
    `- 自动疑似问题数：${input.autoReview.summary.suspectedCount}`,
    `- 自动审核不可用数：${input.autoReview.summary.unavailableCount}`,
    "",
    "## 人工审核",
    "",
    "- 人工审核状态：待开始",
    "- 人工确认问题数：待审核",
    "",
    ...itemSections.flatMap((item, index) => [
      `## 审核项 ${index + 1}：${item.title}`,
      "",
      `- 对象类型：${item.objectType}`,
      `- 自动风险：${item.risk}`,
      `- 自动问题类型：${item.issueTypes}`,
      `- 自动审核说明：${item.summary}`,
      `- 自动审核不可用原因：${item.unavailableReason}`,
      `- 规则证据：${item.evidence}`,
      `- 来源定位：${item.source}`,
      "",
      item.content,
      "",
    ]),
    `> ${SPLIT_REMEDIATION_REMINDER}`,
    "",
  ].join("\n");

  const htmlItems = itemSections.map((item, index) => `
    <section>
      <h2>审核项 ${index + 1}：${item.title}</h2>
      <dl>
        <dt>对象类型</dt><dd>${item.objectType}</dd>
        <dt>自动风险</dt><dd>${item.risk}</dd>
        <dt>自动问题类型</dt><dd>${item.issueTypes}</dd>
        <dt>自动审核说明</dt><dd>${item.summary}</dd>
        <dt>自动审核不可用原因</dt><dd>${item.unavailableReason}</dd>
        <dt>规则证据</dt><dd>${item.evidence}</dd>
        <dt>来源定位</dt><dd>${item.source}</dd>
      </dl>
      <pre>${item.content}</pre>
    </section>`).join("");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>审核归档：${safe(input.document.fileName)}</title>
<style>body{max-width:960px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#172033}section{border-top:1px solid #ccd3dd;padding:20px 0}dl{display:grid;grid-template-columns:10rem 1fr;gap:6px 16px}dt{font-weight:700}dd{margin:0}pre{white-space:pre-wrap;background:#f5f7fa;padding:16px}.notice{border-left:4px solid #b45309;padding:12px 16px;background:#fffbeb}</style>
</head><body>
<h1>审核归档：${safe(input.document.fileName)}</h1>
<section><h2>自动审核</h2><dl>
<dt>自动审核主体</dt><dd>${safe(automaticReviewer)}</dd>
<dt>自动审核模式</dt><dd>${safe(input.autoReview.mode)}</dd>
<dt>自动审核时间</dt><dd>${safe(input.autoReview.finishedAt)}</dd>
<dt>自动疑似问题数</dt><dd>${input.autoReview.summary.suspectedCount}</dd>
<dt>自动审核不可用数</dt><dd>${input.autoReview.summary.unavailableCount}</dd>
</dl></section>
<section><h2>人工审核</h2><dl><dt>人工审核状态</dt><dd>待开始</dd><dt>人工确认问题数</dt><dd>待审核</dd></dl></section>
${htmlItems}
<p class="notice">${SPLIT_REMEDIATION_REMINDER}</p>
</body></html>`;

  return { markdown, html };
}

function formatSource(item: AuditReviewItem): string {
  return [
    item.source.pageStart ? `页 ${item.source.pageStart}${item.source.pageEnd && item.source.pageEnd !== item.source.pageStart ? `-${item.source.pageEnd}` : ""}` : undefined,
    item.source.tableId ? `表 ${item.source.tableId}` : undefined,
    item.source.rowIndex !== undefined ? `行 ${item.source.rowIndex}` : undefined,
    item.source.blockIds.length ? `Block ${item.source.blockIds.join(", ")}` : undefined,
  ].filter(Boolean).join(" / ") || "无来源定位";
}

function safe(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
