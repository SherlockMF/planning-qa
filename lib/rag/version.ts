import type { Block } from "../types";

export interface SourceVersionInfo {
  docTitle?: string;
  docNo?: string;
  publishDate?: string;
  effectiveDate?: string;
  revisionDate?: string;
  issuer?: string;
  status?: "current" | "superseded" | "reference" | "draft" | "internal" | "unknown";
  supersedes?: string[];
  sourceConfidence: number;
  warnings?: string[];
}

export function extractSourceVersionInfo(
  blocks: Block[],
  docTitle?: string
): SourceVersionInfo {
  const headText = blocks
    .filter((block) => block.pageStart <= 3)
    .map((block) => block.normalizedText)
    .join("\n");
  const allText = blocks.map((block) => block.normalizedText).join("\n");
  const status = inferStatus(headText);
  const supersedes = [...allText.matchAll(/(?:代替|原)([^。；;]+?)(?:同时废止|废止|$)/g)]
    .map((m) => m[1]?.trim())
    .filter(Boolean) as string[];
  const warnings: string[] = [];
  if (/废止|代替|修订/.test(allText) && status === "unknown") {
    warnings.push("possible_version_conflict_mentions");
  }

  const info: SourceVersionInfo = {
    docTitle,
    docNo: headText.match(/(?:编号|文号|标准号)[:：]?\s*([A-Za-z0-9\-—〔〕\[\]年第号]+?)(?:\s|$)/)?.[1],
    publishDate: normalizeDate(
      headText.match(/(?:发布日期|印发日期|发布)[:：]?\s*([0-9]{4}[年.-][0-9]{1,2}[月.-][0-9]{1,2}日?)/)?.[1]
    ),
    effectiveDate: normalizeDate(
      headText.match(/(?:实施日期|施行日期|自).{0,8}?([0-9]{4}[年.-][0-9]{1,2}[月.-][0-9]{1,2}日?)/)?.[1]
    ),
    revisionDate: normalizeDate(
      headText.match(/(?:修订日期|修订|修改)[:：]?\s*([0-9]{4}[年.-][0-9]{1,2}[月.-][0-9]{1,2}日?)/)?.[1]
    ),
    issuer: headText.match(/(?:发布单位|发布机关|印发单位|主编单位)[:：]?\s*([^\n。；;]{2,50})/)?.[1]?.trim(),
    status,
    supersedes: supersedes.length ? supersedes : undefined,
    sourceConfidence: confidenceOf(headText),
    warnings: warnings.length ? warnings : undefined,
  };
  return info;
}

function inferStatus(text: string): SourceVersionInfo["status"] {
  if (/征求意见|征求意见稿/.test(text)) return "draft";
  if (/内部资料|内部使用/.test(text)) return "internal";
  if (/本(?:标准|办法|规定|指南|导则|文件|通知).{0,12}(废止|停止执行)/.test(text)) {
    return "superseded";
  }
  if (/试行|暂行|参考|指南|导则/.test(text)) return "reference";
  if (/发布|实施|施行|现行/.test(text)) return "current";
  return "unknown";
}

function normalizeDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([0-9]{4})[年.-]([0-9]{1,2})[月.-]([0-9]{1,2})/);
  if (!match) return raw.trim();
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function confidenceOf(text: string): number {
  let score = 0.35;
  if (/发布|实施|施行/.test(text)) score += 0.2;
  if (/发布日期|实施日期|施行日期/.test(text)) score += 0.2;
  if (/编号|文号|标准号/.test(text)) score += 0.15;
  if (/发布单位|发布机关|主编单位/.test(text)) score += 0.1;
  return Math.min(0.9, score);
}
