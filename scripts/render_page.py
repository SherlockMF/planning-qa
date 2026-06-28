# -*- coding: utf-8 -*-
"""
渲染 PDF 单页为 PNG（供「引用原文」展示真实页面）。
用法: render_page.py <pdf_path> <page_no(1-based)> <out_png> [dpi]
输出: stdout 一行 JSON：{"ok":true,"page":N,"out":path,"w":..,"h":..} 或 {"error":"..."}
依赖 PyMuPDF(fitz)；缺失/失败时返回 error，调用方优雅降级。
"""
import sys
import json


def main():
    if len(sys.argv) < 4:
        sys.stdout.write(json.dumps({"error": "usage: render_page.py <pdf> <page> <out> [dpi]"}))
        return
    pdf_path = sys.argv[1]
    try:
        page_no = int(sys.argv[2])
    except ValueError:
        sys.stdout.write(json.dumps({"error": "page must be int"}))
        return
    out_png = sys.argv[3]
    dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 150

    try:
        import fitz  # PyMuPDF
    except Exception as e:  # noqa: BLE001
        sys.stdout.write(json.dumps({"error": "pymupdf not available: %s" % e}))
        return

    try:
        doc = fitz.open(pdf_path)
        n = doc.page_count
        if page_no < 1 or page_no > n:
            sys.stdout.write(json.dumps({"error": "page out of range", "pageCount": n}))
            return
        page = doc[page_no - 1]
        pix = page.get_pixmap(dpi=dpi)
        pix.save(out_png)
        sys.stdout.write(json.dumps({"ok": True, "page": page_no, "out": out_png, "w": pix.width, "h": pix.height, "pageCount": n}))
    except Exception as e:  # noqa: BLE001
        sys.stdout.write(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
