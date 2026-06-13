import { NextRequest, NextResponse } from "next/server";
import {
  saveFeedbackRecord,
  type FeedbackType,
} from "@/lib/db/feedback";

const VALID_TYPES: FeedbackType[] = ["helpful", "not_helpful", "need_human"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const type = body.type as FeedbackType;
  const userId = typeof body.userId === "string" ? body.userId.trim() : undefined;

  if (!targetId || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "缺少有效的 targetId 或反馈类型" },
      { status: 400 }
    );
  }

  const feedback = saveFeedbackRecord({ targetId, type, userId });
  return NextResponse.json({ feedback });
}
