import type { ChatResponse, RetrievedChunk } from "@/lib/types";

export function buildNoAccessChatResponse(topic?: string): ChatResponse {
  const subject = topic?.trim() || "相关项目资料";
  const answer = [
    "【无法确定】",
    `系统检索到可能与「${subject}」相关的项目资料，但当前账号无权访问，因此不能基于这些资料生成回答。`,
    "",
    "【原因】",
    "该资料属于受限项目知识，未授权用户不能查看原文、引用片段或派生结论。",
    "",
    "【建议】",
    "请切换到已授权项目成员、项目负责人或管理员账号；如确需访问，请联系项目负责人或知识库管理员开通项目权限。",
  ].join("\n");

  return {
    answer,
    foundEvidence: false,
    citations: [],
    refusalReason: "无权访问相关资料",
    confidence: "low",
    confidenceLabel: "权限不足 · 未泄露受限依据",
    noAccess: true,
    feedbackTargetId: `no-access-${Date.now()}`,
  };
}

export function shouldReturnNoAccess(
  accessibleTop: RetrievedChunk[],
  deniedTop: RetrievedChunk[]
): boolean {
  if (deniedTop.length === 0) return false;
  if (accessibleTop.length === 0) return true;

  const denied = deniedTop[0];
  const accessible = accessibleTop[0];
  const deniedStrong =
    denied.source === "exact" ||
    denied.source === "hybrid" ||
    denied.keywordScore >= 0.2 ||
    denied.matchedKeywords.length > 0;
  const accessibleStrong =
    accessible.source === "exact" ||
    accessible.source === "hybrid" ||
    accessible.keywordScore >= 0.2 ||
    accessible.matchedKeywords.length > 0;

  return deniedStrong && (!accessibleStrong || denied.rerankScore > accessible.rerankScore);
}
