import { NextRequest, NextResponse } from "next/server";
import { getBatch } from "@/lib/evaluation/batch";
import { buildCaseDraftFromFailure } from "@/lib/evaluation/caseFromFailure";
import { listEvaluation, saveEvaluation } from "@/lib/db/evaluation";

/**
 * POST /api/evaluation/cases/from-failure
 * Body: { batchId, caseId }
 * 写入题库草稿（draft=true），不自动进入「运行全部」回归集。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const batchId = typeof body?.batchId === "string" ? body.batchId : "";
  const caseId = typeof body?.caseId === "string" ? body.caseId : "";
  if (!batchId || !caseId) {
    return NextResponse.json(
      { error: "需要 batchId 与 caseId" },
      { status: 400 }
    );
  }

  const batch = getBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }
  const result = batch.caseResults.find((item) => item.caseId === caseId);
  if (!result) {
    return NextResponse.json({ error: "批次中无该题结果" }, { status: 404 });
  }
  if (result.status === "PASS") {
    return NextResponse.json(
      { error: "通过题无需生成坏例草稿" },
      { status: 400 }
    );
  }

  const source = batch.caseSnapshot.find((item) => item.id === caseId);
  const draft = buildCaseDraftFromFailure({
    result,
    source,
    batchId,
  });

  const items = await listEvaluation();
  const next = [...items, draft];
  await saveEvaluation(next);

  return NextResponse.json({
    item: draft,
    pending: true,
    message: "已写入草稿题，请补齐标准答案与正确文件后取消 draft 再入回归",
  });
}
