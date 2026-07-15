import { NextRequest, NextResponse } from "next/server";
import { listWorkflowTraces } from "@/lib/db/workflowTraces";
import { resolveWorkflowAuditActor } from "@/lib/workflow/access";
import type { WorkflowTraceKind } from "@/lib/workflow/types";

export async function GET(req: NextRequest) {
  try {
    resolveWorkflowAuditActor(req.nextUrl.searchParams.get("actorUserId") ?? undefined);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问工作流审计" },
      { status: 403 }
    );
  }

  const rawKind = req.nextUrl.searchParams.get("kind");
  const kind: WorkflowTraceKind | undefined =
    rawKind === "query" || rawKind === "ingestion" ? rawKind : undefined;
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50;
  return NextResponse.json({ traces: listWorkflowTraces({ kind, limit }) });
}
