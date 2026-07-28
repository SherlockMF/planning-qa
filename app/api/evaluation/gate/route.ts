import { NextRequest, NextResponse } from "next/server";
import { getBatch } from "@/lib/evaluation/batch";
import { evaluateReleaseGate } from "@/lib/evaluation/releaseGate";
import { compareEvaluationBatches } from "@/lib/evaluation/batchCompare";

/**
 * POST /api/evaluation/gate
 * Body: { batchId } 或 { baselineId, candidateId }（对 candidate 评估，并附带可比信息）
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId : "";
  const baselineId =
    typeof body?.baselineId === "string" ? body.baselineId : "";
  const candidateId =
    typeof body?.candidateId === "string" ? body.candidateId : "";

  const targetId = batchId || candidateId;
  if (!targetId) {
    return NextResponse.json(
      { error: "需要 batchId 或 candidateId" },
      { status: 400 }
    );
  }

  const batch = getBatch(targetId);
  if (!batch) {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }

  const gate = evaluateReleaseGate(batch);
  let compare = null;
  if (baselineId) {
    const baseline = getBatch(baselineId);
    if (baseline) compare = compareEvaluationBatches(baseline, batch);
  }

  return NextResponse.json({ batchId: targetId, gate, compare });
}
