# -*- coding: utf-8 -*-
"""
表格抽取 sidecar（P3 增强版）。

用 pdfplumber 抽取每一页表格，输出结构化矩阵给 Node 侧
（lib/parse/tablesSidecar.ts）。Node 侧再用 buildTableModelFromMatrix 合并多行
表头、生成 markdown 与「带字段名」的行展开。

P3 改进点：
  1. 多策略检测 + 择优：同一页用 lines / lines+text / text 三种 table_settings
     各抽一遍，按「单元格填充率 + 列数一致性」给每个候选打分，对重叠区域只保留
     最优候选。无边框/半边框指标表（默认 lines 策略会过度切列、产生大量空格）
     由此显著改善。
  2. PyMuPDF(fitz) 兜底：pdfplumber 全策略在某页一无所获时，用 fitz.find_tables
     再试一次（不同算法），仅用于补空白页，避免跨引擎坐标系混用。
  3. 扫描页检测：无文字但有图像的页标记 scanned（供上层提示/未来 OCR）。

用法：
    py scripts/extract_tables.py <pdf_path>
输出（stdout, UTF-8 JSON）：
    [{ "page": 7, "bbox": [x0,top,x1,bottom],
       "title": "表1 ...的配置指标表" | null,
       "rows": [[cell|null, ...], ...],
       "strategy": "lines|lines_text|text|fitz",
       "fill": 0.0-1.0,
       "scanned": false }, ...]
失败时输出 {"error": "..."} 并以非零退出码结束（Node 侧据此优雅回退）。
"""
import sys
import os
import json
import re
from collections import Counter

CAPTION_RE = re.compile(
    r"^\s*(续表|表)\s*[0-9A-Za-z一二三四五六七八九十百．.—–\-]*"
)
CAPTION_HINT = re.compile(r"(指标|标准|配置|分类|设施|用地|一览|附表)")

# ── 扫描页 OCR（P3 #4/#5）。默认关闭（OCR 慢且本类文档图像页多为图则）。
# 设 OCR_SCANNED=1 启用。路径可用环境变量覆盖（默认 UB-Mannheim 安装位 +
# ASCII 的 tessdata 目录，避免中文工程路径导致 tesseract 加载失败）。
OCR_ENABLED = os.environ.get("OCR_SCANNED") == "1"
TESSERACT_CMD = os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
QA_TESSDATA = os.environ.get(
    "QA_TESSDATA", os.path.expandvars(r"%LOCALAPPDATA%\qa-tessdata")
)
OCR_LANG = os.environ.get("OCR_LANG", "chi_sim+eng")

# ── 扫描页视觉识别（P3 #4，Level 3）。设 VISION_SCANNED=1 启用，需 ZHIPU_API_KEY。
# 用智谱 GLM-4V 转写扫描图（中文表格质量远高于 Tesseract）。优先级高于 OCR。
# 输出带「视觉识别·需核对」前缀，避免被当作权威结构化表（守住"不让 LLM 编表"原则）。
VISION_ENABLED = os.environ.get("VISION_SCANNED") == "1"
ZHIPU_KEY = os.environ.get("ZHIPU_API_KEY")
VISION_MODEL = os.environ.get("VISION_MODEL", "glm-4v-flash")
VISION_URL = os.environ.get(
    "ZHIPU_API_URL", "https://open.bigmodel.cn/api/paas/v4/chat/completions"
)
VISION_MARK = "【视觉识别·需核对】"


def vision_page(fpage):
    """用 GLM-4V 转写一页扫描图，返回带前缀的文本（失败返回 ""）。"""
    if not ZHIPU_KEY:
        return ""
    try:
        import base64
        import json as _json
        import urllib.request
        pix = fpage.get_pixmap(dpi=150)
        b64 = base64.b64encode(pix.tobytes("png")).decode()
        prompt = (
            "这是一张中文规划/法规文档的扫描页。请忠实转写页面文字内容；"
            "若包含表格，逐行用 | 分隔各列、首行为表头。只输出内容，不要解释、不要编造。"
        )
        body = _json.dumps({
            "model": VISION_MODEL,
            "temperature": 0,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": "data:image/png;base64," + b64}},
            ]}],
        }).encode()
        req = urllib.request.Request(
            VISION_URL, data=body,
            headers={"Authorization": "Bearer " + ZHIPU_KEY,
                     "Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=90)
        d = _json.load(r)
        txt = (d.get("choices") or [{}])[0].get("message", {}).get("content", "")
        txt = (txt or "").strip()
        return (VISION_MARK + "\n" + txt) if txt else ""
    except Exception:
        return ""


def ocr_page(fpage):
    """对一页（fitz page）渲染并 OCR，返回识别文本（失败返回 ""）。"""
    try:
        import tempfile
        import pytesseract
        from PIL import Image
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
        os.environ["TESSDATA_PREFIX"] = QA_TESSDATA
        pix = fpage.get_pixmap(dpi=216)  # ~3x，OCR 较稳
        tmp = os.path.join(tempfile.gettempdir(), "qa_ocr_%d.png" % os.getpid())
        Image.frombytes("RGB", [pix.width, pix.height], pix.samples).save(tmp)
        txt = pytesseract.image_to_string(
            Image.open(tmp), lang=OCR_LANG, config="--psm 6"
        )
        try:
            os.remove(tmp)
        except Exception:
            pass
        return txt.strip()
    except Exception:
        return ""

# 多策略 table_settings（精度优先）：
#   - lines：带框线表，snap/join 容差合并临近线，消除"幽灵列"（高 null 率元凶）；
#   - lines_text：有竖线无横线的表（列靠线、行靠文字）。
# 不用纯 text 策略：它会把目录/编号列表/散文误判成表（实测把 TOC 整页当表）。
STRATEGIES = [
    # lines：pdfplumber 默认线框策略（高精度，只切真正有框线的表）。
    ("lines", {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
    }),
    # lines_text：有竖线无横线的表（列靠线、行靠文字）。仅作补充候选，
    # 与 lines 重叠区域由打分择优，不与之竞争掉真实带框表。
    ("lines_text", {
        "vertical_strategy": "lines",
        "horizontal_strategy": "text",
    }),
]

# 目录行特征：≥4 个连续点/间隔点（"……" / "....."）
DOT_LEADER_RE = re.compile(r"[.．·]{4,}")


def drop_empty_rows(rows):
    """去掉整行皆空的行（pdfplumber 偶尔产出空行，会拉低填充率）。"""
    return [
        r for r in rows
        if any(c is not None and str(c).strip() != "" for c in r)
    ]


def looks_like_toc(rows):
    """目录/散文误检：含点引导符的单元格占比 ≥20% → 判为目录，拒绝。"""
    leader = 0
    total = 0
    for r in rows:
        for c in r:
            if c is None:
                continue
            s = str(c)
            if not s.strip():
                continue
            total += 1
            if DOT_LEADER_RE.search(s):
                leader += 1
    return total > 0 and leader / total >= 0.2


def find_title(page, table_top):
    """在表格上沿之上 70pt 内，就近找一行表名。找不到返回 None。"""
    try:
        lines = page.extract_text_lines()
    except Exception:
        return None
    best = None
    best_bottom = -1.0
    for ln in lines:
        text = (ln.get("text") or "").strip()
        if not text:
            continue
        bottom = float(ln.get("bottom", 0))
        if bottom > table_top or (table_top - bottom) > 70:
            continue
        is_caption = bool(CAPTION_RE.match(text)) or (
            "表" in text and CAPTION_HINT.search(text) is not None
        )
        if is_caption and bottom > best_bottom:
            best = text
            best_bottom = bottom
    return best


def score_rows(rows):
    """候选表质量评分：填充率 0.6 + 列数一致性 0.4。返回 (score, fill)。"""
    if not rows:
        return 0.0, 0.0
    cells = 0
    nonnull = 0
    colcounts = []
    for r in rows:
        colcounts.append(len(r))
        for c in r:
            cells += 1
            if c is not None and str(c).strip() != "":
                nonnull += 1
    if cells == 0:
        return 0.0, 0.0
    fill = nonnull / cells
    modal = Counter(colcounts).most_common(1)[0][1]
    consist = modal / len(rows)
    return fill * 0.6 + consist * 0.4, fill


def effective_cols(rows):
    """有效列数：含 ≥2 个非空单元格的列数。框内散文只有 1 个有效列。"""
    if not rows:
        return 0
    ncol = max((len(r) for r in rows), default=0)
    cnt = 0
    for ci in range(ncol):
        nonempty = sum(
            1 for r in rows
            if ci < len(r) and r[ci] is not None and str(r[ci]).strip() != ""
        )
        if nonempty >= 2:
            cnt += 1
    return cnt


def valid_shape(rows):
    """形状过滤：≥2 行、列数 2..40、非失控（行≤300）、有效列 ≥2。
    有效列 ≥2 用于排除「框内散文」——被边框包住的段落会被 lines 策略切成
    2 列，但其中一列几乎全空（只有 1 个有效列），据此剔除而不误伤要求表
    （要求表有「名称」+「要求」两个真实有值的列）。"""
    if not rows or len(rows) < 2 or len(rows) > 300:
        return False
    maxcols = max((len(r) for r in rows), default=0)
    if not (2 <= maxcols <= 40):
        return False
    return effective_cols(rows) >= 2


def bbox_cover(a, b):
    """a 被 b 覆盖的比例（交/ a 面积）。"""
    ix0 = max(a[0], b[0])
    iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2])
    iy1 = min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    return inter / area_a if area_a > 0 else 0.0


def extract_page_pdfplumber(page):
    """对一页跑全部策略，按区域择优，返回候选列表。"""
    candidates = []
    for name, settings in STRATEGIES:
        try:
            tables = page.find_tables(table_settings=settings)
        except Exception:
            tables = []
        for t in tables:
            try:
                rows = drop_empty_rows(t.extract())
            except Exception:
                continue
            if not valid_shape(rows) or looks_like_toc(rows):
                continue
            score, fill = score_rows(rows)
            candidates.append({
                "bbox": [round(float(x), 1) for x in t.bbox],
                "rows": rows,
                "score": score,
                "fill": round(fill, 3),
                "strategy": name,
            })
    # 按区域去重：高分优先，与已选区域重叠 >0.5 的丢弃
    candidates.sort(key=lambda c: -c["score"])
    selected = []
    for c in candidates:
        if any(
            bbox_cover(c["bbox"], s["bbox"]) > 0.5
            or bbox_cover(s["bbox"], c["bbox"]) > 0.5
            for s in selected
        ):
            continue
        selected.append(c)
    return selected


def extract_page_fitz(fpage):
    """PyMuPDF 兜底：返回候选列表（仅在 pdfplumber 一无所获时调用）。"""
    out = []
    try:
        finder = fpage.find_tables()
    except Exception:
        return out
    for t in getattr(finder, "tables", []):
        try:
            rows = drop_empty_rows(t.extract())
        except Exception:
            continue
        if not valid_shape(rows) or looks_like_toc(rows):
            continue
        score, fill = score_rows(rows)
        bbox = [round(float(x), 1) for x in t.bbox]
        out.append({
            "bbox": bbox,
            "rows": rows,
            "score": score,
            "fill": round(fill, 3),
            "strategy": "fitz",
        })
    return out


def page_is_scanned(page):
    """无可提取文字但有图像 → 扫描页。"""
    try:
        txt = (page.extract_text() or "").strip()
        if txt:
            return False
        return len(page.images) > 0
    except Exception:
        return False


def main():
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"error": "missing pdf path"}, ensure_ascii=False))
        sys.exit(2)
    pdf_path = sys.argv[1]

    # 隔离库输出：把 fd 1（stdout）重定向到 devnull，真实 stdout 句柄留作最终 JSON。
    # pdfplumber/pdfminer 的告警、PyMuPDF 的 "Consider using pymupdf_layout" 提示、
    # MuPDF C 层消息都写 fd 1，若不隔离会污染 JSON，导致 Node 侧解析失败。
    real_fd = os.dup(1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 1)

    def emit(obj, code=0):
        os.write(real_fd, json.dumps(obj, ensure_ascii=False).encode("utf-8"))
        os._exit(code)

    try:
        import pdfplumber
    except Exception as e:
        emit({"error": "pdfplumber not available: %s" % e}, 3)

    # fitz 可选
    fdoc = None
    try:
        import fitz
        try:
            fitz.TOOLS.mupdf_display_errors(False)
        except Exception:
            pass
        fdoc = fitz.open(pdf_path)
    except Exception:
        fdoc = None

    out = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for idx, page in enumerate(pdf.pages):
                selected = extract_page_pdfplumber(page)

                # pdfplumber 全策略无果 → fitz 兜底
                if not selected and fdoc is not None and idx < fdoc.page_count:
                    try:
                        selected = extract_page_fitz(fdoc[idx])
                    except Exception:
                        selected = []

                scanned = page_is_scanned(page) if not selected else False

                for c in selected:
                    title = find_title(page, float(c["bbox"][1]))
                    out.append({
                        "page": idx + 1,
                        "bbox": c["bbox"],
                        "title": title,
                        "rows": c["rows"],
                        "strategy": c["strategy"],
                        "fill": c["fill"],
                        "scanned": False,
                    })

                # 扫描页：视觉识别(GLM-4V)优先，否则 Tesseract OCR（供上层转可检索段落）。
                if scanned:
                    ocr_text = ""
                    if fdoc is not None and idx < fdoc.page_count:
                        if VISION_ENABLED:
                            ocr_text = vision_page(fdoc[idx])
                        if not ocr_text and OCR_ENABLED:
                            ocr_text = ocr_page(fdoc[idx])
                    out.append({
                        "page": idx + 1,
                        "bbox": None,
                        "title": None,
                        "rows": [],
                        "strategy": "scanned",
                        "fill": 0.0,
                        "scanned": True,
                        "ocrText": ocr_text,
                    })
    except Exception as e:
        emit({"error": "parse failed: %s" % e}, 4)
    finally:
        if fdoc is not None:
            try:
                fdoc.close()
            except Exception:
                pass

    emit(out, 0)


if __name__ == "__main__":
    main()
