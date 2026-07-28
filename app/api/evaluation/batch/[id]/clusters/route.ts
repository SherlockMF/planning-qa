import { NextResponse } from "next/server";
import { getBatch } from "@/lib/evaluation/batch";
import { clusterEvaluationFailures } from "@/lib/evaluation/failureClusters";

/** GET /api/evaluation/batch/[id]/clusters */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const batch = getBatch(params.id);
  if (!batch) {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }
  return NextResponse.json({
    batchId: batch.id,
    clusters: clusterEvaluationFailures(batch.caseResults, batch.caseSnapshot),
  });
}
