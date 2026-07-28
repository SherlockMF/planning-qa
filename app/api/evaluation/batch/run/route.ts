import { NextRequest, NextResponse } from "next/server";
import { ensureSeeded, getStore } from "@/lib/db/store";
import {
  createEvaluationBatch,
  executeEvaluationBatch,
  getBatch,
  toEvaluationBatchCaseResult,
} from "@/lib/evaluation/batch";
import {
  captureModelConfigSnapshot,
  captureRagConfigSnapshot,
} from "@/lib/evaluation/batchConfig";
import {
  listEvaluation,
  saveEvaluation,
  scoreEvaluationItem,
} from "@/lib/db/evaluation";

export const maxDuration = 300;

/**
 * POST /api/evaluation/batch/run
 * 创建 queued 批次并异步开始执行；立即返回 batch 供轮询。
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

    void executeEvaluationBatch(batch.id, {
      scoreCase: async (item) =>
        toEvaluationBatchCaseResult(await scoreEvaluationItem(item)),
      mirrorToEvaluation: async (results) => {
        await ensureSeeded();
        const current = await listEvaluation();
        const byId = new Map(results.map((r) => [r.caseId, r]));
        const merged = current.map((item) => {
          const result = byId.get(item.id);
          if (!result) return item;
          return {
            ...item,
            systemAnswer: result.systemAnswer,
            answerScore: result.autoAnswerScore,
            autoAnswerScore: result.autoAnswerScore,
            autoStatus: result.status,
            status: result.status,
            autoJudgeUncertain: result.autoJudgeUncertain,
            inTop5: result.inTop5,
            citationCorrect: result.citationCorrect,
            refusedCorrectly: result.refusedCorrectly,
            errorReason: result.errorReason,
            answerDurationMs: result.answerDurationMs,
            tokensUsed: result.tokensUsed,
            workflowTraceId: result.workflowTraceId,
            runStartedAt: result.runStartedAt,
            runFinishedAt: result.runFinishedAt,
            runErrored: result.status === "ERROR",
            finalAnswerScore: undefined,
            finalStatus: undefined,
            reviewedBy: undefined,
            reviewedAt: undefined,
            reviewReason: undefined,
          };
        });
        await saveEvaluation(merged);
      },
    }).catch((error) => {
      console.error("[evaluation-batch] execute failed:", error);
    });

    return NextResponse.json({ batch: getBatch(batch.id) ?? batch });
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
