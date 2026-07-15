import type { AuditManifest, AuditSourceItem } from "./types.ts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderReviewMarkdown(input: {
  manifest: Omit<AuditManifest, "files">;
  items: AuditSourceItem[];
}): string {
  const lines = [
    `# ${input.manifest.document.fileName} 审核副本`,
    "",
    `- Artifact: ${input.manifest.artifactId}`,
    `- Generated: ${input.manifest.generatedAt}`,
    `- Source SHA-256: ${input.manifest.document.sourceFileSha256}`,
    `- Focus items: ${input.manifest.summary.focusItemCount}`,
    "",
  ];

  for (const item of input.items) {
    lines.push(
      `## ${item.selectedForReview ? "[必审] " : ""}${item.title}`,
      "",
      `- auditItemId: ${item.auditItemId}`,
      `- objectType: ${item.objectType}`,
      `- page: ${item.sourcePageStart ?? "?"}-${item.sourcePageEnd ?? item.sourcePageStart ?? "?"}`,
      `- sourceBlocks: ${item.sourceBlockIds.join(", ") || "none"}`,
      `- chunks: ${item.chunkIds.join(", ") || "none"}`,
      `- RagTable: ${item.ragTableId ?? "none"}`,
      `- confidence: ${item.confidence.toFixed(2)}`,
      `- warnings: ${item.warnings.join(", ") || "none"}`,
      "",
      item.content,
      ""
    );
    if (item.sourceExcerpt) {
      lines.push("### Source Block 摘录", "", item.sourceExcerpt, "");
    }
    if (item.tableMarkdown) lines.push(item.tableMarkdown, "");
  }

  return `${lines.join("\n")}\n`;
}

export function renderReviewHtml(input: {
  documentId: string;
  artifactId: string;
  fileName: string;
  items: AuditSourceItem[];
}): string {
  const endpoint = `/api/documents/${encodeURIComponent(input.documentId)}/review-artifacts/${encodeURIComponent(input.artifactId)}/review`;
  const supportsPagePreview = /\.pdf$/i.test(input.fileName);
  const cards = input.items
    .map(
      (item) => `
    <article class="item" data-id="${escapeHtml(item.auditItemId)}" data-required="${item.selectedForReview}" data-search="${escapeHtml(`${item.title} ${item.content} ${item.sourceExcerpt ?? ""} ${item.tableMarkdown ?? ""}`.toLowerCase())}">
      <h2>${item.selectedForReview ? '<span class="required">必审</span>' : ""}${escapeHtml(item.title)}</h2>
      <p class="meta">${escapeHtml(item.objectType)} · 页 ${item.sourcePageStart ?? "?"}-${item.sourcePageEnd ?? item.sourcePageStart ?? "?"} · confidence ${item.confidence.toFixed(2)}</p>
      <p class="meta">Object ${escapeHtml(item.knowledgeObjectId)} · Chunk ${escapeHtml(item.chunkIds.join(", ") || "none")} · RagTable ${escapeHtml(item.ragTableId ?? "none")}</p>
      ${item.warnings.length ? `<p class="warning">${escapeHtml(item.warnings.join(", "))}</p>` : ""}
      ${supportsPagePreview && item.sourcePageStart ? `<p><a class="source-page" data-page="${item.sourcePageStart}" target="_blank" rel="noreferrer">查看原文页</a></p>` : ""}
      ${item.sourceExcerpt ? `<details><summary>Source Block 摘录</summary><pre>${escapeHtml(item.sourceExcerpt)}</pre></details>` : ""}
      <pre>${escapeHtml(item.content)}</pre>
      ${item.tableMarkdown ? `<pre class="table">${escapeHtml(item.tableMarkdown)}</pre>` : ""}
      <label>结论 <select class="status"><option value="">未审核</option><option value="passed">通过</option><option value="issue">有问题</option></select></label>
      <label>问题类型 <select class="issue"><option value="">请选择</option><option value="missing_content">内容缺失</option><option value="ocr_error">文本识别错误</option><option value="structure_error">章节或条款结构错误</option><option value="table_error">表格错列、漏行或合并错误</option><option value="source_location_error">原文页码或来源定位错误</option><option value="object_type_error">对象类型识别错误</option><option value="other">其他</option></select></label>
      <label>备注 <textarea class="comment" maxlength="2000"></textarea></label>
    </article>`
    )
    .join("\n");
  const safeEndpoint = JSON.stringify(endpoint).replaceAll("<", "\\u003c");
  const safeDocumentId = JSON.stringify(input.documentId).replaceAll(
    "<",
    "\\u003c"
  );

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.fileName)} 审核</title>
<style>body{font-family:system-ui;margin:0;background:#f8fafc;color:#1e293b}main{max-width:1040px;margin:auto;padding:24px}.toolbar{position:sticky;top:0;background:#fff;padding:12px;border:1px solid #cbd5e1}.item{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin:16px 0}.meta{color:#64748b;font-size:12px}.required,.warning{color:#b45309}pre{white-space:pre-wrap;background:#f1f5f9;padding:12px;overflow:auto}label{display:block;margin-top:10px}select,textarea,input{width:100%;padding:8px;box-sizing:border-box}button{margin:8px 8px 0 0;padding:8px 14px}</style></head>
<body><main><h1>${escapeHtml(input.fileName)} 审核副本</h1><div class="toolbar"><input id="search" placeholder="搜索全部审核项"><button id="save">保存草稿</button><button id="finalize">最终提交</button><span id="message"></span></div>${cards}</main>
<script>
const endpoint=${safeEndpoint};
const documentId=${safeDocumentId};
const userId=new URLSearchParams(location.search).get("userId")||"";
const api=endpoint+"?userId="+encodeURIComponent(userId);
document.querySelectorAll(".source-page").forEach(link=>{link.href="/api/documents/"+encodeURIComponent(documentId)+"/page?n="+encodeURIComponent(link.dataset.page)+"&userId="+encodeURIComponent(userId)});
const rows=[...document.querySelectorAll(".item")];
function collect(){return rows.map(row=>{const status=row.querySelector(".status").value;if(!status)return null;const issue=row.querySelector(".issue").value;return{auditItemId:row.dataset.id,status,issueTypes:issue?[issue]:[],comment:row.querySelector(".comment").value.trim()}}).filter(Boolean)}
function apply(result){for(const item of result.items||[]){const row=rows.find(x=>x.dataset.id===item.auditItemId);if(!row)continue;row.querySelector(".status").value=item.status;row.querySelector(".issue").value=item.issueTypes?.[0]||"";row.querySelector(".comment").value=item.comment||""}if(result.finalizedAt){document.querySelectorAll("select,textarea,button").forEach(x=>x.disabled=true)}}
async function request(action){const response=await fetch(api,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,items:collect()})});const data=await response.json();document.querySelector("#message").textContent=response.ok?(action==="finalize"?"已提交":"草稿已保存"):(data.error||"保存失败");if(response.ok)apply(data.result)}
document.querySelector("#save").onclick=()=>request("save_draft");document.querySelector("#finalize").onclick=()=>request("finalize");document.querySelector("#search").oninput=e=>{const q=e.target.value.toLowerCase();rows.forEach(row=>row.hidden=!row.dataset.search.includes(q))};
fetch(api,{cache:"no-store"}).then(r=>r.json()).then(data=>{if(data.result)apply(data.result);if(data.canSubmit===false){document.querySelector("#message").textContent=data.error||"当前快照不可提交";document.querySelectorAll("select,textarea,button").forEach(x=>x.disabled=true)}});
</script></body></html>`;
}
