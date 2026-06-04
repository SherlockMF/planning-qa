import { NextRequest, NextResponse } from "next/server";
import type { RetrieveDebugResponse } from "@/lib/types";
import { retrieve } from "@/lib/rag/retrieve";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const question = body?.question;
  const city = body?.city;

  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "缺少 question 参数" }, { status: 400 });
  }

  const result = await retrieve(question, city);
  const response: RetrieveDebugResponse = {
    question,
    extractedKeywords: result.extractedKeywords,
    keywordResults: result.keywordResults,
    vectorResults: result.vectorResults,
    mergedTop: result.mergedTop,
  };
  return NextResponse.json(response);
}
