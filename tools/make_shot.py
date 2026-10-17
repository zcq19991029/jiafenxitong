# -*- coding: utf-8 -*-
"""生成一张「演示数据版」页面用于截图（截图完可删）。
   _shot.html = index.html + 一段先把演示数据写进 localStorage 的脚本。
   因为同源，localStorage 与正式页面共用，不会影响 index.html。"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
    html = f.read()

DEMO = {
    "version": 1,
    "lessons": [
        {
            "id": "l_demo_1", "classId": "c1", "seq": 3, "date": "2026-10-15",
            "topic": "三相异步电动机正反转接线", "dutyGroup": 5,
            "scores": {
                "1": {"first": 1, "group": 7, "phone": 0, "duty": 0, "personal": {}},
                "2": {"first": 0, "group": 5, "phone": 1, "duty": 0, "personal": {"0": 1}},
                "3": {"first": 0, "group": 9, "phone": 0, "duty": 0, "personal": {}},
                "5": {"first": 1, "group": 8, "phone": 0, "duty": 3, "personal": {}},
                "7": {"first": 1, "group": 10, "phone": 0, "duty": 0, "personal": {}},
                "8": {"first": 0, "group": 6, "phone": 0, "duty": 0, "personal": {"1": 2}},
                "13": {"first": 0, "group": 3, "phone": 3, "duty": 0, "personal": {}},
            },
        },
        {
            "id": "l_demo_2", "classId": "c1", "seq": 1, "date": "2026-10-08",
            "topic": "项目一 导线的连接与绝缘恢复", "dutyGroup": 3,
            "scores": {
                "1": {"first": 0, "group": 6, "phone": 0, "duty": 0, "personal": {}},
                "3": {"first": 1, "group": 8, "phone": 0, "duty": 4, "personal": {}},
                "5": {"first": 0, "group": 7, "phone": 0, "duty": 0, "personal": {}},
                "7": {"first": 1, "group": 9, "phone": 0, "duty": 0, "personal": {}},
            },
        },
        {
            "id": "l_demo_3", "classId": "c1", "seq": 2, "date": "2026-10-12",
            "topic": "低压电器的认识与检测", "dutyGroup": 9,
            "scores": {
                "1": {"first": 1, "group": 8, "phone": 0, "duty": 0, "personal": {}},
                "3": {"first": 0, "group": 10, "phone": 0, "duty": 0, "personal": {}},
                "5": {"first": 0, "group": 6, "phone": 0, "duty": 0, "personal": {}},
                "9": {"first": 1, "group": 7, "phone": 0, "duty": 4, "personal": {}},
                "11": {"first": 0, "group": 4, "phone": 1, "duty": 0, "personal": {}},
            },
        },
    ],
    "ui": {"classId": "c1", "lessonId": "l_demo_1"},
    "updatedAt": "2026-10-15T22:30:00+08:00",
}

seed = """
<script>
(function(){
  var raw = localStorage.getItem('jfdt.v1');
  if (raw) return;                      // 已有真实数据就不要覆盖
  var demo = %s;
  var s = JSON.parse(localStorage.getItem('__seed_classes__') || 'null');
  demo.classes = (window.SEED_DATA && window.SEED_DATA.classes) || [];
  demo.classes.forEach(function(c){
    c.groups.forEach(function(g){
      g.id = g.id || ('g'+c.id+'_'+g.no);
      g.members.forEach(function(m,i){ m.id = m.id || (g.id+'_m'+i); });
    });
  });
  localStorage.setItem('jfdt.v1', JSON.stringify(demo));
})();
</script>
""" % json.dumps(DEMO, ensure_ascii=False)

html = html.replace(
    '<script src="app.js"></script>',
    seed + '\n<script src="app.js"></script>'
)

# 支持 ?v=rank / ?v=data / ?v=pool 直接切到对应页签（app.js 已在此之前同步执行完毕）
# ?c=c7 —— 顺便把班级也切到指定班级（截图用）
html = html.replace("</body>", """
<script>
(function(){
  var c = (location.search.match(/c=(\\w+)/) || [])[1];
  if (c) {
    ['#poolClassSel', '#classSel', '#rankClassSel'].forEach(function(sel){
      var el = document.querySelector(sel);
      if (el && el.querySelector('option[value="' + c + '"]')) {
        el.value = c;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  var v = (location.search.match(/v=(\\w+)/) || [])[1];
  if (v) {
    var b = document.querySelector('#tabs button[data-view="' + v + '"]');
    if (b) b.click();
  }
  // ?lay=card|table —— 切记分页的布局（截图用）
  var lay = (location.search.match(/lay=(\\w+)/) || [])[1];
  if (lay) {
    var lb = document.querySelector('#layoutSeg button[data-l="' + lay + '"]');
    if (lb) lb.click();
  }
  // ?print=rank|lesson —— 填好打印区但不真的弹打印（供 --print-to-pdf 用）
  var pt = (location.search.match(/print=(\\w+)/) || [])[1];
  if (pt) {
    window.print = function(){};
    var btn = pt === 'lesson'
      ? document.querySelector('#btnPrintLesson')
      : document.querySelector('#btnPrintRank');
    if (btn) btn.click();
  }
})();
</script>
</body>""")

# ?diag=1 —— 找出所有把页面撑宽的元素，只输出诊断清单
DIAG_SCRIPT = """
<script>
(function(){
  if (!/diag=1/.test(location.search)) return;
  setTimeout(function(){
    var vw = document.documentElement.clientWidth;
    var out = ['VIEWPORT=' + vw,
               'BODY.scrollWidth=' + document.body.scrollWidth,
               'DOC.scrollWidth=' + document.documentElement.scrollWidth];
    // 卡片的最小内容宽度：只要它小于最窄手机（360），任何宽度都不会溢出
    var probe = document.querySelector('.gcard');
    if (probe) {
      var keepW = probe.style.width, keepD = probe.style.display;
      probe.style.width = 'min-content';
      out.push('CARD_MIN_CONTENT=' + Math.round(probe.getBoundingClientRect().width));
      probe.style.width = keepW; probe.style.display = keepD;
    }
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      var r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      // 自己开了横向滚动条的容器（.tablewrap / .tabs / .sheetwrap）不算溢出
      var cs = getComputedStyle(e);
      var scrollable = /auto|scroll/.test(cs.overflowX);
      if (r.right > vw + 1 || (!scrollable && e.scrollWidth > e.clientWidth + 1)) {
        var id = e.tagName.toLowerCase() +
          (e.id ? '#' + e.id : '') +
          (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
        out.push('  ' + id + '  w=' + Math.round(r.width) + ' right=' + Math.round(r.right) +
                 ' scrollW=' + e.scrollWidth + ' clientW=' + e.clientWidth +
                 (e.parentElement ? '  <- parent ' + e.parentElement.tagName.toLowerCase() +
                   (e.parentElement.className && typeof e.parentElement.className === 'string'
                     ? '.' + e.parentElement.className.trim().split(/\\s+/).join('.') : '') : ''));
      }
    }
    document.documentElement.innerHTML = '<pre id="DIAG">' + out.join('\\n') + '</pre>';
  }, 1400);
})();
</script>
"""

html = html.replace("</body>", DIAG_SCRIPT + "</body>")


out = os.path.join(ROOT, "_shot.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print("已生成", out)


# --------------------------------------------------------------------------
# _shot_cloud.html —— 用假 SDK 把「登录 / 邀请码 / 管理页」渲染出来截图
#   ?gate=login | invite | admin
# 只为出预览图，不碰真网络；同样已 gitignore。
# --------------------------------------------------------------------------

IMPORTS = {"A": "赵", "B": "李", "C": "王"}

FAKE = """
<script>
(function(){
  var gate = (location.search.match(/gate=(\\w+)/) || [])[1] || 'invite';
  var ME = { user: { id: 'uid_me', name: '赵成乾', avatarUrl: '' } };
  var SESSION = gate === 'login' ? null : ME;

  function cls(name, gnos, memPer) {
    var groups = [], roster = [];
    for (var n = 1; n <= gnos; n++) {
      var members = [];
      for (var i = 0; i < memPer; i++) {
        members.push({ id: 'm' + n + '_' + i, name: '学生' + n + '-' + (i + 1),
                       sid: '2630310' + n + '0' + i, no: (n - 1) * memPer + i + 1 });
      }
      groups.push({ id: 'g' + n, no: n, members: members });
      members.forEach(function (m) { roster.push({ no: m.no, sid: m.sid, name: m.name }); });
    }
    return { id: 'c_' + name, name: name, teacher: '赵成乾', groups: groups, roster: roster };
  }

  var INVITES = [
    { code: 'K7QM-3PXN', note: '李老师 / 电气教研组', role: 'teacher', is_used: true,
      used_at: '2026-10-15T02:10:00Z', disabled: false, created_at: '2026-10-14T01:00:00Z', used_by_name: '李伟' },
    { code: 'R2HD-9WFK', note: '王老师 / 电气教研组', role: 'teacher', is_used: true,
      used_at: '2026-10-15T08:40:00Z', disabled: false, created_at: '2026-10-14T01:00:00Z', used_by_name: '王芳' },
    { code: 'T4YN-6BJM', note: '备用（还没发出去）', role: 'teacher', is_used: false,
      used_at: null, disabled: false, created_at: '2026-10-15T09:00:00Z', used_by_name: null },
    { code: 'X9GF-7QVR', note: '备用管理员', role: 'admin', is_used: false,
      used_at: null, disabled: false, created_at: '2026-10-15T09:00:00Z', used_by_name: null }
  ];

  var TEACHERS = [
    { uid: 'uid_me', display_name: '赵成乾', real_name: null, is_admin: true,
      joined_at: '2026-10-14T01:00:00Z', synced_at: '2026-10-15T09:52:00Z', class_count: 7, lesson_count: 3 },
    { uid: 'uid_li', display_name: '李伟', real_name: null, is_admin: false,
      joined_at: '2026-10-15T02:10:00Z', synced_at: '2026-10-15T09:48:00Z', class_count: 4, lesson_count: 8 },
    { uid: 'uid_wang', display_name: '王芳', real_name: null, is_admin: false,
      joined_at: '2026-10-15T08:40:00Z', synced_at: '2026-10-15T09:30:00Z', class_count: 3, lesson_count: 5 }
  ];

  /* 「老师与数据」弹窗要真有一份别人的班级数据才看得出宽窗口的效果 */
  var ADMIN_CLASSES = [cls('26工器1班', 13, 4), cls('26工器2班', 12, 4)];
  var ADMIN_LESSONS = [
    { id: 'al1', classId: 'c_26工器1班', seq: 1, date: '2026-10-08', scores: {
      '1': { first: 1, group: 8, phone: 0, duty: 0, personal: {} },
      '3': { first: 0, group: 6, phone: 1, duty: 0, personal: {} },
      '5': { first: 1, group: 9, phone: 0, duty: 3, personal: {} } } },
    { id: 'al2', classId: 'c_26工器1班', seq: 2, date: '2026-10-12', scores: {
      '1': { first: 0, group: 7, phone: 0, duty: 0, personal: {} },
      '9': { first: 1, group: 10, phone: 0, duty: 0, personal: {} } } },
    { id: 'al3', classId: 'c_26工器2班', seq: 1, date: '2026-10-09', scores: {
      '2': { first: 1, group: 5, phone: 0, duty: 0, personal: {} } } }
  ];

  window.WorkBuddyCloud = {
    createWorkBuddyCloud: function () {
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: SESSION, error: null }); },
          signInWithOAuth: function () { return Promise.resolve({ data: { url: '#wx' }, error: null }); },
          handleWechatWebCallback: function () { return Promise.resolve({ data: null, error: null }); },
          handleWorkBuddyCallback: function () { return Promise.resolve({ data: null, error: null }); },
          signOut: function () { return Promise.resolve({ data: null, error: null }); }
        },
        database: {
          rpc: function (name, p) {
            var v = null;
            if (name === 'my_profile') {
              v = gate === 'invite' ? null
                : { display_name: '赵成乾', is_admin: gate === 'admin', created_at: '2026-10-14T01:00:00Z' };
            } else if (name === 'my_state') {
              v = { updated_at: '2026-10-15T09:52:00Z', owner_name: '赵成乾',
                    data: { version: 1, updatedAt: '2026-10-15T09:52:00Z', classes: [], lessons: [], undo: [] } };
            } else if (name === 'admin_list_invites') { v = INVITES; }
            else if (name === 'admin_list_teachers') { v = TEACHERS; }
            else if (name === 'admin_get_state') {
              v = { ok: true, updated_at: '2026-10-15T09:52:00Z',
                    data: { version: 1, classes: ADMIN_CLASSES, lessons: ADMIN_LESSONS } };
            }
            else if (name === 'redeem_invite') { v = { ok: true, is_admin: false }; }
            else if (name === 'update_my_profile') { v = { ok: true }; }
            return Promise.resolve({ data: v, error: null });
          }
        }
      };
    }
  };
})();
</script>
"""

with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
    chtml = f.read()

# 摘掉真 CDN，换成假 SDK（假 SDK 必须在 cloud.js 之前执行）
chtml = chtml.replace(
    '<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"></script>',
    FAKE
)

# 演示数据必须赶在 app.js 之前写进 localStorage，否则页面启动时读到的是空的。
# （cloud.js 之前 = data.js 已加载、页面还没渲染，正好）
chtml = chtml.replace(
    '<script src="cloud.js"></script>',
    seed + '\n<script src="cloud.js"></script>'
)

# 演示数据 + 进到指定页签（等云端 boot 完成后再切）
chtml = chtml.replace("</body>", """
<script>
(function(){
  var raw = localStorage.getItem('jfdt.v1');
  if (raw) return;
  var demo = %s;
  demo.classes = (window.SEED_DATA && window.SEED_DATA.classes) || [];
  demo.classes.forEach(function(c){
    c.groups.forEach(function(g){
      g.id = g.id || ('g'+c.id+'_'+g.no);
      g.members.forEach(function(m,i){ m.id = m.id || (g.id+'_m'+i); });
    });
  });
  localStorage.setItem('jfdt.v1', JSON.stringify(demo));
})();
(function(){
  // 云端 boot 是异步的，切页签/换班级都得等它落地之后再点，否则会被 startApp 覆盖回去
  setTimeout(function(){
    var c = (location.search.match(/c=(\\w+)/) || [])[1];
    if (c) {
      ['#poolClassSel', '#classSel', '#rankClassSel'].forEach(function(sel){
        var el = document.querySelector(sel);
        if (el && el.querySelector('option[value="' + c + '"]')) {
          el.value = c;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  }, 1200);
  setTimeout(function(){
    var lay = (location.search.match(/lay=(\\w+)/) || [])[1];
    if (lay) {
      var lb = document.querySelector('#layoutSeg button[data-l="' + lay + '"]');
      if (lb) lb.click();
    }
    var v = (location.search.match(/v=(\\w+)/) || [])[1];
    var b = v && document.querySelector('#tabs button[data-view="' + v + '"]');
    if (b && !b.hidden) b.click();
    // ?me=1 —— 打开「个人信息」弹窗
    if (/me=1/.test(location.search)) {
      var mb = document.querySelector('#btnMe');
      if (mb && !mb.closest('#userBox').hidden) mb.click();
    }
    // ?dlg=lesson|teacher|student|me —— 直接掰开某个弹窗拍照
    // 有的按钮要等异步列表渲染出来才有（老师与数据就是一例），所以轮询几秒
    var dlgWant = (location.search.match(/dlg=(\\w+)/) || [])[1];
    var dlgSel = { lesson: '#btnNewLesson', student: '#btnPoolAdd',
                   teacher: '#teacherList [data-look]', me: '#btnMe' }[dlgWant];
    if (dlgSel) {
      var tries = 0;
      var openIt = setInterval(function () {
        var btn = document.querySelector(dlgSel);
        var usable = btn && !(btn.closest('[hidden]'));
        if (usable) { btn.click(); clearInterval(openIt); }
        else if (++tries > 30) { clearInterval(openIt); }
      }, 120);
    }
    // ?toast=1 —— 到 2.3s 再真的做一次保存，好让 3.2s 的截图能拍到"保存成功"那条提示
    if (/toast=1/.test(location.search)) {
      setTimeout(function () {
        var sel = document.querySelector('#poolList select.assign');
        if (sel) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }, 400);
    }
    var pt = (location.search.match(/print=(\\w+)/) || [])[1];
    if (pt) {
      window.print = function(){};
      var pb = pt === 'lesson'
        ? document.querySelector('#btnPrintLesson')
        : document.querySelector('#btnPrintRank');
      if (pb) pb.click();
    }
  }, 1900);
})();
</script>
</body>""" % json.dumps(DEMO, ensure_ascii=False))

cout = os.path.join(ROOT, "_shot_cloud.html")
with open(cout, "w", encoding="utf-8") as f:
    f.write(chtml)
print("已生成", cout)

# 云端预览页同样支持 ?diag=1 溢出诊断
with open(cout, encoding="utf-8") as f:
    base = f.read()
base = base.replace("</body>", DIAG_SCRIPT + "</body>")
with open(cout, "w", encoding="utf-8") as f:
    f.write(base)

