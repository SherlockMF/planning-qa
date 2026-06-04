// ============================================================================
// 表格 overlay 调试桥接（P3 #3）
// ----------------------------------------------------------------------------
// 把文档原始 PDF 写临时文件，spawn scripts/overlay_tables.py 渲染「页面 +
// 表格框 + 单元格网格」PNG 到 debug/tables/{docId}/overlay/。
// 与 tablesSidecar 一样优雅降级：Python/依赖缺失 → 返回 error，不影响主流程。
// ============================================================================

import { spawn } from "child_process";
import os from "os";
import fs from "fs";
import path from "path";

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
const SCRIPT = path.join(process.cwd(), "scripts", "overlay_tables.py");

export interface OverlayResult {
  written: number;
  pages?: number[];
  error?: string;
  dir: string;
}

function trySpawn(
  py: string,
  pdfPath: string,
  outDir: string
): Promise<OverlayResult | "ENOENT"> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(py, [SCRIPT, pdfPath, outDir], { windowsHide: true });
    } catch {
      resolve("ENOENT");
      return;
    }
    const out: Buffer[] = [];
    let settled = false;
    const done = (v: OverlayResult | "ENOENT") => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    proc.on("error", (e: NodeJS.ErrnoException) =>
      done(e.code === "ENOENT" ? "ENOENT" : { written: 0, error: String(e), dir: outDir })
    );
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.on("close", () => {
      try {
        const j = JSON.parse(Buffer.concat(out).toString("utf8"));
        done({ written: j.written ?? 0, pages: j.pages, error: j.error, dir: outDir });
      } catch {
        done({ written: 0, error: "bad overlay output", dir: outDir });
      }
    });
  });
}

/** 为某文档生成表格 overlay PNG。返回写出页数；Python 不可用时 written=0+error。 */
export async function generateOverlay(
  docId: string,
  buffer: Buffer
): Promise<OverlayResult> {
  const outDir = path.join(process.cwd(), "debug", "tables", docId, "overlay");
  const tmp = path.join(
    os.tmpdir(),
    `qa-ovl-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  );
  try {
    fs.writeFileSync(tmp, buffer);
  } catch (e) {
    return { written: 0, error: `write temp failed: ${e}`, dir: outDir };
  }
  try {
    for (const py of PY_CANDIDATES) {
      const r = await trySpawn(py, tmp, outDir);
      if (r !== "ENOENT") return r;
    }
    return { written: 0, error: "python not available", dir: outDir };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}
