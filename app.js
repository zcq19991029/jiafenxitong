/* 夜夜加分助手 —— 主逻辑
   数据全部保存在本机 localStorage，无需网络、无需服务器。 */
(function () {
  'use strict';

  var LS_KEY = 'jfdt.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ================= 工具 ================= */

  function uid(p) {
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function clamp(v, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    return n > 0 ? '+' + n : (n < 0 ? '−' + Math.abs(n) : '0');
  }

  function signClass(n) {
    return n > 0 ? 'pos' : (n < 0 ? 'neg' : '');
  }

  /** 打开 <dialog>。极老的浏览器没有 showModal，退化成 open 属性，
      总比点按钮「什么都不发生」强。 */
  function openDlg(d) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  /** 弹窗都按 Windows 窗口的习惯来：点旁边的空白也能随手关掉。
      Esc 和标题栏那个 ✕ 是浏览器原生行为，不用管。 */
  function wireDialog(d) {
    var down = null;
    d.addEventListener('pointerdown', function (ev) {
      down = (ev.target === d) ? { x: ev.clientX, y: ev.clientY } : null;
    });
    d.addEventListener('click', function (ev) {
      var from = down;
      down = null;
      if (ev.target !== d || !from) return;            // 点在内容上 → 不关
      /* 移动过一段距离 = 在拉右下角缩放（拖拽结束时也会冒一个 click），别误关 */
      if (Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) > 6) return;
      /* 正好落在缩放手柄上 → 也不关 */
      var r = d.getBoundingClientRect();
      if (ev.clientX >= r.right - 24 && ev.clientY >= r.bottom - 24) return;
      if (typeof d.close === 'function') d.close();
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('dialog'), wireDialog);

  /* ================= 状态 ================= */

  var S = null;
  var saveTimer = null;
  /* 云端模块（cloud.js）。没有它（比如离线打开、或被浏览器拦了 CDN）就退化成纯本机模式，
     界面上会明确写出来，不会偷偷当成"已同步"。 */
  var CLOUD = window.JFDT_CLOUD || null;
  var CLOUD_ON = false;      // 云端真的可用（已登录且已激活）
  var cloudRec = null;       // 最近一次从云端拉到的记录

  function defaultState() {
    var seed = window.SEED_DATA;
    if (!seed || !seed.classes) return null;
    var classes = JSON.parse(JSON.stringify(seed.classes));
    classes.forEach(function (c) {
      c.groups.forEach(function (g) {
        if (!g.id) g.id = uid('g');
        g.members.forEach(function (m) {
          if (!m.id) m.id = uid('m');
        });
      });
    });
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      classes: classes,
      lessons: [],
      undo: [],
      ui: { classId: classes[0] ? classes[0].id : null, lessonId: null, scoreLayout: null }
    };
  }

  /** 老数据迁移：补上全班名单（roster），并把分组成员的完整学号/班内序号补齐。
      老版本只存了「姓名 + 短序号」，这里按姓名与官方名单对上。 */
  function migrate(s) {
    var seed = window.SEED_DATA;
    if (!s.undo) s.undo = [];
    if (!s.ui) s.ui = {};
    if (!seed || !seed.classes) return s;
    var byName = {};
    seed.classes.forEach(function (c) { byName[c.name] = c; });
    s.classes.forEach(function (c) {
      if (!c.roster || !c.roster.length) {
        var sc = byName[c.name];
        if (sc && sc.roster) c.roster = JSON.parse(JSON.stringify(sc.roster));
      }
      var idx = {};
      rosterOf(c).forEach(function (r) { if (r.name) idx[r.name] = r; });
      c.groups.forEach(function (g) {
        g.members.forEach(function (m) {
          if (m.id == null) m.id = uid('m');
          var hit = idx[m.name];
          if (!hit) return;
          if (m.no == null) m.no = hit.no;
          if (!m.sid || !/^\d{8,}$/.test(String(m.sid))) m.sid = hit.sid;
        });
      });
    });
    return s;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* 隐私模式 */ }
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.classes && s.lessons) return migrate(s);
      } catch (e) { /* 损坏则重建 */ }
    }
    return defaultState();
  }

  function save(flash) {
    S.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
    } catch (e) {
      $('#saveState').textContent = '⚠ 保存失败：浏览器存储已满或被禁用';
      return;
    }
    if (flash !== false) {
      var el = $('#saveState');
      var d = new Date();
      el.textContent = '已保存 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
      el.classList.add('flash');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { el.classList.remove('flash'); }, 1200);
    }
    /* 本机先落盘，云端在后台合并推送；离线时排队等恢复 */
    if (CLOUD && CLOUD_ON) CLOUD.touch(function () { return S; });
  }

  /* ================= 查询 ================= */

  function getClass(id) {
    for (var i = 0; i < S.classes.length; i++) if (S.classes[i].id === id) return S.classes[i];
    return null;
  }

  function lessonsOf(classId) {
    return S.lessons.filter(function (l) { return l.classId === classId; })
      .sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
  }

  function getLesson(id) {
    for (var i = 0; i < S.lessons.length; i++) if (S.lessons[i].id === id) return S.lessons[i];
    return null;
  }

  function sc(lesson, gno) {
    var k = String(gno);
    if (!lesson.scores[k]) lesson.scores[k] = { first: 0, group: 0, phone: 0, duty: 0, personal: {} };
    return lesson.scores[k];
  }

  function groupOf(cls, gno) {
    for (var i = 0; i < cls.groups.length; i++) if (cls.groups[i].no === gno) return cls.groups[i];
    return null;
  }

  /* ================= 全班名单 / 待分配 ================= */

var GROUP_CAP = 6;          // 一张小组卡最多 6 个成员位

function rosterOf(cls) {
  if (!cls.roster) cls.roster = [];
  return cls.roster;
}

/** 实际有名字的成员数（名单页可能留了空占位格，末尾的空格不算） */
function memberCount(g) {
  var n = g.members.length;
  while (n > 0 && !g.members[n - 1].name) n--;
  return n;
}

/** 末尾的空占位格先清掉再追加，免得名单里出现「空一格再是人」 */
function pushMember(g, m) {
  while (g.members.length && !g.members[g.members.length - 1].name) g.members.pop();
  g.members.push(m);
}

/** 从组里移除第 j 个成员。
    个人扣分是按「组内位置」存的，删掉中间一个人会让后面所有人的扣分错位，
    所以这里把所有历史课次里该组的 personal 索引一并左移。 */
function removeMemberAt(cls, g, j) {
  g.members.splice(j, 1);
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id) return;
    var s = l.scores[String(g.no)];
    if (!s || !s.personal) return;
    var np = {};
    Object.keys(s.personal).forEach(function (k) {
      var i = +k;
      if (i === j) return;
      np[String(i > j ? i - 1 : i)] = s.personal[k];
    });
    s.personal = np;
  });
}

  /** 姓名 / 学号 → 所在组号 */
  function placedMap(cls) {
    var byName = {}, bySid = {};
    cls.groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        byName[m.name] = g.no;
        if (m.sid) bySid[m.sid] = g.no;
      });
    });
    return { byName: byName, bySid: bySid };
  }

  /** 该生在哪个组；未分配返回 null。优先按学号匹配，再退回姓名。 */
  function groupOfStudent(cls, r, map) {
    map = map || placedMap(cls);
    if (r.sid && map.bySid[r.sid] !== undefined) return map.bySid[r.sid];
    if (map.byName[r.name] !== undefined) return map.byName[r.name];
    return null;
  }

  /** 全班名单里还没进组的学生 */
  function pendingList(cls) {
    if (!cls) return [];
    var map = placedMap(cls);
    return rosterOf(cls).filter(function (r) { return groupOfStudent(cls, r, map) === null; });
  }

  /** 所有班级加起来还有多少人没分配 */
  function pendingTotal() {
    return S.classes.reduce(function (a, c) { return a + pendingList(c).length; }, 0);
  }

  /* ================= 计算 ================= */

  /** 单个小组某节课的「本节合计」：首个正确 + 小组分 + 值日分 − 手机未入袋人数
      （个人扣分不计入小组，单独记在个人头上） */
  function groupTotal(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return 0;
    return (s.first ? 1 : 0) + (+s.group || 0) + (+s.duty || 0) - (+s.phone || 0);
  }

  /** 小组累计（该班全部课次） */
  function groupCum(cls, gno) {
    return lessonsOf(cls.id).reduce(function (a, l) { return a + groupTotal(l, gno); }, 0);
  }

  /** 某节课是否给该组记过任何东西 */
  function touched(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return false;
    if (s.first || s.group || s.phone || s.duty) return true;
    return Object.keys(s.personal || {}).some(function (k) { return s.personal[k]; });
  }

  function personalSum(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s || !s.personal) return 0;
    return Object.keys(s.personal).reduce(function (a, k) { return a + (+s.personal[k] || 0); }, 0);
  }

  /** 个人总分 = 所在小组累计本节合计 − 本人累计个人扣分 */
  function memberTotals(cls) {
    var ls = lessonsOf(cls.id);
    var out = [];
    cls.groups.forEach(function (g) {
      var gs = ls.reduce(function (a, l) { return a + groupTotal(l, g.no); }, 0);
      g.members.forEach(function (m, idx) {
        if (!m.name) return;
        var p = ls.reduce(function (a, l) {
          var s = l.scores[String(g.no)];
          return a + (s && s.personal ? (+s.personal[String(idx)] || 0) : 0);
        }, 0);
        out.push({
          name: m.name, sid: m.sid, no: m.no, gno: g.no,
          groupScore: gs, personal: p, total: gs - p
        });
      });
    });
    out.sort(function (a, b) { return b.total - a.total || a.gno - b.gno; });
    return out;
  }

  /* ================= 撤销 ================= */

  var UNDO_MAX = 60;
  var FIELD_NAME = { first: '首个正确', group: '小组分', phone: '手机未入袋', duty: '值日分' };

  /** 记一笔可撤销的改动。只存"反做"需要的信息，很轻。
      op 三种形态：
        {lessonId, gno, f, old, neu}          标量（first / group / phone / duty）
        {lessonId, gno, i, old, neu, name}    个人扣分（第 i 个成员）
        {lessonId, gno, reset:true, old}      整组清零（old 是该组原 scores 的副本） */
  function pushUndo(op) {
    if (!S.undo) S.undo = [];
    S.undo.push(op);
    if (S.undo.length > UNDO_MAX) S.undo.shift();
    renderUndoBtn();
  }

  function dropUndo() { S.undo = []; renderUndoBtn(); }

  /** 某节课被清零 / 删除后，指向它的撤销记录就没意义了 */
  function dropUndoForLesson(lessonId) {
    S.undo = (S.undo || []).filter(function (op) { return op.lessonId !== lessonId; });
    renderUndoBtn();
  }

  function undoLabel(op) {
    var g = '第 ' + op.gno + ' 组';
    if (op.reset) return g + ' 本节清零';
    if (op.i != null) {
      return g + ' ' + (op.name || '成员') + ' 个人扣分 ' + op.neu + ' → ' + op.old;
    }
    return g + ' ' + (FIELD_NAME[op.f] || op.f) + ' ' + showVal(op.f, op.neu) +
      ' → ' + showVal(op.f, op.old);
  }

  function showVal(f, v) {
    if (f === 'first') return v ? '已加' : '未加';
    return String(v);
  }

  function renderUndoBtn() {
    var b = $('#btnUndo');
    if (!b) return;
    var n = (S.undo || []).length;
    b.disabled = !n;
    b.textContent = n ? '↶ 撤销' + (n > 1 ? '（' + n + '）' : '') : '↶ 撤销';
    b.title = n
      ? '撤销：' + undoLabel(S.undo[n - 1]) + '　（快捷键 Ctrl+Z）'
      : '还没有可撤销的改动';
  }

  /** 撤销一步。返回是否真的撤了 */
  function undo() {
    if (!(S.undo || []).length) return false;
    var op = null, l = null;
    while (S.undo.length) {
      op = S.undo.pop();
      l = getLesson(op.lessonId);
      if (l) break;
      op = null;                        // 课次已被删掉，跳过这条继续往前撤
    }
    renderUndoBtn();
    if (!op) return false;

    var key = String(op.gno);
    if (op.reset) {
      l.scores[key] = op.old;
    } else {
      var s = sc(l, op.gno);
      if (op.i != null) s.personal[op.i] = op.old;
      else s[op.f] = op.old;
    }

    var cls = getClass(l.classId);
    var sameView = cls && S.ui.classId === l.classId && S.ui.lessonId === l.id;
    if (cls) { S.ui.classId = l.classId; S.ui.lessonId = l.id; }
    save(false);
    renderUndoBtn();

    if (sameView) { refreshCard(cls, l, op.gno); renderMetrics(cls, l); }
    else { renderScore(); }

    flash('已撤销：' + undoLabel(op));
    return true;
  }

  /** 顶栏那句小字兼做提示条 */
  function flash(msg) {
    var el = $('#saveState');
    el.textContent = msg;
    el.classList.add('flash');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      el.classList.remove('flash');
      var d = new Date();
      el.textContent = '已自动保存到本机 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    }, 2600);

    toast(msg);
  }

  /* ---------------- 保存成功的动效 ---------------- */
  /* 每次动作有结果都蹦一条：勾自己"画"出来 + 一圈光环扩散 + 整条弹上来再飘走。
     全部用 CSS 动画，不碰 JS 动画 API（无头测试里也不会报错）。 */
  var toastTimer = null, toastEl = null;

  function toast(msg) {
    if (!document.body) return;
    if (toastEl) { toastEl.remove(); toastEl = null; }
    clearTimeout(toastTimer);

    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ic">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l4.7 4.7L19.5 7"/></svg>' +
      '</span><span class="tx"></span>';
    el.querySelector('.tx').textContent = msg;
    document.body.appendChild(el);
    toastEl = el;

    toastTimer = setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () {
        if (el.parentNode) el.remove();
        if (toastEl === el) toastEl = null;
      }, 280);
    }, 2200);
  }

  /* 记分页布局：表格式（默认，跟纸质表一致）/ 卡片式（手机上更好点） */

  var scoreLayout = 'table';

  function initLayout() {
    var saved = S.ui && S.ui.scoreLayout;
    scoreLayout = (saved === 'table' || saved === 'card')
      ? saved
      : (window.innerWidth && window.innerWidth < 760 ? 'card' : 'table');
    $$('#layoutSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.l === scoreLayout);
    });
  }

  /* ================= 视图切换 ================= */

  var view = 'score';

  function switchView(v) {
    if (v === 'admin' && !(CLOUD && CLOUD.profile() && CLOUD.profile().isAdmin)) v = 'score';
    view = v;
    ['score', 'rank', 'pool', 'data', 'admin'].forEach(function (k) {
      var el = $('#view-' + k);
      if (el) el.hidden = (k !== v);
    });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (v === 'rank') renderRank();
    if (v === 'pool') renderPool();
    if (v === 'data') renderData();
    if (v === 'admin') renderAdmin();
    if (v === 'score') renderScore();
  }

  /* ================= 上课记分视图 ================= */

  function curClass() {
    var c = getClass(S.ui.classId);
    if (!c) { c = S.classes[0]; if (c) S.ui.classId = c.id; }
    return c;
  }

  function curLesson(cls) {
    var ls = lessonsOf(cls.id);
    var l = getLesson(S.ui.lessonId);
    if (!l || l.classId !== cls.id) {
      l = ls.length ? ls[ls.length - 1] : null;
      S.ui.lessonId = l ? l.id : null;
    }
    return l;
  }

  function fillClassSelects() {
    ['#classSel', '#rankClassSel', '#poolClassSel'].forEach(function (sel) {
      var e = $(sel);
      e.innerHTML = S.classes.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
    });
  }

  function renderScore() {
    var cls = curClass();
    if (!cls) return;
    $('#classSel').value = cls.id;
    $('#rankClassSel').value = cls.id;
    $('#poolClassSel').value = cls.id;
    renderPoolBanner(cls);
    updatePoolBadge();

    var ls = lessonsOf(cls.id);
    var sel = $('#lessonSel');
    sel.innerHTML = ls.map(function (l) {
      return '<option value="' + l.id + '">第 ' + l.seq + ' 次课 · ' + esc(l.date || '') + '</option>';
    }).join('');
    var lesson = curLesson(cls);
    if (lesson) sel.value = lesson.id;
    sel.disabled = !ls.length;

    $('#noLessonHint').hidden = !!lesson;
    $('#lessonMeta').hidden = !lesson;
    $('#scoreMetrics').hidden = !lesson;
    $('#scoreHint').hidden = !lesson;
    $('#groupList').hidden = !lesson;

    if (!lesson) { $('#lessonMeta').innerHTML = ''; $('#groupList').innerHTML = ''; return; }

    renderLessonMeta(cls, lesson);
    renderGroups(cls, lesson);
    renderMetrics(cls, lesson);
  }

  function renderLessonMeta(cls, lesson) {
    var dutyOpts = '<option value="">无</option>' + cls.groups.map(function (g) {
      return '<option value="' + g.no + '"' + (+lesson.dutyGroup === g.no ? ' selected' : '') +
        '>第 ' + g.no + ' 组</option>';
    }).join('');
    $('#lessonMeta').innerHTML =
      '<span class="tag">' + esc(cls.name) + ' · 第 ' + lesson.seq + ' 次课</span>' +
      '<label class="field"><span>日期</span><input type="date" id="metaDate" value="' + esc(lesson.date || '') + '"></label>' +
      '<label class="field"><span>值日组</span><select id="metaDuty">' + dutyOpts + '</select></label>' +
      '<label class="field" style="flex:1;min-width:200px"><span>本节任务</span>' +
      '<input type="text" class="topic" id="metaTopic" value="' + esc(lesson.topic || '') + '" placeholder="例如：三相异步电动机正反转接线"></label>' +
      '<button class="btn" id="btnPrintLesson">打印本课</button>';

    $('#metaDate').addEventListener('change', function () { lesson.date = this.value; save(); renderScore(); });
    $('#metaTopic').addEventListener('change', function () { lesson.topic = this.value; save(); });
    $('#metaDuty').addEventListener('change', function () {
      lesson.dutyGroup = this.value ? +this.value : null; save(); renderGroups(cls, lesson);
    });
    $('#btnPrintLesson').addEventListener('click', function () { printLesson(cls, lesson); });
  }

  /* ---- 记分控件（卡片视图与表格视图共用，保证两边的操作完全一致） ---- */

  /** 某个计分项在本组的上限 */
  function maxOf(f, maxPhone) {
    return f === 'group' ? 10 : f === 'duty' ? 5 : f === 'phone' ? maxPhone : 99;
  }

  function ctlFirst(gno, s) {
    return '<button class="toggle' + (s.first ? ' on' : '') + '" data-g="' + gno + '" data-act="first">' +
      (s.first ? '已加分 +1' : '未加分') + '</button>';
  }

  /** ± 步进 + 可直接输入的数字框 */
  function ctlStep(gno, f, s, max, hint) {
    var v = +s[f] || 0;
    var neg = (f === 'phone' || f === 'personal') && v > 0;
    return '<div class="step">' +
      '<button data-g="' + gno + '" data-act="d" data-f="' + f + '" data-max="' + max + '" title="减 1">−</button>' +
      '<input class="num' + (neg ? ' neg' : '') + '" data-g="' + gno + '" data-f="' + f + '" data-max="' + max +
        '" size="1" inputmode="numeric" value="' + v + '" title="' + hint + '：可以直接点进来输数字（0-' + max + '）">' +
      '<button data-g="' + gno + '" data-act="i" data-f="' + f + '" data-max="' + max + '" title="加 1">+</button>' +
    '</div>';
  }

  function ctlSum(gno, total, cumVal) {
    return '<div class="v ' + signClass(total) + '" data-total="' + gno + '">' + fmt(total) + '</div>' +
      '<div class="c" data-cum="' + gno + '">累计 ' + fmt(cumVal) + '</div>';
  }

  /** 个人扣分格：点一次 +1；右键 / 长按 −1 */
  function ctlPersonal(gno, m, i, n) {
    return '<button class="pchip' + (n ? ' hit' : '') + '" data-g="' + gno + '" data-act="p" data-i="' + i +
      '" title="' + esc(m.name) + ' 个人扣分（点=+1，右键/长按=−1）">' +
      esc(m.name.slice(0, 1)) + '<span class="n">' + n + '</span></button>';
  }

  function ctlClear(gno, compact) {
    return '<button class="mini" data-cleargroup="' + gno + '" type="button" title="把本组这节课的分数全部归零">' +
      (compact ? '↺' : '↺ 清零') + '</button>';
  }

  function renderGroups(cls, lesson) {
    var host = $('#groupList');
    host.innerHTML = scoreLayout === 'table'
      ? groupsTable(cls, lesson)
      : groupsCards(cls, lesson);
  }

  function groupsCards(cls, lesson) {
    return '<div class="groups">' + cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var total = groupTotal(lesson, g.no);
      var duty = (+lesson.dutyGroup === g.no);
      var cnt = memberCount(g);
      var maxPhone = cnt || 10;
      var names = cnt
        ? g.members.slice(0, cnt).map(function (m) { return esc(m.name); }).join(' · ')
        : '<span style="color:var(--muted);font-weight:400">（未录入名单）</span>';

      var personal = cnt
        ? '<div class="personals"><span class="plabel">个人扣分</span>' +
          g.members.slice(0, cnt).map(function (m, i) {
            return ctlPersonal(g.no, m, i, +s.personal[String(i)] || 0);
          }).join('') + '</div>'
        : '';

      return '' +
      '<div class="gcard' + (duty ? ' is-duty' : '') + (touched(lesson, g.no) ? ' touched' : '') + '" data-card="' + g.no + '">' +
        '<div class="gcard-head">' +
          '<div style="min-width:0">' +
            '<div class="gnames"><span class="gnum">' + g.no + '</span>' + names +
              (duty ? '<span class="dutytag">值日</span>' : '') + '</div>' +
          '</div>' +
          '<div class="gsum">' +
            '<div class="k">本节合计</div>' +
            ctlSum(g.no, total, groupCum(cls, g.no)) +
            ctlClear(g.no, false) +
          '</div>' +
        '</div>' +
        '<div class="gctl">' +
          '<div>' +
            '<div class="lbl">首个正确 +1</div>' +
            ctlFirst(g.no, s) +
          '</div>' +
          '<div>' +
            '<div class="lbl">小组分 0-10</div>' +
            ctlStep(g.no, 'group', s, maxOf('group', maxPhone), '小组分') +
          '</div>' +
          '<div>' +
            '<div class="lbl">手机未入袋 −1/人</div>' +
            ctlStep(g.no, 'phone', s, maxPhone, '手机未入袋') +
          '</div>' +
          '<div>' +
            '<div class="lbl">值日分 0-5' + (duty ? '（本组值日）' : '') + '</div>' +
            ctlStep(g.no, 'duty', s, maxOf('duty', maxPhone), '值日分') +
          '</div>' +
        '</div>' +
        personal +
      '</div>';
    }).join('') + '</div>';
  }

  /** 表格式：照着纸质记录表的 12 列版式（组号 + 成员1-6 + 全组四列 + 本节合计） */
  function groupsTable(cls, lesson) {
    var cols = '<col class="w-no">';
    for (var c = 0; c < GROUP_CAP; c++) cols += '<col class="w-mem">';
    cols += '<col class="w-first"><col class="w-grp"><col class="w-phone">' +
      '<col class="w-duty"><col class="w-sum">';

    var sub = '';
    for (var k = 0; k < GROUP_CAP; k++) sub += '<th class="c-mem">成员' + (k + 1) + '</th>';

    var head = '<thead>' +
      '<tr>' +
        '<th class="c-no" rowspan="2">组<br>号</th>' +
        '<th class="c-mem" colspan="' + GROUP_CAP + '">小组成员姓名 / 个人扣分（-1/次）</th>' +
        '<th class="c-first" rowspan="2">全组·首个正确<br>(+1)</th>' +
        '<th class="c-grp" rowspan="2">全组·小组分<br>(0-10)</th>' +
        '<th class="c-phone" rowspan="2">全组·手机未入袋<br>（-1/人）</th>' +
        '<th class="c-duty" rowspan="2">全组·值日分<br>(0-5)</th>' +
        '<th class="c-sum" rowspan="2">本节<br>合计</th>' +
      '</tr><tr>' + sub + '</tr>' +
    '</thead>';

    var body = cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var duty = (+lesson.dutyGroup === g.no);
      var cnt = memberCount(g);
      var maxPhone = cnt || 10;
      var names = '', deds = '';

      for (var i = 0; i < GROUP_CAP; i++) {
        var m = g.members[i];
        names += '<td class="c-mem">' + ((m && m.name)
          ? esc(m.name) + (m.no == null ? '' : ' ' + two(m.no)) : '') + '</td>';
        deds += '<td class="c-ded">' + (i < cnt ? ctlPersonal(g.no, m, i, +s.personal[String(i)] || 0) : '') + '</td>';
      }

      return '<tbody class="' + (duty ? 'is-duty ' : '') + (touched(lesson, g.no) ? 'touched' : '') +
          '" data-card="' + g.no + '">' +
        '<tr class="gname">' +
          '<td class="c-no" rowspan="2">' + g.no + '</td>' +
          names +
          '<td class="c-first" rowspan="2">' + ctlFirst(g.no, s) + '</td>' +
          '<td class="c-grp" rowspan="2">' + ctlStep(g.no, 'group', s, maxOf('group', maxPhone), '小组分') + '</td>' +
          '<td class="c-phone" rowspan="2">' + ctlStep(g.no, 'phone', s, maxPhone, '手机未入袋') + '</td>' +
          '<td class="c-duty" rowspan="2">' + ctlStep(g.no, 'duty', s, maxOf('duty', maxPhone), '值日分') + '</td>' +
          '<td class="c-sum" rowspan="2">' + ctlSum(g.no, groupTotal(lesson, g.no), groupCum(cls, g.no)) +
            ctlClear(g.no, true) + '</td>' +
        '</tr>' +
        '<tr class="gded">' + deds + '</tr>' +
      '</tbody>';
    }).join('');

    return '<div class="sheetwrap"><table class="sheet">' +
      '<colgroup>' + cols + '</colgroup>' + head + body + '</table></div>';
  }

  function renderMetrics(cls, lesson) {
    var ls = lessonsOf(cls.id);
    var done = 0, best = null;
    cls.groups.forEach(function (g) {
      var t = groupTotal(lesson, g.no);
      if (touched(lesson, g.no)) done++;
      if (best === null || t > best.t) best = { no: g.no, t: t };
    });
    var ranked = cls.groups.map(function (g) { return { no: g.no, t: groupCum(cls, g.no) }; })
      .sort(function (a, b) { return b.t - a.t; });
    var lead = ranked[0] || { no: '-', t: 0 };

    $('#scoreMetrics').innerHTML =
      '<div class="metric"><div class="k">已记分小组</div><div class="v">' + done +
        ' <small>/ ' + cls.groups.length + ' 组</small></div></div>' +
      '<div class="metric"><div class="k">本节最高</div><div class="v ' + signClass(best ? best.t : 0) + '">' +
        (best && done ? fmt(best.t) + ' <small>第 ' + best.no + ' 组</small>' : '—') + '</div></div>' +
      '<div class="metric"><div class="k">累计领先</div><div class="v good">第 ' + lead.no +
        ' 组 <small>' + fmt(lead.t) + '</small></div></div>' +
      '<div class="metric"><div class="k">已记录课次</div><div class="v">' + ls.length + ' <small>次</small></div></div>';
  }

  function refreshCard(cls, lesson, gno) {
    var card = $('[data-card="' + gno + '"]');
    if (!card) return;
    var s = sc(lesson, gno);
    var t = groupTotal(lesson, gno);
    var v = $('[data-total="' + gno + '"]', card);
    v.textContent = fmt(t);
    v.className = 'v ' + signClass(t);
    $('[data-cum="' + gno + '"]', card).textContent = '累计 ' + fmt(groupCum(cls, gno));
    card.classList.toggle('touched', touched(lesson, gno));
    $$('.num', card).forEach(function (inp) {
      var f = inp.dataset.f;
      inp.value = (+s[f] || 0);
      if (f === 'phone') inp.classList.toggle('neg', (+s.phone || 0) > 0);
    });
    var tg = $('[data-act="first"]', card);
    tg.classList.toggle('on', !!s.first);
    tg.textContent = s.first ? '已加分 +1' : '未加分';
    $$('.pchip', card).forEach(function (c) {
      var n = (+s.personal[c.dataset.i] || 0);
      c.classList.toggle('hit', !!n);
      $('.n', c).textContent = n;
    });
  }

  /* ================= 记分交互（事件委托） ================= */

  $('#groupList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +btn.dataset.g;
    var s = sc(lesson, gno);
    var act = btn.dataset.act;

    if (act === 'first') {
      var oldF = s.first ? 1 : 0, newF = oldF ? 0 : 1;
      s.first = newF;
      pushUndo({ lessonId: lesson.id, gno: gno, f: 'first', old: oldF, neu: newF });
    } else if (act === 'i' || act === 'd') {
      var f = btn.dataset.f;
      var max = btn.dataset.max ? +btn.dataset.max : maxOf(f, 99);
      var oldV = +s[f] || 0, newV = clamp(oldV + (act === 'i' ? 1 : -1), 0, max);
      if (newV === oldV) { refreshCard(cls, lesson, gno); return; }   // 已经到顶/到底，不必记一笔
      s[f] = newV;
      pushUndo({ lessonId: lesson.id, gno: gno, f: f, old: oldV, neu: newV });
    } else if (act === 'p') {
      if (longPressFired) { longPressFired = false; return; }   // 刚长按减过，别再 +1
      bumpPersonal(cls, lesson, btn, +1);
      return;
    }
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
  });

  /** 个人扣分走这里，±1 和归零都记录、都可撤销。
      纸质表上「犯几次写几次」，所以不封 5，只封 99 防手滑。 */
  function bumpPersonal(cls, lesson, chip, delta) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    var old = +s.personal[i] || 0;
    var neu = clamp(old + delta, 0, 99);
    if (neu === old) return;
    s.personal[i] = neu;
    pushUndo({
      lessonId: lesson.id, gno: gno, i: i, old: old, neu: neu,
      name: memberName(cls, gno, +i)
    });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
  }

  /** 直接把某个成员的个人扣分设成指定值（双击归零用） */
  function setPersonal(cls, lesson, chip, val) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    var old = +s.personal[i] || 0;
    if (old === val) return;
    s.personal[i] = val;
    pushUndo({
      lessonId: lesson.id, gno: gno, i: i, old: old, neu: val,
      name: memberName(cls, gno, +i)
    });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
  }

  function memberName(cls, gno, i) {
    var g = groupOf(cls, gno);
    var m = g && g.members[i];
    return m ? m.name : '';
  }

  /** 整组清零（含个人扣分），可撤销 */
  function clearGroup(cls, lesson, gno) {
    var key = String(gno);
    if (!touched(lesson, gno)) { flash('第 ' + gno + ' 组这节课还没记过分'); return; }
    if (!confirm('把第 ' + gno + ' 组这节课的分数全部归零？（其它组不受影响，清错了可以撤销）')) return;
    var old = JSON.parse(JSON.stringify(lesson.scores[key] ||
      { first: 0, group: 0, phone: 0, duty: 0, personal: {} }));
    lesson.scores[key] = { first: 0, group: 0, phone: 0, duty: 0, personal: {} };
    pushUndo({ lessonId: lesson.id, gno: gno, reset: true, old: old });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    flash('已把第 ' + gno + ' 组本节清零（可撤销）');
  }

  $('#groupList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cleargroup]');
    if (!b) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    clearGroup(cls, lesson, +b.dataset.cleargroup);
  });

  /* 个人扣分：右键 / 长按 = 往回减 1 */
  var longPressFired = false, longPressTimer = null;

  function lpStop() { clearTimeout(longPressTimer); longPressTimer = null; }

  $('#groupList').addEventListener('contextmenu', function (e) {
    var chip = e.target.closest('.pchip');
    if (!chip) return;
    e.preventDefault();
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    bumpPersonal(cls, lesson, chip, -1);
  });

  $('#groupList').addEventListener('touchstart', function (e) {
    var chip = e.target.closest('.pchip');
    if (!chip) return;
    lpStop();
    longPressFired = false;
    longPressTimer = setTimeout(function () {
      longPressFired = true;
      var cls = curClass(), lesson = curLesson(cls);
      if (cls && lesson) bumpPersonal(cls, lesson, chip, -1);
      /* 长按松手后浏览器还会补一个 click，得吃掉它 */
      setTimeout(function () { longPressFired = false; }, 900);
    }, 550);
  }, { passive: true });

  ['touchend', 'touchmove', 'touchcancel'].forEach(function (t) {
    $('#groupList').addEventListener(t, lpStop, { passive: true });
  });

  /* 个人扣分：双击归零 */
  $('#groupList').addEventListener('dblclick', function (e) {
    var chip = e.target.closest('.pchip');
    if (!chip) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    setPersonal(cls, lesson, chip, 0);
    flash('已把 ' + memberName(cls, +chip.dataset.g, +chip.dataset.i) + ' 的个人扣分归零');
  });

  $('#groupList').addEventListener('change', function (e) {
    var inp = e.target.closest('input.num');
    if (!inp) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +inp.dataset.g, f = inp.dataset.f;
    var max = inp.dataset.max ? +inp.dataset.max : maxOf(f, 99);
    var s = sc(lesson, gno);
    var old = +s[f] || 0;
    var neu = clamp(inp.value, 0, max);
    inp.value = neu;                       // 立刻回显夹取后的值，别让输入框留着非法数字
    if (neu === old) return;
    s[f] = neu;
    pushUndo({ lessonId: lesson.id, gno: gno, f: f, old: old, neu: neu });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
  });

  /* ================= 排行视图 ================= */

  function renderRank() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    S.ui.classId = cls.id;
    $('#rankClassSel').value = cls.id;

    var ls = lessonsOf(cls.id);

    /* 小组排行 */
    var rows = cls.groups.map(function (g) {
      return { no: g.no, t: groupCum(cls, g.no), n: memberCount(g) };
    }).sort(function (a, b) { return b.t - a.t; });
    var maxAbs = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.t); })));
    $('#groupRank').innerHTML = rows.length
      ? '<div class="bars">' + rows.map(function (r, i) {
          var w = Math.max(2, Math.round(Math.abs(r.t) / maxAbs * 100));
          return '<div class="bar-row">' +
            '<div class="who">' + (i + 1) + '. 第 ' + r.no + ' 组</div>' +
            '<div class="bar-track"><div class="bar-fill' + (r.t < 0 ? ' neg' : (i === 0 && r.t > 0 ? ' gold' : '')) + '" style="width:' + w + '%"></div></div>' +
            '<div class="val ' + signClass(r.t) + '">' + fmt(r.t) + '</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<p class="rank-note">共 ' + ls.length + ' 次课记录。柱长为组间相对值。</p>'
      : '<p class="rank-note">还没有课次记录。</p>';

    /* 个人排行 */
    var ms = memberTotals(cls);
    $('#memberRank').innerHTML = ms.length
      ? '<table class="data fit"><thead><tr>' +
          '<th>排名</th><th>姓名</th><th>学号</th><th>小组</th>' +
          '<th class="n">组得分</th><th class="n">个人扣分</th><th class="n">总分</th>' +
        '</tr></thead><tbody>' + ms.map(function (m, i) {
          return '<tr' + (i === 0 && m.total > 0 ? ' class="top1"' : '') + '>' +
            '<td>' + (i + 1) + '</td><td>' + esc(m.name || '（未命名）') + '</td>' +
            '<td>' + esc(m.sid || (m.no == null ? '' : m.no)) + '</td><td>第 ' + m.gno + ' 组</td>' +
            '<td class="n">' + fmt(m.groupScore) + '</td>' +
            '<td class="n' + (m.personal ? ' neg' : '') + '">' + (m.personal ? '−' + m.personal : '0') + '</td>' +
            '<td class="n ' + signClass(m.total) + '">' + fmt(m.total) + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>' +
        '<p class="rank-note">总分 = 所在小组累计本节合计 − 本人累计个人扣分，按分数从高到低动态排序。</p>'
      : '<p class="rank-note">这个班还没录入成员名单。到「数据与备份」页补充后再看。</p>';

    /* 逐节明细 */
    $('#lessonMatrix').innerHTML = ls.length
      ? '<table class="data fit"><thead><tr><th>组号</th>' +
          ls.map(function (l) { return '<th class="n">第' + l.seq + '课</th>'; }).join('') +
          '<th class="n">累计</th></tr></thead><tbody>' +
          cls.groups.map(function (g) {
            return '<tr><td>第 ' + g.no + ' 组</td>' +
              ls.map(function (l) {
                var t = groupTotal(l, g.no);
                return '<td class="n">' + (touched(l, g.no) ? fmt(t) : '') + '</td>';
              }).join('') +
              '<td class="n ' + signClass(groupCum(cls, g.no)) + '"><b>' + fmt(groupCum(cls, g.no)) + '</b></td></tr>';
          }).join('') +
          '</tbody></table>'
      : '<p class="rank-note">暂无记录。</p>';
  }

  /* ================= 待分配名单 ================= */

  var poolFilter = 'pending';
  var poolSearch = '';

  /** 上课记分页顶部的跳转提示条 */
  function renderPoolBanner(cls) {
    var el = $('#poolBanner');
    var p = pendingList(cls);
    if (!p.length) { el.hidden = true; el.innerHTML = ''; return; }
    var names = p.slice(0, 6).map(function (r) { return r.name; }).join('、');
    if (p.length > 6) names += ' 等';
    el.hidden = false;
    el.innerHTML =
      '<span class="dot"></span>' +
      '<span>本班还有 <b>' + p.length + '</b> 人没分配小组：' + esc(names) + '</span>' +
      '<button class="btn tiny" id="btnGoPool">查看待分配名单 →</button>';
    $('#btnGoPool').addEventListener('click', function () {
      $('#poolClassSel').value = cls.id;
      switchView('pool');
    });
  }

  /** 页签上的待分配总数角标 */
  function updatePoolBadge() {
    var b = $('#tabPoolBadge');
    var n = pendingTotal();
    if (n > 0) { b.hidden = false; b.textContent = n; }
    else { b.hidden = true; b.textContent = ''; }
  }

  function renderPool() {
    var cls = getClass($('#poolClassSel').value) || curClass();
    if (!cls) return;
    S.ui.classId = cls.id;
    $('#poolClassSel').value = cls.id;
    $('#classSel').value = cls.id;

    var map = placedMap(cls);
    var rows = rosterOf(cls).map(function (r) {
      return { r: r, g: groupOfStudent(cls, r, map) };
    });
    var nAssigned = rows.filter(function (x) { return x.g !== null; }).length;
    var nPending = rows.length - nAssigned;

    $('#poolMetrics').innerHTML =
      '<div class="metric"><div class="k">全班人数</div><div class="v">' + rows.length +
        ' <small>人</small></div></div>' +
      '<div class="metric"><div class="k">已分配小组</div><div class="v good">' + nAssigned +
        ' <small>人</small></div></div>' +
      '<div class="metric"><div class="k">待分配</div><div class="v ' + (nPending ? 'neg' : '') + '">' +
        nPending + ' <small>人</small></div></div>' +
      '<div class="metric"><div class="k">分配率</div><div class="v">' +
        (rows.length ? Math.round(nAssigned / rows.length * 100) : 0) + ' <small>%</small></div></div>';

    /* 筛选 */
    var list = rows;
    if (poolFilter === 'pending') list = rows.filter(function (x) { return x.g === null; });
    else if (poolFilter === 'assigned') list = rows.filter(function (x) { return x.g !== null; });
    var q = poolSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(function (x) {
        return String(x.r.name).toLowerCase().indexOf(q) >= 0 ||
          String(x.r.sid || '').indexOf(q) >= 0 ||
          String(x.r.no == null ? '' : x.r.no) === q;
      });
    }
    list = list.slice().sort(function (a, b) {
      return (a.r.no == null ? 9999 : a.r.no) - (b.r.no == null ? 9999 : b.r.no);
    });

    /* 可分配的目标组 */
    var groupOpts = cls.groups.map(function (g) {
      var left = GROUP_CAP - memberCount(g);
      return '<option value="' + g.no + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        '第 ' + g.no + ' 组（' + memberCount(g) + '/' + GROUP_CAP + '）</option>';
    }).join('');

    $('#poolList').innerHTML = list.length
      ? '<table class="data fit"><thead><tr>' +
        '<th>序号</th><th>姓名</th><th>学号</th><th>状态</th><th>操作</th>' +
        '</tr></thead><tbody>' +
        list.map(function (x) {
          var r = x.r;
          return '<tr' + (x.g === null ? ' class="row-pending"' : '') + '>' +
            '<td>' + (r.no == null ? '' : r.no) + '</td>' +
            '<td>' + esc(r.name || '（未命名）') + '</td>' +
            '<td>' + esc(r.sid || '') + '</td>' +
            '<td>' + (x.g === null
              ? '<span class="pill pending">待分配</span>'
              : '<span class="pill done">第 ' + x.g + ' 组</span>') + '</td>' +
            '<td>' + (x.g === null
              ? '<select class="assign" data-name="' + esc(r.name) + '" data-sid="' + esc(r.sid || '') + '">' +
                  '<option value="">分配到…</option>' + groupOpts + '</select>'
              : '<button class="btn tiny" data-unassign="' + x.g + '" data-name="' + esc(r.name) +
                '" data-sid="' + esc(r.sid || '') + '">移出小组</button>') +
              ' <button class="btn tiny danger" data-delstudent="' + esc(r.name) + '" data-sid="' + esc(r.sid || '') + '">删除</button>' +
            '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="rank-note">当前显示 ' + list.length + ' 条' +
          (poolFilter === 'pending' ? '（仅待分配）' : poolFilter === 'assigned' ? '（仅已分配）' : '（全部）') +
          (q ? '，搜索「' + esc(poolSearch) + '」' : '') + '。</p>'
      : '<p class="rank-note">' + (poolFilter === 'pending' ? '没有待分配的学生，全班都分好组了。' : '没有记录。') + '</p>';

    updatePoolBadge();
  }

  /* ---- 待分配页的交互 ---- */

  $('#poolClassSel').addEventListener('change', function () {
    S.ui.classId = this.value; S.ui.lessonId = null; save(); renderPool();
  });
  $('#poolFilter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (!b) return;
    poolFilter = b.dataset.f;
    $$('#poolFilter button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderPool();
  });
  $('#poolSearch').addEventListener('input', function () {
    poolSearch = this.value; renderPool();
  });

  $('#poolList').addEventListener('change', function (e) {
    var sel = e.target.closest('select.assign');
    if (!sel || !sel.value) return;
    var cls = curClass();
    var g = groupOf(cls, +sel.value);
    if (!g) return;
    if (memberCount(g) >= GROUP_CAP) {
      alert('第 ' + g.no + ' 组已满 ' + GROUP_CAP + ' 人。请先移出或选别的组。');
      renderPool();
      return;
    }
    pushMember(g, {
      id: uid('m'), name: sel.dataset.name,
      sid: sel.dataset.sid || '', no: studentNo(cls, sel.dataset.name, sel.dataset.sid)
    });
    save(); renderPool(); renderScore();
    flash('已把「' + sel.dataset.name + '」分到第 ' + g.no + ' 组');
  });

  $('#poolList').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var cls = curClass();

    if (b.dataset.unassign) {
      var g = groupOf(cls, +b.dataset.unassign);
      if (!g) return;
      var nm = b.dataset.name, sd = b.dataset.sid || '';
      var j = -1;
      for (var i = 0; i < g.members.length; i++) {
        var m = g.members[i];
        if (m.name === nm && (!sd || !m.sid || String(m.sid) === sd)) { j = i; break; }
      }
      if (j < 0) return;
      if (!confirm('把「' + nm + '」移出第 ' + g.no + ' 组？他/她会回到待分配名单。\n' +
                   '（该组已记录的个人扣分会自动对齐，不会算到别人头上）')) return;
      removeMemberAt(cls, g, j);
      save(); renderPool(); renderScore();
      flash('已把「' + nm + '」移出第 ' + g.no + ' 组，回到待分配');
      return;
    }
    if (b.dataset.delstudent) {
      if (!confirm('把「' + b.dataset.name + '」从全班名单里删除？（已记的分不受影响）')) return;
      cls.roster = rosterOf(cls).filter(function (r) {
        return !(r.name === b.dataset.name && String(r.sid || '') === String(b.dataset.sid || ''));
      });
      save(); renderPool();
      flash('已从全班名单删除「' + b.dataset.name + '」');
    }
  });

  /** 从全班名单取某人的班内序号 */
  function studentNo(cls, name, sid) {
    var hit = rosterOf(cls).filter(function (r) {
      return r.name === name && (!sid || !r.sid || String(r.sid) === String(sid));
    })[0] || rosterOf(cls).filter(function (r) { return r.name === name; })[0];
    return hit ? hit.no : null;
  }

  /* 添加学生 */
  var dlgStu = $('#dlgStudent');
  $('#btnPoolAdd').addEventListener('click', function () {
    $('#stName').value = ''; $('#stNo').value = ''; $('#stSid').value = '';
    openDlg(dlgStu);
  });
  dlgStu.addEventListener('close', function () {
    if (dlgStu.returnValue !== 'ok') return;
    var name = $('#stName').value.trim();
    if (!name) { alert('请填写姓名。'); return; }
    var cls = curClass();
    var r = rosterOf(cls);
    if (r.some(function (x) { return x.name === name; })) {
      if (!confirm('全班名单里已经有「' + name + '」了，仍要再加一条吗？')) return;
    }
    r.push({
      name: name,
      no: $('#stNo').value.trim() === '' ? null : parseInt($('#stNo').value, 10),
      sid: $('#stSid').value.trim()
    });
    save(); renderPool(); renderScore();
    flash('已把「' + name + '」加入全班名单，排在待分配里');
  });

  /* 均匀分配 */
  $('#btnPoolAuto').addEventListener('click', function () {
    var cls = curClass();
    var pending = pendingList(cls);
    if (!pending.length) { alert('这个班没有待分配的学生。'); return; }
    var room = cls.groups.map(function (g) {
      return { g: g, left: GROUP_CAP - memberCount(g) };
    });
    var totalRoom = room.reduce(function (a, x) { return a + Math.max(0, x.left); }, 0);
    if (totalRoom < pending.length) {
      alert('现有小组空位不够：空位 ' + totalRoom + ' 个，待分配 ' + pending.length + ' 人。\n' +
            '请先到「数据与备份」页添加小组，或分批分配。');
      return;
    }
    if (!confirm('将把 ' + pending.length + ' 名待分配学生，按班内序号顺序轮流填入现有各组（每组不超过 ' +
                 GROUP_CAP + ' 人）。\n\n这会直接改动分组，建议先到「数据与备份」下载备份后再操作。继续吗？')) return;
    var i = 0, done = 0;
    pending.forEach(function (r) {
      for (var k = 0; k < room.length; k++) {
        var idx = (i + k) % room.length;
        if (room[idx].left > 0) {
          pushMember(room[idx].g, {
            id: uid('m'), name: r.name, sid: r.sid || '', no: r.no
          });
          room[idx].left--;
          i = idx + 1;
          done++;
          return;
        }
      }
    });
    save(); renderPool(); renderScore();
    flash('已均匀分配 ' + done + ' 人，可到「上课记分」页核对');
  });

  /* ================= 数据与备份视图 ================= */

  var rosterClassId = null;

  function renderData() {
    renderLessonList();
    if (!rosterClassId) rosterClassId = (curClass() || {}).id || null;
    renderRoster();
  }

  function renderLessonList() {
    var rows = S.lessons.slice().sort(function (a, b) {
      var ca = getClass(a.classId), cb = getClass(b.classId);
      var na = ca ? ca.name : '', nb = cb ? cb.name : '';
      return na.localeCompare(nb, 'zh') || (a.seq - b.seq);
    });
    $('#lessonListCard').innerHTML = rows.length
      ? '<table class="data"><thead><tr><th>班级</th><th>课次</th><th>日期</th><th>本节任务</th>' +
        '<th>值日组</th><th>已记分组</th><th>操作</th></tr></thead><tbody>' +
        rows.map(function (l) {
          var c = getClass(l.classId);
          var n = c ? c.groups.filter(function (g) { return touched(l, g.no); }).length : 0;
          return '<tr>' +
            '<td>' + esc(c ? c.name : '（已删除）') + '</td>' +
            '<td>第 ' + l.seq + ' 次</td>' +
            '<td>' + esc(l.date || '') + '</td>' +
            '<td>' + esc(l.topic || '') + '</td>' +
            '<td>' + (l.dutyGroup ? '第 ' + l.dutyGroup + ' 组' : '—') + '</td>' +
            '<td>' + n + '</td>' +
            '<td><button class="btn tiny" data-lopen="' + l.id + '">打开</button> ' +
                '<button class="btn tiny" data-lclear="' + l.id + '">清零</button> ' +
                '<button class="btn tiny danger" data-ldel="' + l.id + '">删除</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table>'
      : '<p class="rank-note">还没有任何课次记录。</p>';
  }

  function renderRoster() {
    var cls = getClass(rosterClassId) || S.classes[0];
    if (!cls) { $('#rosterCard').innerHTML = ''; return; }
    rosterClassId = cls.id;

    var head = '<div class="btnrow">' +
      '<label class="field"><span>班级</span><select id="rosterSel">' +
      S.classes.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cls.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>教师</span><input type="text" id="rosterTeacher" value="' + esc(cls.teacher || '') + '" style="width:110px"></label>' +
      '<span class="spacer"></span>' +
      '<button class="btn tiny" id="btnAddGroup">＋ 添加一组</button></div>';

    var cols = 6;
    var body = '<table class="data"><thead><tr><th>组号</th>';
    for (var i = 1; i <= cols; i++) body += '<th>成员' + i + '</th>';
    body += '<th>操作</th></tr></thead><tbody>';
    cls.groups.forEach(function (g) {
      body += '<tr><td>第 ' + g.no + ' 组</td>';
      for (var j = 0; j < cols; j++) {
        var m = g.members[j];
        var shown = m ? (m.name + (m.sid ? ' ' + m.sid : (m.no == null ? '' : ' ' + m.no))) : '';
        body += '<td><input type="text" data-rg="' + g.no + '" data-rm="' + j + '" value="' +
          esc(shown) + '" placeholder="姓名"></td>';
      }
      body += '<td><button class="btn tiny danger" data-rgdel="' + g.no + '">删组</button></td></tr>';
    });
    body += '</tbody></table>';
    body += '<p class="rank-note">成员格填「姓名」即可，学号与班内序号会自动按全班名单补齐；' +
      '也可以手写「姓名 学号」。留空表示该位置没人。要批量调整请用「待分配名单」页。</p>';

    $('#rosterCard').innerHTML = head + body;

    $('#rosterSel').addEventListener('change', function () { rosterClassId = this.value; renderRoster(); });
    $('#rosterTeacher').addEventListener('change', function () { cls.teacher = this.value; save(); });
    $('#btnAddGroup').addEventListener('click', function () {
      var maxNo = cls.groups.reduce(function (a, g) { return Math.max(a, g.no); }, 0);
      cls.groups.push({ id: uid('g'), no: maxNo + 1, members: [] });
      save(); renderRoster();
    });
    $$('#rosterCard input[data-rg]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var g = groupOf(cls, +inp.dataset.rg);
        if (!g) return;
        var j = +inp.dataset.rm;
        var raw = inp.value.trim();
        while (g.members.length <= j) g.members.push({ id: uid('m'), name: '', sid: '' });
        var prev = g.members[j];
        if (!raw) {
          g.members[j] = { id: prev.id, name: '', sid: '', no: null };
        } else {
          /* 「姓名 26000000001」或「姓名 05」两种写法都收；
             只写姓名时保留原有的学号 / 序号，避免改个错别字把学号弄丢 */
          var mm = raw.match(/^(.*?)\s*([0-9]{1,20})$/);
          var nm = mm ? mm[1].trim() : raw;
          var tail = mm ? mm[2] : '';
          var hit = rosterOf(cls).filter(function (r) { return r.name === nm; })[0];
          g.members[j] = {
            id: prev.id,
            name: nm,
            sid: (hit && hit.sid) ? hit.sid
              : (tail.length >= 8 ? tail : (prev.sid || '')),
            no: (hit && hit.no != null) ? hit.no
              : (tail && tail.length < 8 ? parseInt(tail, 10) : (prev.no == null ? null : prev.no))
          };
        }
        while (g.members.length && !g.members[g.members.length - 1].name) g.members.pop();
        save(); renderRoster();
      });
    });
    $$('#rosterCard button[data-rgdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var no = +b.dataset.rgdel;
        if (!confirm('删除第 ' + no + ' 组？该组的历史记分也会一起消失。')) return;
        cls.groups = cls.groups.filter(function (g) { return g.no !== no; });
        S.lessons.forEach(function (l) { if (l.classId === cls.id) delete l.scores[String(no)]; });
        save(); renderRoster();
      });
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.lopen) {
      var l = getLesson(b.dataset.lopen);
      if (l) { S.ui.classId = l.classId; S.ui.lessonId = l.id; save(); switchView('score'); }
      return;
    }
    if (b.dataset.lclear) {
      var l2 = getLesson(b.dataset.lclear);
      if (l2 && confirm('把第 ' + l2.seq + ' 次课的分数全部清零？（课次本身保留）')) {
        l2.scores = {};
        dropUndoForLesson(l2.id);
        save(); renderData();
      }
      return;
    }
    if (b.dataset.ldel) {
      var l3 = getLesson(b.dataset.ldel);
      if (l3 && confirm('删除第 ' + l3.seq + ' 次课的全部记录？此操作不可撤销。')) {
        S.lessons = S.lessons.filter(function (x) { return x.id !== l3.id; });
        if (S.ui.lessonId === l3.id) S.ui.lessonId = null;
        dropUndoForLesson(l3.id);
        save(); renderData();
      }
      return;
    }
  });

  /* ================= 导出 ================= */

  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportLesson() {
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) { alert('请先在「上课记分」页选一个课次。'); return; }
    var rows = [['班级', cls.name, '第 ' + lesson.seq + ' 次课', '日期', lesson.date || '',
                 '本节任务', lesson.topic || '', '值日组', lesson.dutyGroup || '']];
    rows.push([]);
    rows.push(['组号', '成员', '首个正确', '小组分', '手机未入袋', '值日分', '个人扣分合计', '本节合计', '小组累计']);
    cls.groups.forEach(function (g) {
      var s = sc(lesson, g.no);
      rows.push([g.no,
        g.members.map(function (m) { return m.name; }).join('、'),
        s.first ? 1 : 0, +s.group || 0, +s.phone || 0, +s.duty || 0,
        personalSum(lesson, g.no), groupTotal(lesson, g.no), groupCum(cls, g.no)]);
    });
    download(cls.name + '_第' + lesson.seq + '次课_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  function exportCumulative() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ls = lessonsOf(cls.id);
    var rows = [['班级', cls.name, '共 ' + ls.length + ' 次课']];
    rows.push([]);
    rows.push(['组号', '成员'].concat(ls.map(function (l) { return '第' + l.seq + '课'; })).concat(['累计']));
    cls.groups.forEach(function (g) {
      rows.push([g.no, g.members.map(function (m) { return m.name; }).join('、')]
        .concat(ls.map(function (l) { return touched(l, g.no) ? groupTotal(l, g.no) : ''; }))
        .concat([groupCum(cls, g.no)]));
    });
    download(cls.name + '_累计总表_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  function exportMember() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ms = memberTotals(cls);
    var rows = [['班级', cls.name], []];
    rows.push(['排名', '姓名', '学号', '小组', '组得分', '个人扣分', '总分']);
    ms.forEach(function (m, i) {
      rows.push([i + 1, m.name, m.sid || (m.no == null ? '' : m.no), '第' + m.gno + '组',
                 m.groupScore, m.personal, m.total]);
    });
    download(cls.name + '_个人总分_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-export]');
    if (!b) return;
    if (b.dataset.export === 'lesson') exportLesson();
    if (b.dataset.export === 'cumulative') exportCumulative();
    if (b.dataset.export === 'member') exportMember();
  });

  $('#btnBackup').addEventListener('click', function () {
    download('夜夜加分助手_备份_' + stamp() + '.json',
      JSON.stringify(S, null, 2), 'application/json');
  });

  $('#btnRestore').addEventListener('click', function () { $('#fileRestore').click(); });

  $('#fileRestore').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(fr.result);
        if (!data.classes || !data.lessons) throw new Error('格式不对');
        if (!confirm('导入将覆盖本机现有数据（' + S.lessons.length + ' 条课次记录）。继续？')) return;
        S = data;
        if (!S.ui) S.ui = {};
        if (!S.undo) S.undo = [];
        save(); fillClassSelects(); initLayout(); renderUndoBtn(); switchView('score'); renderScore();
        alert('导入完成。');
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    fr.readAsText(f);
    this.value = '';
  });

  $('#btnWipe').addEventListener('click', function () {
    if (!confirm('清空全部数据，恢复成初始名单？所有课次记录都会消失。')) return;
    if (!confirm('再确认一次：此操作不可撤销，建议先下载备份 JSON。')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    S = defaultState();
    save(); fillClassSelects(); initLayout(); renderUndoBtn(); switchView('score'); renderScore();
  });

  /* ================= 打印 ================= */

  /** 打印前设好纸张方向：本课记录纵向（和纸质表一样），积分总览横向 */
  function printArea(html, orient) {
    var b = document.body;
    b.classList.remove('print-lesson', 'print-rank');
    b.classList.add(orient === 'rank' ? 'print-rank' : 'print-lesson');
    $('#printArea').innerHTML = html;
    window.print();
  }

  var XL_RULE = '加分规则：①首个正确完成并通过验收的小组「首个正确」+1（整组）；' +
    '②「小组分」为整组完成质量（0-10分）；③本节课值日组「值日分」0-5 分（按工具清点与场地整理质量评分）。' +
    '扣分规则：④课堂说话等违纪，由教师在对应成员的姓名下方「个人扣分」栏记录，每次 -1（犯几次记几次）；' +
    '⑤手机未入袋（纪委按学号登记），本组每人 -1。';

  /** 班内序号补两位，跟纸质表的「张三 05」一致 */
  function two(n) {
    if (n == null || n === '') return '';
    return n < 10 ? '0' + n : '' + n;
  }

  /** 打印本课：完全照着纸质《课堂分组与加分记录表》的 12 列版式 */
  function printLesson(cls, lesson) {
    var dg = lesson.dutyGroup ? +lesson.dutyGroup : null;

    var cols = '<col class="w-no">';
    for (var c = 0; c < GROUP_CAP; c++) cols += '<col class="w-mem">';
    cols += '<col class="w-first"><col class="w-grp"><col class="w-phone">' +
      '<col class="w-duty"><col class="w-sum">';

    var subHead = '';
    for (var k = 0; k < GROUP_CAP; k++) subHead += '<th class="c-mem">成员' + (k + 1) + '</th>';

    var head = '<thead><tr>' +
      '<th class="c-no" rowspan="2">组<br>号</th>' +
      '<th class="c-mem" colspan="' + GROUP_CAP + '">小组成员姓名 / 个人扣分（-1/次）</th>' +
      '<th class="c-first" rowspan="2">全组·首个正确<br>(+1)</th>' +
      '<th class="c-grp" rowspan="2">全组·小组分<br>(0-10)</th>' +
      '<th class="c-phone" rowspan="2">全组·手机未入袋<br>（-1/人）</th>' +
      '<th class="c-duty" rowspan="2">全组·值日分<br>(0-5)</th>' +
      '<th class="c-sum" rowspan="2">本节<br>合计</th>' +
      '</tr><tr>' + subHead + '</tr></thead>';

    var body = cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var isDuty = (dg === g.no);
      var names = '', deds = '';
      for (var i = 0; i < GROUP_CAP; i++) {
        var m = g.members[i];
        names += '<td class="c-mem">' +
          ((m && m.name) ? esc(m.name) + ' ' + two(m.no == null ? null : m.no) : '') + '</td>';
        var dv = +s.personal[String(i)] || 0;
        deds += '<td class="c-ded">' + (dv ? dv : '') + '</td>';
      }
      return '<tbody data-pg="' + g.no + '"' + (isDuty ? ' class="is-duty"' : '') + '>' +
        '<tr class="gname">' +
          '<td class="c-no' + (isDuty ? ' duty' : '') + '" rowspan="2">' + g.no + '</td>' +
          names +
          '<td class="c-first" rowspan="2">' + (s.first ? 1 : '') + '</td>' +
          '<td class="c-grp" rowspan="2">' + (+s.group || '') + '</td>' +
          '<td class="c-phone" rowspan="2">' + (+s.phone || '') + '</td>' +
          '<td class="c-duty" rowspan="2">' + (+s.duty || '') + '</td>' +
          '<td class="c-sum" rowspan="2">' +
            (touched(lesson, g.no) ? fmt(groupTotal(lesson, g.no)) : '') + '</td>' +
        '</tr>' +
        '<tr class="gded">' + deds + '</tr>' +
      '</tbody>';
    }).join('');

    /* 备注行：先写待分组名单（纸质表本来就有），再跟一行各组累计 */
    var pend = pendingList(cls);
    var note = '备注·待分组名单（共' + pend.length + '人）：' +
      (pend.length ? pend.map(function (r) {
        return esc(r.name) + '(' + two(r.no) + ')';
      }).join('、') : '无，全班都已分组');
    var cumLine = '各组累计：' + cls.groups.map(function (g) {
      return g.no + '组' + fmt(groupCum(cls, g.no));
    }).join('　');

    var foot = '<tfoot>' +
      '<tr><td class="c-note" colspan="' + (GROUP_CAP + 6) + '">' + note + '</td></tr>' +
      '<tr><td class="c-note" colspan="' + (GROUP_CAP + 6) + '">' + esc(cumLine) + '</td></tr>' +
      '</tfoot>';

    printArea(
      '<div class="sheet">' +
        '<div class="sheet-title">《电气接线原理》课堂分组与加分记录表</div>' +
        '<div class="sheet-info">班级：' + esc(cls.name) +
          '　教师：' + esc(cls.teacher || '') +
          '　第 ' + lesson.seq + ' 次课' +
          '　日期：' + esc(lesson.date || '') +
          '　本节任务：' + esc(lesson.topic || '') + '</div>' +
        '<div class="sheet-duty">本节课值日小组：' +
          (dg ? '第 ' + dg + ' 组' : '第 ______ 组（未指定）') +
          '　（值日生负责工具清点与场地整理，全组加「值日分」）</div>' +
        '<div class="sheet-rule">' + esc(XL_RULE) + '</div>' +
        '<table class="sheet-tb"><colgroup>' + cols + '</colgroup>' + head + body + foot + '</table>' +
      '</div>',
      'lesson'
    );
  }

  function printRank() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ls = lessonsOf(cls.id);
    var gr = cls.groups.map(function (g) { return { no: g.no, t: groupCum(cls, g.no) }; })
      .sort(function (a, b) { return b.t - a.t; });
    var ms = memberTotals(cls);

    var html = '<div class="rp">' +
      '<h2>' + esc(cls.name) + ' · 积分总览（截至第 ' + (ls.length ? ls[ls.length - 1].seq : 0) + ' 次课）</h2>' +
      '<p class="ph">教师：' + esc(cls.teacher || '') + '　共 ' + ls.length + ' 次课记录　打印时间：' +
      new Date().toLocaleString('zh-CN') + '</p>' +
      '<h2>一、小组累计排行</h2><table><thead><tr><th>名次</th><th>组号</th><th>人数</th><th>累计得分</th></tr></thead><tbody>' +
      gr.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td>第 ' + r.no + ' 组</td><td>' +
          (memberCount(groupOf(cls, r.no)) || '') + '</td><td><b>' + fmt(r.t) + '</b></td></tr>';
      }).join('') + '</tbody></table>';

    if (ms.length) {
      html += '<h2>二、个人总分排行</h2><table><thead><tr><th>名次</th><th>姓名</th><th>学号</th><th>小组</th>' +
        '<th>组得分</th><th>个人扣分</th><th>总分</th></tr></thead><tbody>' +
        ms.map(function (m, i) {
          return '<tr' + (i === 0 && m.total > 0 ? ' class="top1"' : '') + '><td>' + (i + 1) + '</td><td>' +
            esc(m.name) + '</td><td>' + esc(m.sid || (m.no == null ? '' : m.no)) +
            '</td><td>第 ' + m.gno + ' 组</td><td>' + fmt(m.groupScore) +
            '</td><td>' + (m.personal ? '−' + m.personal : '0') + '</td><td><b>' + fmt(m.total) + '</b></td></tr>';
        }).join('') + '</tbody></table>';
    }

    if (ls.length) {
      html += '<div class="pagebreak"></div><h2>三、逐节得分明细</h2><table><thead><tr><th>组号</th>' +
        ls.map(function (l) { return '<th>第' + l.seq + '课</th>'; }).join('') +
        '<th>累计</th></tr></thead><tbody>' +
        cls.groups.map(function (g) {
          return '<tr><td>第 ' + g.no + ' 组</td>' +
            ls.map(function (l) { return '<td>' + (touched(l, g.no) ? fmt(groupTotal(l, g.no)) : '') + '</td>'; }).join('') +
            '<td><b>' + fmt(groupCum(cls, g.no)) + '</b></td></tr>';
        }).join('') + '</tbody></table>';
    }

    printArea(html + '</div>', 'rank');
  }

  /* ================= 顶部交互 ================= */

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) switchView(b.dataset.view);
  });

  $('#classSel').addEventListener('change', function () {
    S.ui.classId = this.value; S.ui.lessonId = null; save(); renderScore();
  });
  $('#lessonSel').addEventListener('change', function () {
    S.ui.lessonId = this.value; save(); renderScore();
  });
  $('#rankClassSel').addEventListener('change', function () {
    S.ui.classId = this.value; save(); renderRank();
  });
  $('#btnPrintRank').addEventListener('click', printRank);

  /* 撤销：按钮 + Ctrl/Cmd+Z */
  $('#btnUndo').addEventListener('click', function () { undo(); });

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
    var k = (e.key || '').toLowerCase();
    if (k !== 'z') return;
    var ae = document.activeElement;
    var tag = ae ? ae.tagName : '';
    /* 在输入框里按 Ctrl+Z 交给浏览器自己的文本撤销，别抢 */
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (undo()) e.preventDefault();
  });

  /* 表格式 / 卡片式 切换 */
  $('#layoutSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-l]');
    if (!b || b.dataset.l === scoreLayout) return;
    scoreLayout = b.dataset.l;
    S.ui.scoreLayout = scoreLayout;
    $$('#layoutSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
    save(false);
    renderScore();
  });

  /* 新开一课 */
  var dlg = $('#dlgLesson');
  $('#btnNewLesson').addEventListener('click', function () {
    var cls = curClass();
    if (!cls) { alert('没有可用班级。'); return; }
    var ls = lessonsOf(cls.id);
    $('#nlClass').value = cls.name;
    $('#nlSeq').value = ls.length ? (ls[ls.length - 1].seq || ls.length) + 1 : 1;
    $('#nlDate').value = today();
    $('#nlTopic').value = '';
    $('#nlDuty').value = '';
    openDlg(dlg);
  });

  dlg.addEventListener('close', function () {
    if (dlg.returnValue !== 'ok') return;
    var cls = curClass();
    var seq = Math.max(1, parseInt($('#nlSeq').value, 10) || 1);
    var duty = parseInt($('#nlDuty').value, 10);
    var l = {
      id: uid('l'),
      classId: cls.id,
      seq: seq,
      date: $('#nlDate').value || today(),
      topic: $('#nlTopic').value.trim(),
      dutyGroup: isNaN(duty) ? null : duty,
      scores: {}
    };
    S.lessons.push(l);
    S.ui.lessonId = l.id;
    save();
    renderScore();
    flash('第 ' + l.seq + ' 次课已开始记录');
  });

  /* ================= 登录闸门 / 云端同步 ================= */

  var offlineWhy = '';

  /** 没有云端时还能不能干活：本机有存档、或至少带着 data.js 的内置名单 */
  function hasLocalData() {
    try { if (localStorage.getItem(LS_KEY)) return true; } catch (e) { /* 隐私模式 */ }
    return !!(window.SEED_DATA && window.SEED_DATA.classes);
  }

  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 满了 */ }
  }

  function fmtTime(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function gateShow(which, msg, info) {
    document.body.classList.add('gated');
    $('#gate').hidden = false;
    ['login', 'invite', 'offline'].forEach(function (k) { $('#gate' + k[0].toUpperCase() + k.slice(1)).hidden = (k !== which); });
    var m = $('#gateMsg');
    m.hidden = !msg;
    m.textContent = msg || '';
    m.classList.toggle('info', !!info);
  }

  function gateHide() {
    document.body.classList.remove('gated');
    $('#gate').hidden = true;
  }

  function setGateBusy(busy) {
    ['#btnWxLogin', '#btnWbLogin', '#btnRedeem', '#btnLocalOnly'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.disabled = !!busy;
    });
  }

  function doOauth(provider) {
    setGateBusy(true);
    gateShow('login', null);
    CLOUD.oauthLogin(provider).catch(function (e) {
      setGateBusy(false);
      gateShow('login', '登录没能进行下去：' + (e && e.message ? e.message : e));
    });
  }

  function renderUserBox(p) {
    var box = $('#userBox');
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    var nm = p.displayName || p.name || '未命名老师';
    $('#userName').textContent = nm;
    var av = $('#userAvatar');
    if (p.avatarUrl) {
      av.innerHTML = '<img alt="" src="' + esc(p.avatarUrl) + '">';
    } else {
      av.textContent = nm.slice(0, 1);
    }
    /* 管理员在名字后面挂一块 VIP 金牌 —— 和「管理」页一致的身份提示 */
    var vip = $('#userVip');
    if (vip) vip.hidden = !p.isAdmin;
    $('#tabAdmin').hidden = !p.isAdmin;
  }

  /* ---------------- 个人信息（微信登录拿不到昵称，让老师自己填一次） ---------------- */

  var dlgMe = $('#dlgMe');
  var meNudged = false;              // 「还没填名字」只提示一次

  /* <dialog> 关掉之后要立刻再撑开（校验没过、保存失败都要留在这一页）。
     showModal 在极少数情况下会抛 InvalidStateError，退一步用 setTimeout 再来一次。 */
  function reopenDlg(d) {
    try { openDlg(d); } catch (e) { setTimeout(function () { openDlg(d); }, 0); }
  }

  function openMe() {
    var p = (CLOUD && CLOUD.profile && CLOUD.profile()) || null;
    if (!p) return;
    $('#meName').value = p.displayName || p.name || '';
    $('#meReal').value = p.realName || '';
    $('#meMsg').hidden = true;
    $('#btnMeSave').disabled = false;
    openDlg(dlgMe);
  }

  dlgMe.addEventListener('close', function () {
    if (dlgMe.returnValue !== 'ok') return;
    var name = $('#meName').value.trim();
    var real = $('#meReal').value.trim();
    var msg = $('#meMsg');
    if (!name) {
      /* 空名字会让管理员在列表里看到一串「未命名」，所以直接挡住 */
      msg.textContent = '名字不能空着，不然别人分不清你是谁。';
      msg.className = 'gate-msg';
      msg.hidden = false;
      reopenDlg(dlgMe);                     // method="dialog" 已经把窗口关了，再撑开
      return;
    }
    $('#btnMeSave').disabled = true;
    CLOUD.updateProfile(name, real).then(function (p) {
      renderUserBox(p);
      flash('名字已保存');
    }).catch(function (e) {
      $('#btnMeSave').disabled = false;
      msg.textContent = '没能保存：' + (e && e.message ? e.message : e);
      msg.className = 'gate-msg';
      msg.hidden = false;
      reopenDlg(dlgMe);
    });
  });

  function renderCloudStatus(st) {
    st = st || (CLOUD && CLOUD.status()) || { mode: 'idle', text: '' };
    var map = { ok: 'ok', saving: 'saving', connecting: 'saving', offline: 'offline', error: 'error' };
    var cls = map[st.mode] || '';
    var text = st.mode === 'idle' ? '未连接云端' : st.text;

    var chip = $('#cloudChip');
    chip.className = 'chip ' + cls;
    chip.textContent = text;
    chip.hidden = false;

    var row = $('.sync-row');
    if (row) {
      row.className = 'sync-row ' + cls;
      $('#syncText').textContent = text;
    }

    /* 进了应用但云端没连上：在页面顶部挂一条明确的提示，别让人以为已经在同步 */
    var warn = $('#localWarn');
    if (warn) {
      var bad = !CLOUD_ON && st.mode !== 'connecting';
      warn.hidden = !bad;
      if (bad) {
        warn.innerHTML = '<b>现在没连上云端</b> —— 这节课的记录只存在这台设备上，网络恢复后会自动补传。' +
          (offlineWhy ? '<span class="why">（' + esc(offlineWhy) + '）</span>' : '') +
          ' <button class="linkbtn" id="btnRetryCloud">重试连接</button>';
        var rb = $('#btnRetryCloud');
        if (rb) rb.addEventListener('click', function () { refreshCloud(); });
      }
    }
  }

  /** 云端有更新就拉下来覆盖本机（只在本机没更新时） */
  function refreshCloud() {
    if (!CLOUD || !CLOUD.available()) { renderCloudStatus(); return; }
    CLOUD.pull().then(function (rec) {
      CLOUD_ON = true;
      renderCloudStatus();
      if (!rec || !rec.data || !rec.data.classes) { renderLocalBanner(); return; }
      var cAt = Date.parse(rec.updated_at || '') || 0;
      var lAt = S.updatedAt ? Date.parse(S.updatedAt) : 0;
      if (cAt > lAt) {
        S = migrate(JSON.parse(JSON.stringify(rec.data)));
        if (!S.ui) S.ui = {};
        var keep = cloudUiBackup;
        if (keep) { S.ui.classId = keep.classId; S.ui.lessonId = keep.lessonId; S.ui.scoreLayout = keep.scoreLayout; }
        writeLocal();
        fillClassSelects();
        renderScore();
        flash('已从云端拉取最新记录');
      } else if (lAt > cAt) {
        CLOUD.flush();
      }
      renderLocalBanner();
    }).catch(function () { renderCloudStatus(); });
  }

  var cloudUiBackup = null;

  function renderLocalBanner() {
    renderCloudStatus();
    var b = $('#poolBanner');
    if (!b) return;
    renderPoolBanner(curClass());
  }

  /* ---- 管理页 ---- */

  function renderAdmin() {
    var p = CLOUD && CLOUD.profile();
    if (!CLOUD_ON || !p || !p.isAdmin) return;

    var il = $('#inviteList');
    il.innerHTML = '<p class="note">正在加载…</p>';
    CLOUD.admin.listInvites().then(function (rows) {
      rows = rows || [];
      if (!rows.length) {
        il.innerHTML = '<p class="note">还没有生成过邀请码。上面点「生成邀请码」开始。</p>';
        return;
      }
      il.innerHTML = '<table class="data"><thead><tr><th>邀请码</th><th>备注</th><th>类型</th>' +
        '<th>状态</th><th>谁在用</th><th>生成时间</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var stat = r.is_used ? '<span class="tag used">已使用</span>'
            : (r.disabled ? '<span class="tag off">已停用</span>' : '<span class="tag free">未使用</span>');
          return '<tr class="' + (r.is_used ? '' : 'row-pending') + '"><td class="mono">' + esc(r.code) +
            '</td><td>' + esc(r.note || '') + '</td><td>' + (r.role === 'admin' ? '管理员' : '老师') +
            '</td><td>' + stat + '</td><td>' + esc(r.used_by_name || '') +
            '</td><td>' + fmtTime(r.created_at) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (e) {
      il.innerHTML = '<p class="note">加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
    });

    var tl = $('#teacherList');
    tl.innerHTML = '<p class="note">正在加载…</p>';
    CLOUD.admin.listTeachers().then(function (rows) {
      rows = rows || [];
      if (!rows.length) { tl.innerHTML = '<p class="note">还没有老师激活过账号。</p>'; return; }
      tl.innerHTML = '<table class="data"><thead><tr><th>老师</th><th>角色</th><th>班级</th>' +
        '<th>课次</th><th>最近同步</th><th></th></tr></thead><tbody>' +
        rows.map(function (t) {
          return '<tr><td>' + esc(t.display_name || t.real_name || '未命名老师') +
            '</td><td>' + (t.is_admin ? '管理员' : '老师') +
            '</td><td>' + (t.class_count || 0) + '</td><td>' + (t.lesson_count || 0) +
            '</td><td>' + fmtTime(t.synced_at) + '</td>' +
            '<td><button class="btn tiny" data-look="' + esc(t.uid) + '" data-name="' +
            esc(t.display_name || t.real_name || '未命名老师') + '">查看数据</button></td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (e) {
      tl.innerHTML = '<p class="note">加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
    });
  }

  function showTeacherData(uid, name) {
    $('#dtTitle').textContent = name + ' 的数据';
    $('#dtBody').innerHTML = '<p class="note">正在加载…</p>';
    openDlg($('#dlgTeacher'));
    CLOUD.admin.getState(uid).then(function (r) {
      if (!r || r.ok === false) { $('#dtBody').innerHTML = '<p class="note">没有权限查看，或该老师还没同步过数据。</p>'; return; }
      var d = r.data;
      if (!d || !d.classes || !d.classes.length) {
        $('#dtBody').innerHTML = '<p class="note">这位老师还没有班级数据。</p>';
        return;
      }
      var rows = d.classes.map(function (c) {
        var mem = 0;
        (c.groups || []).forEach(function (g) { mem += memberCount(g); });
        var ls = (d.lessons || []).filter(function (l) { return l.classId === c.id; });
        var top = 0, topNo = 0;
        (c.groups || []).forEach(function (g) {
          var v = 0;
          ls.forEach(function (l) { v += groupTotal(l, g.no); });
          if (v > top) { top = v; topNo = g.no; }
        });
        return '<tr><td>' + esc(c.name) + '</td><td class="n">' + (c.groups || []).length +
          '</td><td class="n">' + mem + '</td><td class="n">' + ls.length +
          '</td><td class="n">' + (topNo ? ('第 ' + topNo + ' 组 ' + fmt(top)) : '—') + '</td></tr>';
      }).join('');
      $('#dtBody').innerHTML =
        '<p class="note dt-meta">最近同步：' + fmtTime(r.updated_at) +
        '　共 ' + d.classes.length + ' 个班、' + (d.lessons || []).length + ' 节课</p>' +
        '<table><thead><tr><th>班级</th><th class="n">小组</th><th class="n">学生</th>' +
        '<th class="n">课次</th><th class="n">累计最高</th></tr></thead><tbody>' +
        rows + '</tbody></table>' +
        '<div class="btnrow dt-foot"><button class="btn tiny" id="btnDlTeacher">' +
        '下载这位老师的完整数据 JSON</button></div>';
      var dl = $('#btnDlTeacher');
      if (dl) dl.addEventListener('click', function () {
        download('夜夜加分助手_' + name + '_' + stamp() + '.json',
          JSON.stringify({ source: 'admin-export', name: name, uid: uid, data: d }, null, 2),
          'application/json');
      });
    }).catch(function (e) {
      $('#dtBody').innerHTML = '<p class="note">加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
    });
  }

  /* ---- 进应用 ---- */

  function startApp(profile, rec) {
    CLOUD_ON = !!(CLOUD && profile);
    cloudRec = rec || null;

    S = load();
    if (!S) {
      document.body.classList.remove('gated');
      $('#gate').hidden = true;
      $('#main').innerHTML = '<div class="card" style="margin:40px auto;max-width:520px">' +
        '<h2>缺少班级数据</h2><p class="note">没找到内置名单文件 data.js，也没找到本机存档。</p></div>';
      return;
    }

    var cloudData = rec && rec.data;
    var localAt = S.updatedAt ? Date.parse(S.updatedAt) : 0;
    var cloudAt = rec && rec.updated_at ? Date.parse(rec.updated_at) : 0;

    if (cloudData && cloudData.classes && cloudAt > localAt) {
      S = migrate(JSON.parse(JSON.stringify(cloudData)));   // 云端更新 → 以云端为准
      writeLocal();
    }

    if (!S.ui) S.ui = {};
    if (!S.undo) S.undo = [];
    if (!S.ui.classId && S.classes[0]) S.ui.classId = S.classes[0].id;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };

    initLayout();
    fillClassSelects();
    renderUndoBtn();
    renderUserBox(profile);

    /* 微信不给昵称，第一次进来先请老师把名字填上，免得管理员那边一列都是「未命名老师」。
       只在本次启动提示一次，关掉了就不再烦人。 */
    if (profile && !profile.displayName && !meNudged) {
      meNudged = true;
      openMe();
    }
    gateHide();

    /* 本机比云端新（含"第一次登录，把本机旧记录搬上云"）→ 推上去 */
    if (CLOUD_ON && (!cloudData || localAt > cloudAt)) {
      CLOUD.touch(function () { return S; });
    }
    renderCloudStatus();
    renderPoolBanner(curClass());
    switchView('score');
  }

  /* ================= 启动 ================= */

  /* 云端状态 → 顶栏小圆点 + 数据页同步条 */
  if (CLOUD) CLOUD.onStatus(renderCloudStatus);

  /* 闸门上的按钮 */
  $('#btnWxLogin').addEventListener('click', function () { doOauth('wechat'); });
  $('#btnWbLogin').addEventListener('click', function () { doOauth('workbuddy'); });
  $('#btnGateSignOut').addEventListener('click', function () {
    if (CLOUD) CLOUD.signOut();
  });
  $('#btnLocalOnly').addEventListener('click', function () {
    startApp(null, null);   // 明确进入"仅本机"模式，界面上会一直挂着未同步提示
  });
  $('#btnRedeem').addEventListener('click', function () {
    var code = $('#inviteCode').value.trim();
    if (!code) { gateShow('invite', '请先填写邀请码。', true); return; }
    setGateBusy(true);
    CLOUD.redeem(code).then(function (p) {
      setGateBusy(false);
      return CLOUD.pull().then(function (rec) {
        renderUserBox(p);
        startApp(p, rec);
      });
    }).catch(function (e) {
      setGateBusy(false);
      gateShow('invite', e && e.message ? e.message : String(e));
    });
  });
  $('#inviteCode').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('#btnRedeem').click();
  });

  /* 数据页的同步按钮 */
  $('#btnSyncNow').addEventListener('click', function () {
    if (!CLOUD || !CLOUD.available()) { alert('云端组件没加载出来，请检查网络后刷新页面。'); return; }
    CLOUD.flush().then(function () { refreshCloud(); });
  });
  $('#btnPullCloud').addEventListener('click', function () {
    if (!confirm('用云端的记录覆盖这台设备上的记录？\n\n本机现在的分数会被替换掉（云端记录是同一账号在别的设备上存的那份）。')) return;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };
    CLOUD.pull().then(function (rec) {
      if (!rec || !rec.data || !rec.data.classes) { alert('云端还没有这个账号的记录。'); return; }
      S = migrate(JSON.parse(JSON.stringify(rec.data)));
      if (!S.ui) S.ui = {};
      if (cloudUiBackup) { S.ui.classId = cloudUiBackup.classId; S.ui.lessonId = cloudUiBackup.lessonId; S.ui.scoreLayout = cloudUiBackup.scoreLayout; }
      if (!S.ui.classId && S.classes[0]) S.ui.classId = S.classes[0].id;
      S.updatedAt = new Date().toISOString();
      writeLocal();
      initLayout();
      fillClassSelects();
      renderUndoBtn();
      renderData();
      flash('已用云端记录覆盖本机');
    }).catch(function (e) {
      alert('拉取失败：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnPushCloud').addEventListener('click', function () {
    if (!confirm('把这台设备上的记录传到云端，覆盖云端那一份？')) return;
    CLOUD.touch(function () { return S; });
    CLOUD.flush().then(function () { alert('已经上传到云端。'); });
  });
  $('#btnSignOut').addEventListener('click', function () {
    if (!confirm('退出登录？\n\n本机的记录不会被删除；下次用同一个微信登录，记录还会同步回来。')) return;
    CLOUD.signOut();
  });
  $('#btnMe').addEventListener('click', openMe);
  $('#btnUserMenu').addEventListener('click', function () { switchView('data'); });

  /* 管理页 */
  $('#btnGenInvite').addEventListener('click', function () {
    var n = $('#invCount').value;
    var note = $('#invNote').value;
    var role = $('#invRole').value;
    $('#btnGenInvite').disabled = true;
    CLOUD.admin.createInvites(n, note, role).then(function (r) {
      $('#btnGenInvite').disabled = false;
      var box = $('#invFresh');
      box.hidden = false;
      box.innerHTML = '<p>已生成 ' + r.created + ' 个邀请码（' +
        (role === 'admin' ? '管理员' : '普通老师') + '），发给对应的人，<b>每个码只能用一次</b>：</p>' +
        '<div class="codes">' + r.codes.map(function (c) {
          return '<span class="code">' + esc(c) + '</span>';
        }).join('') + '</div>' +
        '<p style="margin:8px 0 0">长按/双击可以选中复制。' + (note ? '备注：' + esc(note) : '') + '</p>';
      renderAdmin();
    }).catch(function (e) {
      $('#btnGenInvite').disabled = false;
      alert('生成失败：' + (e && e.message ? e.message : e));
    });
  });
  $('#teacherList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-look]');
    if (b) showTeacherData(b.dataset.look, b.dataset.name);
  });

  /* 进入应用：有云端就走云端，没有就降级成本机模式（页面顶部会写明） */
  if (!CLOUD) {
    startApp(null, null);
  } else {
    CLOUD.boot({
      onReady: function (profile, rec) { renderUserBox(profile); startApp(profile, rec); },
      onNeedLogin: function (msg) {
        document.body.classList.add('gated');
        renderUserBox(null);
        gateShow('login', msg ? ('登录没能完成：' + msg) : null);
      },
      onNeedInvite: function (p) {
        document.body.classList.add('gated');
        renderUserBox(p);
        $('#gateWho').textContent = p.name ? ('（' + p.name + '）') : '';
        gateShow('invite', null);
      },
      onOffline: function (why) {
        offlineWhy = why;
        if (hasLocalData()) {
          /* 断网 / CDN 被拦时照常上课，页面顶部会挂着"还没连上云端"的提示条 */
          startApp(null, null);
          renderCloudStatus({ mode: 'offline', text: '未连接云端' });
        } else {
          document.body.classList.add('gated');
          renderUserBox(null);
          $('#offlineWhy').textContent = why;
          $('#btnLocalOnly').hidden = true;
          gateShow('offline', null);
        }
      }
    });
  }
})();
