# -*- coding: utf-8 -*-
"""
生成 data.js（班级 / 小组 / 成员 / 全班官方名单）。

数据来源：
  1) 分组表  —— Desktop\\workbuddy\\分组\\*.xlsx        （谁在哪一组）
  2) 考勤表  —— 教务系统导出的「XX班(电气接线原理)考勤表.xls」（全班官方名单 + 学号）

用法：
    python tools/build_data.py

产物：data.js，含
    classes[i].groups  = 已分好组的成员
    classes[i].roster  = 全班官方名单（按学号排序），供「待分配名单」页比对
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GROUP_DIR = os.path.join(ROOT, "教学材料", "分组")
OUT = os.path.join(ROOT, "data.js")

ORDER = ["26工器1班", "26工器2班", "26电气5班", "26电气6班", "26电气7班", "26电气8班", "通用版"]

# 找考勤表的搜索根目录（按需增删；会递归找「<班级>(电气接线原理)考勤表*.xls」）
ROSTER_ROOTS = [os.path.join(ROOT, "教学材料", "考勤原表")]

ROSTER_SKIP = ("node_modules", ".git", "$RECYCLE.BIN")

NAME_RE = re.compile(r"^(.*?)\s*(\d{1,3})$")


# ---------------------------------------------------------------- 读取

def split_member(raw):
    """'张三 05' -> ('张三','05')；'李四46' -> ('李四','46')；无学号则 sid 为空。"""
    s = str(raw).strip()
    if not s:
        return None
    m = NAME_RE.match(s)
    return (m.group(1).strip(), m.group(2)) if m else (s, "")


def read_groups(path):
    """从分组表读 {组号: [(姓名, 学号), ...]}，顺带记录同组重名。"""
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    info = str(ws.cell(2, 1).value or "")
    m = re.search(r"班级[：:]\s*([^\s]+)", info)
    cls_name = m.group(1) if m else os.path.basename(path)
    t = re.search(r"教师[：:]\s*([^\s]+)", info)
    teacher = t.group(1) if t else ""

    groups, dup = {}, []
    for r in range(7, ws.max_row + 1):
        v = ws.cell(r, 1).value
        if not isinstance(v, int):
            continue
        members, seen = [], set()
        for c in range(2, 8):  # B..G 成员1-6
            cell = ws.cell(r, c).value
            if cell is None or not str(cell).strip():
                continue
            nm, sid = split_member(cell)
            if nm in seen:                      # 同一组里重名 —— 判为重复填写，丢弃
                dup.append((v, nm, sid))
                continue
            seen.add(nm)
            members.append({"name": nm, "sid": sid})
        groups[v] = members
    wb.close()

    # 尾部「有编号但无成员」的占位组：本班已有名单时丢弃
    nos = sorted(groups)
    if any(groups[n] for n in nos):
        while nos and not groups[nos[-1]]:
            groups.pop(nos.pop())
    return cls_name, teacher, groups, dup


def find_roster(cls_name):
    """在 ROSTER_ROOTS 里找该班的考勤表，多个候选取最新修改的那个。"""
    pat = "%s(电气接线原理)考勤表*.xls" % cls_name
    hits = []
    for base in ROSTER_ROOTS:
        if not os.path.isdir(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in ROSTER_SKIP and not d.startswith("$")]
            if root.count(os.sep) - base.count(os.sep) > 6:
                dirs[:] = []
                continue
            for f in files:
                if re.match(re.escape(cls_name) + r"\(电气接线原理\)考勤表.*\.xls$", f):
                    hits.append(os.path.join(root, f))
    if not hits:
        return None
    return max(hits, key=os.path.getmtime)


def read_roster(path):
    """从考勤表读全班官方名单 [(序号, 学号, 姓名), ...]。

    注意：分组表里写的「张三 05」中的 05 是**班内序号**（恰好是学号末两位，
    但转专业/复学的学生会例外），完整学号以考勤表为准。两者都保留。"""
    import xlrd

    wb = xlrd.open_workbook(path)
    sh = wb.sheets()[0]
    out = []
    for r in range(sh.nrows):
        a, b, c = sh.cell_value(r, 0), sh.cell_value(r, 1), sh.cell_value(r, 2)
        if (isinstance(a, float) and a == int(a)
                and isinstance(b, str) and b.strip()
                and isinstance(c, str) and c.strip()):
            out.append((int(a), str(b).strip(), str(c).strip()))   # (序号, 学号, 姓名)
    return out


# ---------------------------------------------------------------- 组装

def main():
    # 分组表
    group_files = {}
    for p in glob.glob(os.path.join(GROUP_DIR, "*.xlsx")):
        base = os.path.basename(p)
        if base.startswith("~") or base.startswith("_"):
            continue
        group_files[base] = p

    classes, report = [], []
    for name in ORDER:
        hit = None
        for base, p in group_files.items():
            if name == "通用版":
                if base.startswith("课堂分组与加分记录表"):
                    hit = p
                    break
            elif base.startswith(name):
                hit = p
                break
        if not hit:
            print("[WARN] 找不到班级分组表：%s" % name, file=sys.stderr)
            continue

        cls_name, teacher, groups, dup = read_groups(hit)
        short = name if name == "通用版" else cls_name

        # 官方名单
        roster, roster_src = [], ""
        if name != "通用版":
            rp = find_roster(short)
            if rp:
                roster = read_roster(rp)
                roster_src = os.path.basename(rp)
            else:
                print("[WARN] %s 没找到考勤表，全班名单留空" % short, file=sys.stderr)

        # 用官方名单补齐分组成员的「完整学号 + 班内序号」
        info_of = {nm: (sid, no) for no, sid, nm in roster}
        filled = 0
        for no in groups:
            for mem in groups[no]:
                hit = info_of.get(mem["name"])
                if hit:
                    mem["sid"], mem["no"] = hit[0], hit[1]
                    filled += 1

        placed = {m["name"] for no in groups for m in groups[no]}
        unassigned = [(no, sid, nm) for no, sid, nm in roster if nm not in placed]
        off_roster = sorted({m["name"] for no in groups for m in groups[no]}
                            - {nm for _, _, nm in roster})

        classes.append({
            "id": "c%d" % (len(classes) + 1),
            "name": short,
            "teacher": teacher,
            "groups": [{"no": no, "members": groups[no]} for no in sorted(groups)],
            "roster": [{"no": no, "sid": sid, "name": nm} for no, sid, nm in roster],
        })

        report.append((short, len(roster), sum(len(g["members"]) for g in classes[-1]["groups"]),
                       len(unassigned), roster_src, filled, dup, off_roster))

    data = {"source": "分组/*.xlsx + 考勤表", "classes": classes}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 由 tools/build_data.py 自动生成，请勿手工编辑（重跑会被覆盖）。\n")
        f.write("// 页面里改的名单/分数存在浏览器本地，不受本文件影响。\n")
        f.write("window.SEED_DATA = ")
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(";\n")

    print("\n%-12s %6s %6s %8s  %s" % ("班级", "官方", "已分组", "待分配", "来源"))
    print("-" * 78)
    for short, n_roster, n_placed, n_un, src, filled, dup, off in report:
        print("%-12s %6d %6d %8d  %s" % (short, n_roster, n_placed, n_un, src or "—"))
    print("-" * 78)
    print("合计 官方 %d 人 / 已分组 %d 人 / 待分配 %d 人" % (
        sum(r[1] for r in report), sum(r[2] for r in report), sum(r[3] for r in report)))
    for short, _, _, _, _, filled, dup, off in report:
        if filled:
            print("  · %s：已按官方名单补全 %d 人的完整学号与序号" % (short, filled))
        for no, nm, sid in dup:
            print("  · %s：第 %d 组「%s %s」重复填写，已按重复丢弃" % (short, no, nm, sid))
        if off:
            print("  · %s：分组里有 %s 不在官方名单中（转专业/复学？）" % (short, "、".join(off)))
    print("\n已写出 %s" % OUT)


if __name__ == "__main__":
    main()
