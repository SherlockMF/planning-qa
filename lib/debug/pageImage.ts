// ============================================================================
// PDF 单页渲染桥接（「引用原文」展示真实页面）
// ----------------------------------------------------------------------------
// 把文档原始 PDF 写临时文件，spawn scripts/render_page.py 用 PyMuPDF 渲染指定页
// 为 PNG，缓存到 .cache/pages/{docId}/p{n}@{dpi}.png。与 overlayBridge 一样优雅
// 降级：Python / PyMuPDF 缺失或失败 → 返回 error，调用方回退到文字展示。
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
const SCRIPT = path.join(process.cwd(), "scripts", "render_page.py");
const CACHE_DIR = path.join(process.cwd(), ".cache", "pages");

export interface PageImageResult {
  pngPath?: string;
  error?: string;
}

function trySpawn(
  py: string,
  args: string[]
): Promise<{ ok: boolean; error?: string } | "ENOENT"> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(py, args, { windowsHide: true });
    } catch {
      resolve("ENOENT");
      return;
    }
    const out: Buffer[] = [];
    let settled = false;
    const done = (v: { ok: boolean; error?: string } | "ENOENT") => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    proc.on("error", (e: NodeJS.ErrnoException) =>
      done(e.code === "ENOENT" ? "ENOENT" : { ok: false, error: String(e) })
    );
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.on("close", () => {
      try {
        const j = JSON.parse(Buffer.concat(out).toString("utf8"));
        done(j.error ? { ok: false, error: j.error } : { ok: true });
      } catch (e) {
        done({ ok: false, error: "bad output: " + String(e) });
      }
    });
  });
}

/**
 * 渲染文档某页为 PNG，返回缓存文件路径。已缓存则直接返回。
 * @param docId 文档 id（仅用于缓存路径命名）
 * @param buf 原始 PDF 字节
 * @param pageNo 1-based 页码
 * @param dpi 渲染 dpi（默认 150）
 */
export async function renderDocPage(
  docId: string,
  buf: Buffer,
  pageNo: number,
  dpi = 150
): Promise<PageImageResult> {
  const safeId = docId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(CACHE_DIR, safeId);
  const pngPath = path.join(dir, `p${pageNo}@${dpi}.png`);
  if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) {
    return { pngPath };
  }
  fs.mkdirSync(dir, { recursive: true });

  // 原始 PDF 写临时文件供 python 读取
  const tmpPdf = path.join(os.tmpdir(), `qa_page_${safeId}_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPdf, buf);
  try {
    let lastError = "no python interpreter";
    for (const py of PY_CANDIDATES) {
      const r = await trySpawn(py, [SCRIPT, tmpPdf, String(pageNo), pngPath, String(dpi)]);
      if (r === "ENOENT") continue;
      if (r.ok && fs.existsSync(pngPath)) return { pngPath };
      lastError = r.error ?? "render failed";
      break; // 找到可用解释器但渲染失败：不再换解释器
    }
    return { error: lastError };
  } finally {
    try {
      fs.unlinkSync(tmpPdf);
    } catch {
      /* ignore */
    }
  }
}
