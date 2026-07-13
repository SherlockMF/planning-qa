import { NextRequest, NextResponse } from "next/server";
import type { RetrieveDebugResponse } from "@/lib/types";
import { retrieve } from "@/lib/rag/retrieve";
import { listDocuments } from "@/lib/db/documents";
import { resolveKnowledgeUser } from "@/lib/knowledge/permissions";
import { buildRetrieveDebugSummary } from "@/lib/debug/retrieveDebugSummary";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const question = body?.question;
  const city = body?.city;
  const userId = typeof body?.userId === "string" ? body.userId : undefined;
  const userRole = typeof body?.userRole === "string" ? body.userRole : undefined;

  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "缺少 question 参数" }, { status: 400 });
  }

  const user = resolveKnowledgeUser({ userId, userRole });
  const result = await retrieve(question, city, user.id, user.role);
  const documents = await listDocuments();
  const summary = buildRetrieveDebugSummary({
    user,
    documents,
    mergedTop: result.mergedTop,
    deniedTop: result.deniedTop,
  });
  const response: RetrieveDebugResponse = {
    question,
    userLabel: summary.userLabel,
    permissionSummary: {
      accessibleHitCount: summary.accessibleHitCount,
      deniedHitCount: summary.deniedHitCount,
      accessibleDocuments: summary.accessibleDocuments,
      deniedDocuments: summary.deniedDocuments,
      riskLabel: summary.riskLabel,
      explanation: summary.explanation,
    },
    extractedKeywords: result.extractedKeywords,
    exactResults: result.exactResults,
    keywordResults: result.keywordResults,
    vectorResults: result.vectorResults,
    mergedTop: result.mergedTop,
    deniedTop: result.deniedTop,
  };
  return NextResponse.json(response);
}
