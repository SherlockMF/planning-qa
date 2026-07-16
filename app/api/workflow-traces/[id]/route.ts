import { NextRequest, NextResponse } from "next/server";
import {
  buildReconstructedIngestionTrace,
  getWorkflowTrace,
} from "@/lib/db/workflowTraces";
import { ensureSeeded, getStore } from "@/lib/db/store";
import { resolveWorkflowAuditActor } from "@/lib/workflow/access";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let actor;
  try {
    actor = resolveWorkflowAuditActor(
      req.nextUrl.searchParams.get("actorUserId") ?? undefined
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无权访问工作流审计" },
      { status: 403 }
    );
  }

  const recorded = getWorkflowTrace(params.id);
  if (recorded) return NextResponse.json({ trace: recorded });

  const prefix = "reconstructed-";
  if (params.id.startsWith(prefix)) {
    await ensureSeeded();
    const documentId = params.id.slice(prefix.length);
    const store = getStore();
    const document = store.documents.find((item) => item.id === documentId);
    if (document) {
      return NextResponse.json({
        trace: buildReconstructedIngestionTrace({
          document,
          chunks: store.chunks,
          ragTables: store.ragTables,
          actorUserId: actor.id,
        }),
      });
    }
  }

  return NextResponse.json({ error: "工作流记录不存在" }, { status: 404 });
}
