import fs from "node:fs";
import path from "node:path";

export function assertReprocessIdentifier(value: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ||
    value.includes("..")
  ) {
    throw new Error("invalid_reprocess_identifier");
  }
}

export function reprocessDirectory(
  dataRoot: string,
  docId: string,
  stagingId: string
): string {
  assertReprocessIdentifier(docId);
  assertReprocessIdentifier(stagingId);
  return path.join(dataRoot, "reprocess", docId, stagingId);
}

export function writeReprocessJson(
  dataRoot: string,
  docId: string,
  stagingId: string,
  fileName: string,
  value: unknown
): void {
  const directory = reprocessDirectory(dataRoot, docId, stagingId);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, fileName);
  const temporary = path.join(
    directory,
    `.${fileName}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}

export function readReprocessJson<T>(
  dataRoot: string,
  docId: string,
  stagingId: string,
  fileName: string
): T {
  const file = path.join(
    reprocessDirectory(dataRoot, docId, stagingId),
    fileName
  );
  if (!fs.existsSync(file)) throw new Error("reprocess_staging_not_found");
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function listTransactionFiles(dataRoot: string): string[] {
  const root = path.join(dataRoot, "reprocess");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const docEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!docEntry.isDirectory()) continue;
    for (const stageEntry of fs.readdirSync(path.join(root, docEntry.name), {
      withFileTypes: true,
    })) {
      if (!stageEntry.isDirectory()) continue;
      const file = path.join(
        root,
        docEntry.name,
        stageEntry.name,
        "transaction.json"
      );
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files;
}

export function writeJsonFileAtomically(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}
