import type { Document, KnowledgeUser, RetrievedChunk } from "../types.ts";
import { KNOWLEDGE_ROLES } from "../knowledge/permissions.ts";

export interface RetrieveDebugSummary {
  userLabel: string;
  accessibleHitCount: number;
  deniedHitCount: number;
  accessibleDocuments: string[];
  deniedDocuments: string[];
  riskLabel: string;
  explanation: string;
}

export function buildRetrieveDebugSummary({
  user,
  documents,
  mergedTop,
  deniedTop,
}: {
  user: KnowledgeUser;
  documents: Document[];
  mergedTop: RetrievedChunk[];
  deniedTop: RetrievedChunk[];
}): RetrieveDebugSummary {
  const docsById = new Map(documents.map((doc) => [doc.id, doc]));
  const accessibleDocuments = uniqueDocNames(mergedTop, docsById);
  const deniedDocuments = uniqueDocNames(deniedTop, docsById);
  const userLabel = `${user.name} · ${KNOWLEDGE_ROLES[user.role].label}`;

  if (deniedTop.length > 0 && mergedTop.length === 0) {
    return {
      userLabel,
      accessibleHitCount: 0,
      deniedHitCount: deniedTop.length,
      accessibleDocuments,
      deniedDocuments,
      riskLabel: "仅命中无权资料，应返回权限提示",
      explanation:
        "当前问题找到了相关资料，但这些资料不在当前账号可访问范围内；系统应阻止其进入 LLM 上下文和引用卡片。",
    };
  }

  if (deniedTop.length > 0) {
    return {
      userLabel,
      accessibleHitCount: mergedTop.length,
      deniedHitCount: deniedTop.length,
      accessibleDocuments,
      deniedDocuments,
      riskLabel: "命中无权资料，已在检索前隔离",
      explanation:
        "当前问题同时命中可访问资料和无权资料；无权资料只用于调试提示，不会进入 LLM 上下文或最终引用。",
    };
  }

  if (mergedTop.length === 0) {
    return {
      userLabel,
      accessibleHitCount: 0,
      deniedHitCount: 0,
      accessibleDocuments,
      deniedDocuments,
      riskLabel: "未找到可用依据，应触发依据不足判断",
      explanation:
        "当前账号可访问资料中没有形成有效候选，后续问答链路应进入依据不足拒答分支。",
    };
  }

  return {
    userLabel,
    accessibleHitCount: mergedTop.length,
    deniedHitCount: 0,
    accessibleDocuments,
    deniedDocuments,
    riskLabel: "仅命中可访问资料，可进入证据判断",
    explanation:
      "当前候选均来自当前账号可访问资料，后续仍需检查证据是否足够支撑回答。",
  };
}

function uniqueDocNames(
  hits: RetrievedChunk[],
  docsById: Map<string, Document>
): string[] {
  const names = new Set<string>();
  for (const hit of hits) {
    names.add(docsById.get(hit.chunk.documentId)?.fileName ?? hit.chunk.fileName);
  }
  return [...names];
}
