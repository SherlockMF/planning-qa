import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EvaluationBatch } from "../types.ts";

const DEFAULT_BATCH_FILE = path.join(
  process.cwd(),
  ".data",
  "evaluation-batches.json"
);

export class FileEvaluationBatchStore {
  private readonly filePath: string;

  constructor(filePath = DEFAULT_BATCH_FILE) {
    this.filePath = filePath;
  }

  list(): EvaluationBatch[] {
    return structuredClone(this.readAll()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  get(id: string): EvaluationBatch | undefined {
    const batch = this.readAll().find((item) => item.id === id);
    return batch ? structuredClone(batch) : undefined;
  }

  save(batch: EvaluationBatch): void {
    const all = this.readAll();
    const index = all.findIndex((item) => item.id === batch.id);
    const copy = structuredClone(batch);
    if (index >= 0) all[index] = copy;
    else all.push(copy);
    this.writeAll(all);
  }

  private readAll(): EvaluationBatch[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(value) ? (value as EvaluationBatch[]) : [];
    } catch (error) {
      console.error("[evaluation-batches] read failed:", error);
      return [];
    }
  }

  private writeAll(batches: EvaluationBatch[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(batches));
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    }
  }
}

const defaultStore = new FileEvaluationBatchStore();

export function listEvaluationBatches(): EvaluationBatch[] {
  return defaultStore.list();
}

export function getEvaluationBatch(id: string): EvaluationBatch | undefined {
  return defaultStore.get(id);
}

export function saveEvaluationBatch(batch: EvaluationBatch): void {
  defaultStore.save(batch);
}

export function getDefaultEvaluationBatchStore(): FileEvaluationBatchStore {
  return defaultStore;
}
