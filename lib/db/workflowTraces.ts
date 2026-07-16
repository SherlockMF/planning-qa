import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Chunk, Document, RagTable } from "../types.ts";
import { createWorkflowTrace, sanitizeWorkflowSummary } from "../workflow/trace.ts";
import type { WorkflowTrace, WorkflowTraceKind } from "../workflow/types.ts";

const DEFAULT_TRACE_FILE = path.join(
  process.cwd(),
  ".data",
  "workflow-traces.json"
);

export class FileWorkflowTraceStore {
  private readonly filePath: string;

  constructor(filePath = DEFAULT_TRACE_FILE) {
    this.filePath = filePath;
  }

  save(trace: WorkflowTrace): void {
    const traces = this.readAll();
    const index = traces.findIndex((candidate) => candidate.id === trace.id);
    const copy = structuredClone(trace);
    if (index >= 0) traces[index] = copy;
    else traces.push(copy);
    this.writeAll(traces);
  }

  get(id: string): WorkflowTrace | undefined {
    const trace = this.readAll().find((candidate) => candidate.id === id);
    return trace ? structuredClone(trace) : undefined;
  }

  list(options: { kind?: WorkflowTraceKind; limit?: number } = {}): WorkflowTrace[] {
    const filtered = this.readAll()
      .filter((trace) => !options.kind || trace.kind === options.kind)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return structuredClone(filtered.slice(0, options.limit ?? filtered.length));
  }

  private readAll(): WorkflowTrace[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(value) ? (value as WorkflowTrace[]) : [];
    } catch (error) {
      console.error("[workflow-traces] read failed:", error);
      return [];
    }
  }

  private writeAll(traces: WorkflowTrace[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(traces));
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    }
  }
}

const defaultStore = new FileWorkflowTraceStore();

export function saveWorkflowTrace(trace: WorkflowTrace): void {
  defaultStore.save(trace);
}

/** 审计落盘不得改变问答或文档处理的业务结果。 */
export function persistWorkflowTraceSafely(
  trace: WorkflowTrace,
  persist: (value: WorkflowTrace) => void = saveWorkflowTrace
): boolean {
  try {
    persist(trace);
    return true;
  } catch (error) {
    if (!trace.warnings.includes("审计记录持久化失败")) {
      trace.warnings.push("审计记录持久化失败");
    }
    console.error("[workflow-traces] persist failed:", error);
    return false;
  }
}

export function getWorkflowTrace(id: string): WorkflowTrace | undefined {
  return defaultStore.get(id);
}

export function listWorkflowTraces(
  options: { kind?: WorkflowTraceKind; limit?: number } = {}
): WorkflowTrace[] {
  return defaultStore.list(options);
}

export function findLatestIngestionTrace(
  traces: WorkflowTrace[],
  documentId: string
): WorkflowTrace | undefined {
  return traces
    .filter(
      (trace) =>
        trace.kind === "ingestion" && trace.documentId === documentId
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function buildReconstructedIngestionTrace(input: {
  document: Document;
  chunks: Chunk[];
  ragTables: RagTable[];
  actorUserId: string;
  now?: string;
}): WorkflowTrace {
  const now = input.now ?? new Date().toISOString();
  const trace = createWorkflowTrace({
    id: `reconstructed-${input.document.id}`,
    kind: "ingestion",
    actorUserId: input.actorUserId,
    documentId: input.document.id,
    now,
  });
  const chunks = input.chunks.filter(
    (chunk) => chunk.documentId === input.document.id
  );
  const ragTables = input.ragTables.filter(
    (table) => table.docId === input.document.id
  );
  const typeCounts = Object.fromEntries(
    [...new Set(chunks.map((chunk) => chunk.chunkType))].map((chunkType) => [
      chunkType,
      chunks.filter((chunk) => chunk.chunkType === chunkType).length,
    ])
  );
  const metricsByStep: Record<
    string,
    Record<string, number | string | boolean>
  > = {
    upload_registration: {
      fileType: input.document.fileType,
      status: input.document.status,
    },
    content_parsing: {},
    knowledge_objects: {
      objectCount: new Set(
        chunks
          .map((chunk) => chunk.objectId)
          .filter((value): value is string => Boolean(value))
      ).size,
    },
    chunking: { chunkCount: chunks.length },
    embedding: {
      embeddedCount: chunks.filter((chunk) => chunk.embedding?.length).length,
    },
    persistence: {
      chunkCount: chunks.length,
      ragTableCount: ragTables.length,
    },
  };

  for (const step of trace.steps) {
    step.status = "completed";
    step.source = "reconstructed";
    step.metrics = metricsByStep[step.key] ?? {};
    if (step.key === "upload_registration") {
      step.outputSummary = sanitizeWorkflowSummary({
        documentId: input.document.id,
        fileName: input.document.fileName,
        city: input.document.city,
        createdAt: input.document.createdAt,
      });
    }
    if (step.key === "chunking") {
      step.outputSummary = sanitizeWorkflowSummary({ chunkTypes: typeCounts });
    }
    step.warnings = ["该步骤由当前持久化状态重建，原始耗时与当时配置不可确认"];
  }

  trace.status = "completed";
  trace.warnings = [
    "历史回溯：数据由当前 Document、Chunk 与 RagTable 状态重建",
  ];
  return trace;
}
