import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded, getStore } from "@/lib/db/store";
import { createEvaluationBatch } from "@/lib/evaluation/batch";
import {
  captureModelConfigSnapshot,
  captureRagConfigSnapshot,
} from "@/lib/evaluation/batchConfig";

export const maxDuration = 60;

/**
 * POST /api/evaluation/batch/run
 * 创建 queued 批次并立即返回；实际执行由调用方或后续 execute 触发。
 * Body: { versionLabel, changeNote, caseIds?, clientRequestId?, items? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.versionLabel !== "string") {
    return NextResponse.json(
      { error: "缺少 versionLabel" },
      { status: 400 }
    );
  }

  try {
    await ensureSeeded();
    const store = getStore();

    // 若带上当前编辑中的题库，先不落盘到 evaluation.json——批次只吃本次传入快照；
    // 未传 items 则用服务端题库。
    const items = Array.isArray(body.items) ? body.items : store.evaluation;
    const caseIds = Array.isArray(body.caseIds)
      ? (body.caseIds as string[])
      : undefined;

    const batch = createEvaluationBatch({
      versionLabel: body.versionLabel,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : "",
      caseIds,
      clientRequestId:
        typeof body.clientRequestId === "string"
          ? body.clientRequestId
          : undefined,
      items,
      knowledge: {
        documents: store.documents,
        chunks: store.chunks,
        ragTables: store.ragTables,
      },
      modelConfigSnapshot: captureModelConfigSnapshot(),
      ragConfigSnapshot: captureRagConfigSnapshot(),
    });

    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json(
      {
        error: "创建评测批次失败",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
