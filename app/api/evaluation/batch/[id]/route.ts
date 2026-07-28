import { NextRequest, NextResponse } from "next/server";
import {
  cancelEvaluationBatch,
  executeEvaluationBatch,
  getBatch,
  toEvaluationBatchCaseResult,
} from "@/lib/evaluation/batch";
import { scoreEvaluationItem, saveEvaluation, listEvaluation } from "@/lib/db/evaluation";
import { ensureSeeded } from "@/lib/db/store";

export const maxDuration = 300;

/** GET /api/evaluation/batch/[id] */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const batch = getBatch(params.id);
  if (!batch) {
    return NextResponse.json({ error: "批次不存在" }, { status: 404 });
  }
  return NextResponse.json({ batch });
}

/**
 * POST /api/evaluation/batch/[id]
 * Body: { action: "cancel" | "execute" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "cancel") {
    const batch = cancelEvaluationBatch(params.id);
    if (!batch) {
      return NextResponse.json({ error: "批次不存在" }, { status: 404 });
    }
    return NextResponse.json({ batch: getBatch(params.id) ?? batch });
  }

  if (action === "execute") {
    const existing = getBatch(params.id);
    if (!existing) {
      return NextResponse.json({ error: "批次不存在" }, { status: 404 });
    }
    // fire-and-forget：立即返回当前状态，客户端轮询 GET
    void executeEvaluationBatch(params.id, {
      scoreCase: async (item) =>
        toEvaluationBatchCaseResult(await scoreEvaluationItem(item)),
      mirrorToEvaluation: async (results, batchId) => {
        await ensureSeeded();
        const items = await listEvaluation();
        const byId = new Map(results.map((r) => [r.caseId, r]));
        const merged = items.map((item) => {
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
            // 标注最近结果来源，便于 UI 提示
            scenario: item.scenario,
          };
        });
        await saveEvaluation(merged);
        void batchId;
      },
    }).catch((error) => {
      console.error("[evaluation-batch] execute failed:", error);
    });
    return NextResponse.json({ batch: getBatch(params.id) ?? existing });
  }

  return NextResponse.json({ error: "无效的 action" }, { status: 400 });
}
