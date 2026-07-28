import { NextRequest, NextResponse } from "next/server";
import { getBatch } from "@/lib/evaluation/batch";
import { compareEvaluationBatches } from "@/lib/evaluation/batchCompare";

/**
 * POST /api/evaluation/batch/compare
 * Body: { baselineId, candidateId }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const baselineId =
    typeof body?.baselineId === "string" ? body.baselineId : "";
  const candidateId =
    typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!baselineId || !candidateId) {
    return NextResponse.json(
      { error: "需要 baselineId 与 candidateId" },
      { status: 400 }
    );
  }

  const baseline = getBatch(baselineId);
  const candidate = getBatch(candidateId);
  if (!baseline || !candidate) {
    return NextResponse.json(
      { error: "批次不存在", baseline: !!baseline, candidate: !!candidate },
      { status: 404 }
    );
  }

  return NextResponse.json({
    baselineId,
    candidateId,
    compare: compareEvaluationBatches(baseline, candidate),
  });
}
