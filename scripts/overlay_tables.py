# -*- coding: utf-8 -*-
"""
表格 overlay 可视化调试（P3 #3）。

把每页 PDF 渲染成图片，叠加 pdfplumber 检测出的「表格外框 + 单元格网格」，
导出 PNG，供人工一眼看出错列/漏行/误检（单元格边界画错就是错列）。

  - 红框：表格外框（lines 策略）
  - 蓝线：单元格边界（lines 策略）
  - 绿框：lines_text 策略额外检出的表（无横线表）

用法：
    py scripts/overlay_tables.py <pdf_path> <out_dir>
仅渲染「检出表格的页」，跳过纯文字页。输出 {out_dir}/page-{N}.png。
stdout 输出 JSON：{"written": n, "pages": [..], "error": "..."}（与 sidecar 一致，
fd1 隔离避免库输出污染）。
"""
import sys
import os
import json

ZOOM = 2.0  # 渲染缩放（~144 DPI）

LINES = {"vertical_strategy": "lines", "horizontal_strategy": "lines"}
LINES_TEXT = {"vertical_strategy": "lines", "horizontal_strategy": "text"}


def main():
    if len(sys.argv) < 3:
        sys.stdout.write(json.dumps({"error": "usage: overlay_tables.py <pdf> <outdir>"}))
        sys.exit(2)
    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]

    # 隔离库输出，真实 stdout 留作最终 JSON
    real_fd = os.dup(1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)

    def emit(obj, code=0):
        os.write(real_fd, json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        os._exit(code)

    try:
        import pdfplumber
        import fitz
        from PIL import Image, ImageDraw
        try:
            fitz.TOOLS.mupdf_display_errors(False)
        except Exception:
            pass
    except Exception as e:
        emit({"error": "deps missing: %s" % e}, 3)

    os.makedirs(out_dir, exist_ok=True)
    written = 0
    pages = []
    try:
        fdoc = fitz.open(pdf_path)
        with pdfplumber.open(pdf_path) as pdf:
            for idx, page in enumerate(pdf.pages):
                try:
                    t_lines = page.find_tables(table_settings=LINES)
                except Exception:
                    t_lines = []
                try:
                    t_text = page.find_tables(table_settings=LINES_TEXT)
                except Exception:
                    t_text = []
                if not t_lines and not t_text:
                    continue  # 无表页跳过

                if idx >= fdoc.page_count:
                    continue
                fpage = fdoc[idx]
                pix = fpage.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                draw = ImageDraw.Draw(img)

                def rect(b, color, w):
                    draw.rectangle(
                        [b[0] * ZOOM, b[1] * ZOOM, b[2] * ZOOM, b[3] * ZOOM],
                        outline=color, width=w,
                    )

                # lines_text 额外表（绿框，先画，可能被 lines 覆盖）
                for t in t_text:
                    rect(t.bbox, (40, 170, 70), 2)
                # lines 表外框（红）+ 单元格网格（蓝）
                for t in t_lines:
                    rect(t.bbox, (220, 30, 30), 2)
                    for cell in (t.cells or []):
                        if cell:
                            rect(cell, (40, 110, 230), 1)

                path = os.path.join(out_dir, "page-%d.png" % (idx + 1))
                img.save(path)
                written += 1
                pages.append(idx + 1)
        fdoc.close()
    except Exception as e:
        emit({"error": "overlay failed: %s" % e}, 4)

    emit({"written": written, "pages": pages}, 0)


if __name__ == "__main__":
    main()
