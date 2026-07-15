import { NextRequest, NextResponse } from "next/server";
import { getDocument, updateDocument } from "@/lib/db/documents";
import {
  canManageDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";
import { processDocument } from "@/lib/db/chunks";
import { getStore } from "@/lib/db/store";
import { extractText } from "@/lib/parse/extractText";
import { extractBlocksWithTables } from "@/lib/parse/tablesSidecar";
import type { Block } from "@/lib/types";
import {
  getWorkflowTrace,
  persistWorkflowTraceSafely,
} from "@/lib/db/workflowTraces";
import { createWorkflowTrace, WorkflowTraceRecorder } from "@/lib/workflow/trace";
import {
  recordContentParsing,
  recordUploadRegistration,
} from "@/lib/workflow/ingestionTrace";

// 文本提取与 embedding 可能较慢，放宽超时
export const maxDuration = 300;

/**
 * 解析文档：
 *  - PDF → IR（Block[]）→ 文档画像 → 结构化切片；
 *  - DOCX/TXT/MD → 纯文本 → 同一编排器切片。
 * 再生成 embedding → 入库。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const user = resolveKnowledgeUser({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
  });
  if (!canManageDocumentInManagement(user, doc)) {
    return NextResponse.json({ error: "当前账号无权管理该文档" }, { status: 403 });
  }

  const buf = getStore().rawBuffers[doc.id];
  const requestedTraceId = req.nextUrl.searchParams.get("traceId") ?? undefined;
  const requestedTrace = requestedTraceId
    ? getWorkflowTrace(requestedTraceId)
    : undefined;
  const trace =
    requestedTrace?.kind === "ingestion" &&
    requestedTrace.documentId === doc.id &&
    requestedTrace.status === "running"
      ? requestedTrace
      : createWorkflowTrace({
          id: `ingestion-${doc.id}-${Date.now()}`,
          kind: "ingestion",
          actorUserId: user.id,
          documentId: doc.id,
        });
  const recorder = new WorkflowTraceRecorder(trace, () => {
    persistWorkflowTraceSafely(trace);
  });
  if (
    trace.steps.find((step) => step.key === "upload_registration")?.status ===
    "pending"
  ) {
    recordUploadRegistration(recorder, {
      document: doc,
      fileSize: buf?.length ?? 0,
      uploadUserId: user.id,
    });
  }
  persistWorkflowTraceSafely(trace);

  await updateDocument(doc.id, { status: "processing" });

  try {
    if (!buf) {
      // 内置演示/种子文档没有原始文件，但带预置切片。对它们点"处理"不应标失败、
      // 踢出检索 —— 检测到已有切片则保持 indexed 并提示无需解析。
      const hasChunks = getStore().chunks.some((c) => c.documentId === doc.id);
      if (hasChunks) {
        recorder.start("content_parsing");
        recorder.complete("content_parsing", {
          outputSummary: { source: "built_in_seed", parsedNow: false },
          decision: { outcome: "reused_existing_index" },
          warnings: ["内置演示文档没有原始文件，本次未重新解析"],
        });
        for (const step of trace.steps.filter(
          (candidate) => candidate.status === "pending"
        )) {
          recorder.start(step.key);
          recorder.complete(step.key, {
            decision: { outcome: "reused_existing_index" },
            warnings: ["沿用内置文档的预置索引"],
          });
        }
        recorder.finish();
        persistWorkflowTraceSafely(trace);
        await updateDocument(doc.id, { status: "indexed" });
        return NextResponse.json(
          {
            skipped: true,
            traceId: trace.id,
            message: "该文档为内置演示文档，已预置切片，无需重新解析。",
          },
          { status: 200 }
        );
      }
      // 真正缺内容的上传文档：以前会落"占位 chunk"误导用户，改为明确失败。
      await updateDocument(doc.id, { status: "failed" });
      recorder.start("content_parsing");
      recorder.fail("content_parsing", new Error("原始文件缺失"));
      persistWorkflowTraceSafely(trace);
      return NextResponse.json(
        {
          error: "原始文件缺失，无法解析。请删除该记录后重新上传文件。",
          traceId: trace.id,
        },
        { status: 400 }
      );
    }

    let blocks: Block[] | undefined;
    let text: string | undefined;
    let extractedChars = 0;
    recorder.start("content_parsing");

    if (doc.fileName.toLowerCase().endsWith(".pdf")) {
      blocks = await extractBlocksWithTables(buf);
      extractedChars = blocks.reduce(
        (s, b) => s + b.normalizedText.length,
        0
      );
    } else {
      text = await extractText(buf, doc.fileName);
      extractedChars = text.length;
    }

    recordContentParsing(recorder, {
      fileName: doc.fileName,
      extractedChars,
      blocks,
      text,
    });
    const count = await processDocument(doc, { blocks, text }, recorder);
    const updated = await updateDocument(doc.id, { status: "indexed" });
    const persistedChunks = getStore().chunks.filter(
      (chunk) => chunk.documentId === doc.id
    );
    const persistedTables = getStore().ragTables.filter(
      (table) => table.docId === doc.id
    );
    recorder.complete("persistence", {
      metrics: {
        chunkCount: persistedChunks.length,
        ragTableCount: persistedTables.length,
      },
      outputSummary: {
        documentId: doc.id,
        documentStatus: updated?.status ?? "indexed",
        persistedChunkIds: persistedChunks.map((chunk) => chunk.id),
        ragTableIds: persistedTables.map((table) => table.tableId),
      },
      decision: { outcome: "persisted" },
    });
    recorder.finish();
    persistWorkflowTraceSafely(trace);
    return NextResponse.json({
      document: updated,
      chunkCount: count,
      extractedChars,
      traceId: trace.id,
    });
  } catch (err) {
    await updateDocument(doc.id, { status: "failed" });
    if (trace.status === "running") {
      const active =
        trace.steps.find((step) => step.status === "running") ??
        trace.steps.find((step) => step.status === "pending");
      if (active) {
        if (active.status === "pending") recorder.start(active.key);
        recorder.fail(active.key, err);
      } else {
        trace.status = "failed";
        trace.completedAt = new Date().toISOString();
        trace.warnings.push("处理状态更新失败，且没有可标记的活动步骤");
      }
      persistWorkflowTraceSafely(trace);
    }
    return NextResponse.json(
      { error: "处理失败", detail: String(err), traceId: trace.id },
      { status: 500 }
    );
  }
}
