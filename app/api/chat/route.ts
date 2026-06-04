import { NextRequest, NextResponse } from "next/server";
import type { ChatRequest } from "@/lib/types";
import { generateAnswer } from "@/lib/rag/generateAnswer";

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  if (!body?.question || typeof body.question !== "string") {
    return NextResponse.json({ error: "缺少 question 参数" }, { status: 400 });
  }

  const { response } = await generateAnswer(body.question, body.city);
  return NextResponse.json(response);
}
