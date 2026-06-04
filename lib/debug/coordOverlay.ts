import fs from "fs";
import path from "path";
import {
  extractTableGridsFromCoords,
  type CoordTableGrid,
} from "../parse/coordTables.ts";

export interface CoordOverlayResult {
  written: number;
  pages: number[];
  dir: string;
  error?: string;
}

const DEBUG_ROOT = path.join(process.cwd(), "debug", "tables");

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageBounds(grids: CoordTableGrid[]): [number, number, number, number] {
  const boxes = grids.flatMap((grid) =>
    (grid.cellBBoxes ?? []).flat().filter((box): box is [number, number, number, number] => !!box)
  );
  if (!boxes.length) return [0, 0, 800, 1100];
  return [
    Math.min(0, ...boxes.map((b) => b[0])) - 20,
    Math.min(0, ...boxes.map((b) => b[1])) - 20,
    Math.max(...boxes.map((b) => b[2])) + 20,
    Math.max(...boxes.map((b) => b[3])) + 20,
  ];
}

function renderSvg(page: number, grids: CoordTableGrid[]): string {
  const [x0, y0, x1, y1] = pageBounds(grids);
  const width = x1 - x0;
  const height = y1 - y0;
  const rects: string[] = [];

  for (const grid of grids) {
    const [rx0, ry0, rx1, ry1] = grid.rawTable.bbox ?? grid.grid.region.bbox;
    rects.push(
      `<rect x="${rx0 - x0}" y="${ry0 - y0}" width="${rx1 - rx0}" height="${ry1 - ry0}" class="region"/>`
    );
    const boxes = grid.cellBBoxes ?? [];
    for (let r = 0; r < boxes.length; r++) {
      for (let c = 0; c < boxes[r].length; c++) {
        const box = boxes[r][c];
        if (!box) continue;
        const [bx0, by0, bx1, by1] = box;
        const label = esc(grid.rawTable.rows[r]?.[c] ?? "");
        rects.push(
          `<rect x="${bx0 - x0}" y="${by0 - y0}" width="${bx1 - bx0}" height="${by1 - by0}" class="cell"><title>${label}</title></rect>`
        );
      }
    }
  }

  return `<!doctype svg>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
.bg{fill:#fffdf7}.region{fill:rgba(59,130,246,.08);stroke:#2563eb;stroke-width:2}.cell{fill:rgba(16,185,129,.08);stroke:#10b981;stroke-width:1}
text{font:12px sans-serif;fill:#334155}
</style>
<rect class="bg" width="100%" height="100%"/>
<text x="12" y="20">coords overlay page ${page}</text>
${rects.join("\n")}
</svg>`;
}

export async function generateCoordOverlay(
  docId: string,
  buffer: Buffer
): Promise<CoordOverlayResult> {
  const outDir = path.join(DEBUG_ROOT, docId, "coord-overlay");
  try {
    const grids = await extractTableGridsFromCoords(buffer);
    fs.mkdirSync(outDir, { recursive: true });
    const byPage = new Map<number, CoordTableGrid[]>();
    for (const grid of grids) {
      const arr = byPage.get(grid.rawTable.page) ?? [];
      arr.push(grid);
      byPage.set(grid.rawTable.page, arr);
    }

    const pages = [...byPage.keys()].sort((a, b) => a - b);
    for (const page of pages) {
      fs.writeFileSync(
        path.join(outDir, `page-${page}.svg`),
        renderSvg(page, byPage.get(page) ?? [])
      );
    }
    fs.writeFileSync(
      path.join(outDir, "manifest.json"),
      JSON.stringify(
        {
          extractor: "coords",
          written: pages.length,
          pages,
          tables: grids.map((grid) => ({
            page: grid.rawTable.page,
            title: grid.rawTable.title,
            rows: grid.rawTable.rows.length,
            cols: Math.max(0, ...grid.rawTable.rows.map((row) => row.length)),
            warnings: grid.warnings,
          })),
        },
        null,
        2
      )
    );
    return { written: pages.length, pages, dir: outDir };
  } catch (e) {
    return { written: 0, pages: [], dir: outDir, error: String(e) };
  }
}
