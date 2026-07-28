import { NextResponse } from "next/server";
import { listBatches } from "@/lib/evaluation/batch";

/** GET /api/evaluation/batch — 列出历史批次（新→旧） */
export async function GET() {
  return NextResponse.json({ batches: listBatches() });
}
