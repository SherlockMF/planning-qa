import { NextRequest } from "next/server";
import { generateAnswer } from "@/lib/rag/generateAnswer";
import {
  findLatestIngestionTrace,
  listWorkflowTraces,
  saveWorkflowTrace,
} from "@/lib/db/workflowTraces";
import {
  resolveWorkflowAuditActor,
  resolveWorkflowSimulatedUser,
} from "@/lib/workflow/access";
import { WorkflowTraceRecorder, createWorkflowTrace } from "@/lib/workflow/trace";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question : "";
  if (!question.trim()) {
    return Response.json({ error: "缺少 question 参数" }, { status: 400 });
  }

  let actor;
  try {
    actor = resolveWorkflowAuditActor(
      typeof body?.actorUserId === "string" ? body.actorUserId : undefined
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "无权访问工作流审计" },
      { status: 403 }
    );
  }

  let simulatedUser;
  try {
    simulatedUser = resolveWorkflowSimulatedUser(
      actor,
      typeof body?.simulatedUserId === "string"
        ? body.simulatedUserId
        : undefined
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "模拟用户不存在" },
      { status: 400 }
    );
  }
  const city = typeof body?.city === "string" ? body.city : undefined;
  const trace = createWorkflowTrace({
    id: `query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "query",
    actorUserId: actor.id,
    simulatedUserId: simulatedUser.id,
    question: question.trim(),
  });
  const encoder = new TextEncoder();
  let streamClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (type: string, data: unknown) => {
        if (streamClosed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch (error) {
          streamClosed = true;
          console.warn("[workflow-traces] SSE client disconnected:", error);
        }
      };
      const persist = () => {
        try {
          saveWorkflowTrace(trace);
        } catch (error) {
          if (!trace.warnings.includes("审计记录持久化失败")) {
            trace.warnings.push("审计记录持久化失败");
          }
          console.error("[workflow-traces] persist failed:", error);
        }
      };
      const recorder = new WorkflowTraceRecorder(trace, (event) => {
        persist();
        if (event.type !== "trace.completed") send(event.type, event);
      });

      persist();
      send("trace.created", { type: "trace.created", trace });

      void generateAnswer(
        question,
        city,
        simulatedUser.id,
        simulatedUser.role,
        recorder
      )
        .then(({ response }) => {
          const ingestionTraces = listWorkflowTraces({ kind: "ingestion" });
          trace.ingestionTraceIds = trace.relatedDocumentIds.map(
            (documentId) =>
              findLatestIngestionTrace(ingestionTraces, documentId)?.id ??
              `reconstructed-${documentId}`
          );
          persist();
          send("trace.completed", { type: "trace.completed", trace, response });
        })
        .catch((error) => {
          if (trace.status === "running") {
            const active =
              trace.steps.find((step) => step.status === "running") ??
              trace.steps.find((step) => step.status === "pending");
            if (active) {
              if (active.status === "pending") recorder.start(active.key);
              recorder.fail(active.key, error);
            }
          }
          persist();
          send("trace.completed", { type: "trace.completed", trace });
        })
        .finally(() => {
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
        });
    },
    cancel() {
      streamClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
