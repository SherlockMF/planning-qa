import { NextRequest, NextResponse } from "next/server";
import type { EvaluationItem } from "@/lib/types";
import {
  computeStats,
  listEvaluation,
  resetEvaluation,
  runEvaluation,
  saveEvaluation,
} from "@/lib/db/evaluation";

/** 读取评测题目与结果及统计。 */
export async function GET() {
  const items = await listEvaluation();
  return NextResponse.json({ items, stats: computeStats(items) });
}

/**
 * POST 支持两种操作：
 *  - { action: "run" } 对全部题目真实运行问答链路并回填结果；
 *  - { items: EvaluationItem[] } 保存题库。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  try {
    if (body?.action === "reset") {
      const items = await resetEvaluation();
      return NextResponse.json({ items, stats: computeStats(items) });
    }

    if (body?.action === "run") {
      // 运行前若带上当前（可能已编辑/新增的）题库，先持久化再逐题运行
      if (Array.isArray(body?.items)) {
        await saveEvaluation(body.items as EvaluationItem[]);
      }
      const items = await runEvaluation();
      return NextResponse.json({ items, stats: computeStats(items) });
    }

    if (Array.isArray(body?.items)) {
      const items = await saveEvaluation(body.items as EvaluationItem[]);
      return NextResponse.json({ items, stats: computeStats(items) });
    }

    return NextResponse.json({ error: "无效的请求" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "评测执行失败", detail: String(err) },
      { status: 500 }
    );
  }
}
