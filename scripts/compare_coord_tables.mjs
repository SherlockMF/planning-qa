import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractTablesFromCoords } from "../lib/parse/coordTables.ts";
import { summarizeTableComparison } from "../lib/debug/coordTableCompare.ts";

const BUNDLED_PYTHON = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe"
);
const PY_CANDIDATES = ["py", "python", "python3", BUNDLED_PYTHON];
const SCRIPT = path.join(process.cwd(), "scripts", "extract_tables.py");
const RAW_DIR = path.join(process.cwd(), ".data", "raw");
const OUT_DIR = path.join(process.cwd(), "debug", "tables");

function runPythonOnce(py, pdfPath) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(py, [SCRIPT, pdfPath], { windowsHide: true });
    } catch {
      resolve("ENOENT");
      return;
    }
    const out = [];
    proc.on("error", (e) => resolve(e.code === "ENOENT" ? "ENOENT" : null));
    proc.stdout.on("data", (chunk) => out.push(chunk));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const json = JSON.parse(Buffer.concat(out).toString("utf8"));
        resolve(Array.isArray(json) ? json : null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function extractPythonTables(pdfPath) {
  for (const py of PY_CANDIDATES) {
    const result = await runPythonOnce(py, pdfPath);
    if (result !== "ENOENT") return result ?? [];
  }
  return [];
}

function listDocIds() {
  const args = process.argv.slice(2);
  if (args.length) return args;
  if (!fs.existsSync(RAW_DIR)) return [];
  return fs.readdirSync(RAW_DIR).filter((name) => {
    const full = path.join(RAW_DIR, name);
    return fs.statSync(full).isFile();
  });
}

const results = [];
for (const docId of listDocIds()) {
  const pdfPath = path.join(RAW_DIR, docId);
  const buffer = fs.readFileSync(pdfPath);
  try {
    const coordTables = await extractTablesFromCoords(buffer);
    const pythonTables = await extractPythonTables(pdfPath);
    results.push({
      docId,
      ...summarizeTableComparison(coordTables, pythonTables),
    });
  } catch (e) {
    results.push({
      docId,
      error: String(e?.message ?? e),
    });
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, "coord-python-compare.json");
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    {
      written: outPath,
      compared: results.length,
      results,
    },
    null,
    2
  )
);
