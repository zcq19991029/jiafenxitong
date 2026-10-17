# -*- coding: utf-8 -*-
"""重新生成「打印样张」：A4 纵向的本课记录 + A4 横向的积分总览。

做法和网页里点「打印」完全一样——只是把 window.print() 打桩掉，
再让 Chrome 的 --print-to-pdf 走真正的打印排版（这样出的是真·打印效果，不是截图）。

用法：先起本地服务（python -m http.server 8765 --bind 127.0.0.1），再
    python tools/make_print.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "效果预览")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = os.environ.get("SHOT_BASE", "http://127.0.0.1:8765")

# 页面名: (打印哪个区, 输出文件名)
JOBS = [
    ("print=lesson", "打印样张·本课记录"),
    ("print=rank", "打印样张·积分总览"),
]


def pdf(job, dest):
    url = "%s/_shot_cloud.html?gate=admin&c=c1&v=score&%s" % (BASE, job)
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
        "--virtual-time-budget=6000",
        "--no-pdf-header-footer",
        "--print-to-pdf=" + dest,
        url,
    ]
    r = subprocess.run(cmd, capture_output=True)
    if not os.path.exists(dest):
        sys.stderr.write(r.stderr.decode("utf-8", "ignore")[-800:])
        raise SystemExit("没能生成 " + dest)


def png(dest_pdf, dest_png, dpi=150):
    import pymupdf                                   # noqa: PLC0415
    doc = pymupdf.open(dest_pdf)
    page = doc[0]
    pix = page.get_pixmap(dpi=dpi)
    pix.save(dest_png)
    return doc.page_count


def main():
    os.makedirs(OUT, exist_ok=True)
    for job, name in JOBS:
        p = os.path.join(OUT, name + ".pdf")
        pdf(job, p)
        n = png(p, os.path.join(OUT, name + ".png"))
        print("已生成 %s.pdf（%d 页）+ .png" % (name, n))


if __name__ == "__main__":
    main()
