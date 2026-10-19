/* 夜夜小组制加分助手 —— 主逻辑
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
  var UI = window.JFDT_UI;
  function scoreFeedback(gno, f, i, delta) {
    if (UI && delta) UI.feedback(gno, f, i, delta,
      '第 ' + gno + ' 组 ' + (i != null ? memberName(curClass(), gno, +i) + ' 个人分' : FIELD_NAME[f] || f) +
      ' ' + (delta > 0 ? '+' : '−') + Math.abs(delta));
  }
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
  // Keep legacy remaining points while restoring an immutable five-point base.
  function normalizeProjectBase(score,members){if(!score)return;var base=Math.min(5,(+score.group||0)+(score.first?1:0)),phone=+score.phone||0,personal=score.personal||{},next={};members.forEach(function(m,i){if(!m.name)return;var remain=Math.max(0,base-phone-(+personal[String(i)]||0));next[String(i)]=5-remain;});score.group=5;score.first=0;score.phone=0;score.personal=next;}
  function migrateProjectBases(state){var legacyIds=new Set((state.lessons||[]).filter(function(l){return l.memberProjectBase!==5;}).map(function(l){return l.id;}));(state.lessons||[]).forEach(function(l){if(l.memberProjectBase===5)return;var cls=(state.classes||[]).find(function(c){return c.id===l.classId;});if(!cls)return;(cls.groups||[]).forEach(function(g){normalizeProjectBase((l.scores||{})[String(g.no)],g.members||[]);});l.memberProjectBase=5;});function obsolete(op){return op&&(op.f==='group'||op.f==='first'||(legacyIds.has(op.lessonId)&&(op.i!=null||op.f==='phone'||op.reset)));}state.projectLegacyUndoArchive=(state.projectLegacyUndoArchive||[]).concat((state.undo||[]).filter(obsolete).map(function(op){return {kind:'undo',op:op};}),(state.redo||[]).filter(function(e){return obsolete(e.op);}).map(function(e){return {kind:'redo',entry:e};}));state.undo=(state.undo||[]).filter(function(op){return !obsolete(op);});state.redo=(state.redo||[]).filter(function(e){return !obsolete(e.op);});function snapshot(op,score){var l=(state.lessons||[]).find(function(l){return l.id===op.lessonId;}),cls=l&&(state.classes||[]).find(function(c){return c.id===l.classId;}),g=cls&&(cls.groups||[]).find(function(g){return g.no===op.gno;});if(g)normalizeProjectBase(score,g.members||[]);}state.undo.forEach(function(op){if(op.reset&&op.old)snapshot(op,op.old);});state.redo.forEach(function(e){if(e.op.reset&&e.op.old)snapshot(e.op,e.op.old);if(e.scores)snapshot(e.op,e.scores);});return state;}
  function migrate(s) {
    migrateProjectBases(s);
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
    if (!lesson.scores[k]) lesson.scores[k] = { first: 0, group: lesson.memberProjectBase===5?5:0, phone: 0, duty: 0, personal: {} };
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
    var byName = Object.create(null), bySid = Object.create(null), legacyByName = Object.create(null), nameCounts = Object.create(null);
    rosterOf(cls).forEach(function (r) { nameCounts[r.name] = (nameCounts[r.name] || 0) + 1; });
    cls.groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        byName[m.name] = g.no;
        if (m.sid) bySid[m.sid] = g.no;
        if (!m.sid || String(m.sid).length < 8) legacyByName[m.name] = g.no;
      });
    });
    return { byName: byName, bySid: bySid, legacyByName: legacyByName, nameCounts: nameCounts };
  }

  /** 该生在哪个组；未分配返回 null。优先按学号匹配，再退回姓名。 */
  function groupOfStudent(cls, r, map) {
    map = map || placedMap(cls);
    if (r.sid && map.bySid[r.sid] !== undefined) return map.bySid[r.sid];
    if ((map.nameCounts[r.name] || 0) > 1) return null;
    if (r.sid && String(r.sid).length >= 8) return map.legacyByName[r.name] === undefined ? null : map.legacyByName[r.name];
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
  function dutyGroups(lesson){return Array.isArray(lesson.dutyGroups)?lesson.dutyGroups:(lesson.dutyGroup?[Number(lesson.dutyGroup)]:[]);}
  function groupTotal(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return 0;
    return Math.round(window.JFDT_ASSESSMENT.groupNet(lesson,gno,lessonsOf(lesson.classId))*100)/100;
  }

  /** 小组累计（该班全部课次） */
  function groupCum(cls, gno) {
    return Math.round(lessonsOf(cls.id).reduce(function (a, l) { return a + groupTotal(l, gno); }, 0)*100)/100;
  }

  function groupCumThrough(cls,gno,lesson) { return Math.round(lessonsOf(cls.id).filter(function(l){return Number(l.seq)<=Number(lesson.seq);}).reduce(function(total,l){return total+groupTotal(l,gno);},0)*100)/100; }

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

  /** 个人总分 = 全组累计加分 + 个人项目累计分 − 本人累计个人扣分 */
  function projectScore(lesson, gno, member) {
    var record = lesson.leaderScores && lesson.leaderScores[String(gno)];
    var id = member.sid ? 'sid:' + member.sid : 'id:' + member.id;
    return record && record.members && record.members[id]
      ? record.members[id].reduce(function(a,n){ return a + (+n || 0); },0) : 0;
  }

  function memberTotals(cls) {
    var ls = lessonsOf(cls.id);
    var out = [];
    cls.groups.forEach(function (g) {
      var gs = groupCum(cls,g.no);
      g.members.forEach(function (m, idx) {
        if (!m.name) return;
        var p = ls.reduce(function (a, l) {
          var s = l.scores[String(g.no)];
          return a + (s ? Math.min(Math.max(0,Math.min(5,(+s.group||0)+(s.first?1:0))-(+s.phone||0)),+(s.personal||{})[String(idx)]||0) : 0);
        }, 0);
        out.push({
          name: m.name, sid: m.sid, no: m.no, gno: g.no,
          groupScore: gs, project: ls.reduce(function(a,l){return a+projectScore(l,g.no,m);},0), personal: p, total: Math.round((gs + ls.reduce(function(a,l){return a+projectScore(l,g.no,m);},0) - p)*100)/100
        });
      });
    });
    out.sort(function (a, b) { return b.total - a.total || a.gno - b.gno; });
    return out;
  }

  /* ================= 撤销 ================= */

  var UNDO_MAX = 60;
  var FIELD_NAME = { first: '首个正确', group: '小组分', phone: '全组扣分', duty: '值日分' };

  /** 记一笔可撤销的改动。只存"反做"需要的信息，很轻。
      op 三种形态：
        {lessonId, gno, f, old, neu}          标量（first / group / phone / duty）
        {lessonId, gno, i, old, neu, name}    个人扣分（第 i 个成员）
        {lessonId, gno, reset:true, old}      整组清零（old 是该组原 scores 的副本） */
  function operationEffect(op){if(op.effect)return op.effect;var l=getLesson(op.lessonId),cls=l&&getClass(l.classId),g=cls&&groupOf(cls,op.gno),now=l&&l.scores[String(op.gno)];if(op.reset&&op.old&&now&&g){function points(sc,i){return Math.max(0,Math.min(5,(+sc.group||0)+(sc.first?1:0))-(+sc.phone||0)-(+((sc.personal||{})[String(i)])||0));}var patch=g.members.map(function(m,i){return {path:'point:'+i,delta:points(now,i)-points(op.old,i)};}).filter(function(x){return x.delta;});var duty=(+now.duty||0)-(+op.old.duty||0);if(duty)patch.push({path:'duty',delta:duty});return patch;}return [{path:op.i!=null?'point:'+op.i:op.f,delta:op.i!=null?(+op.old||0)-(+op.neu||0):(+op.neu||0)-(+op.old||0)}].filter(function(x){return x.delta;});}
  function inverseEffects(a,b){return a.length===b.length&&a.every(function(x){return b.some(function(y){return x.path===y.path&&Math.abs(x.delta+y.delta)<1e-8;});});}
  function applyEffect(op,effect,direction){var l=getLesson(op.lessonId),cls=getClass(l.classId),g=groupOf(cls,op.gno),scored=sc(l,op.gno),actual=[];effect.forEach(function(e){var old,next;if(e.path.startsWith('leader:')){var token=e.path.slice(7),cut=token.lastIndexOf('|'),mk=token.slice(0,cut),col=+token.slice(cut+1),r=l.leaderScores&&l.leaderScores[String(op.gno)];if(!r)return;var values=r.members[mk]||(r.members[mk]=[]);old=Number(values[col])||0;next=Math.max(0,Math.min(5,old+direction*e.delta));values[col]=next===0&&direction<0&&e.wasBlank?null:next;}else if(e.path.startsWith('point:')){var i=e.path.slice(6),values=g.members.map(function(_,j){return remaining(l,g.no,j);});var base=Math.min(5,(+scored.group||0)+(scored.first?1:0));old=values[+i];next=Math.max(0,Math.min(base,old+direction*e.delta));scored.phone=0;scored.group=base;scored.first=0;g.members.forEach(function(_,j){scored.personal[String(j)]=base-(String(j)===i?next:values[j]);});}else if(e.path.startsWith('personal:')){var i=e.path.slice(9);old=+scored.personal[i]||0;next=Math.max(0,Math.min(5,old+direction*e.delta));scored.personal[i]=next;}else{old=+scored[e.path]||0;next=Math.max(0,Math.min(e.path==='phone'?1000000:5,old+direction*e.delta));scored[e.path]=next;if(e.path==='duty'){var meta=direction<0?op.oldDutyMeta:op.neuDutyMeta,target=direction<0?op.old:op.neu;if(meta&&Math.abs(next-target)<1e-8)scored.dutyParticipation=JSON.parse(JSON.stringify(meta));else delete scored.dutyParticipation;}}if(next!==old)actual.push({path:e.path,delta:next-old,wasBlank:e.wasBlank});});return actual;}
  function pushUndo(op) {
    if (!S.undo) S.undo = [];
    op.id=op.id||uid('op');
    op.effect=operationEffect(op);
    var auditLesson=getLesson(op.lessonId),auditClass=auditLesson&&getClass(auditLesson.classId),auditGroup=auditClass&&groupOf(auditClass,op.gno);
    if(auditGroup&&!op.audit){var totals=memberTotals(auditClass),effects=op.effect,points=effects.filter(function(e){return /^(point:|personal:)/.test(e.path);}),targets=(points.length?points.map(function(e){return +e.path.split(':')[1];}):auditGroup.members.map(function(_,i){return i;})).filter(function(i,p,a){return a.indexOf(i)===p&&auditGroup.members[i]&&auditGroup.members[i].name;});var deltas=targets.map(function(i){return effects.reduce(function(sum,e){return sum+(e.path==='point:'+i?e.delta:e.path==='personal:'+i?-e.delta:['group','first','duty'].includes(e.path)?e.delta:e.path==='phone'?-e.delta:0);},0);});op.audit={source:op.f==='duty'?'值日人数':'上课记分',lesson:auditClass.name+' · 第'+auditLesson.seq+'次课 · '+auditLesson.date+' · '+(auditLesson.topic||''),student:targets.length===1?auditGroup.members[targets[0]].name:'第'+op.gno+'组 · '+targets.map(function(i){return auditGroup.members[i].name;}).join('、'),sid:targets.length===1?auditGroup.members[targets[0]].sid||'':'全组操作',delta:deltas.length&&deltas.every(function(d){return d===deltas[0];})?(deltas[0]>0?'+':'')+deltas[0]+(targets.length>1?'/人':''):'—',after:targets.map(function(i){var m=auditGroup.members[i],row=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===op.gno&&t.name===m.name;});return row?row.total:'—';}).join(' / ')};}

    op.at = new Date().toISOString();
    addOperationLog('记分', undoLabel(reverseOp(op)),op);
    var opposite=-1;for(var oi=S.undo.length-1;oi>=0&&op.f!=='group'&&(+sc(getLesson(op.lessonId),op.gno).group===5);oi--){var previous=S.undo[oi];if(previous.lessonId===op.lessonId&&previous.gno===op.gno&&operationEffect(previous).some(function(e){return op.effect.some(function(x){return e.path===x.path;});})){if(inverseEffects(operationEffect(previous),op.effect))opposite=oi;break;}}
    if(opposite>=0)S.undo.splice(opposite,1);else S.undo.push(op);
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
    var lesson = getLesson(op.lessonId), cls = lesson && getClass(lesson.classId);
    var g = (cls ? cls.name + ' · 第' + lesson.seq + '次课 · ' : '') + '第 ' + op.gno + ' 组';
    if(op.projectBatch)return g+' 已命名项目全员满分（每项5分）';
    if (op.reset) return g + ' '+(op.label||'本节清零');
    if(op.f==='duty'&&Object.prototype.hasOwnProperty.call(op,'neuDutyMeta'))return g+' 值日 '+dutyLabel(op.neuDutyMeta,op.neu)+' → '+dutyLabel(op.oldDutyMeta,op.old);
    if (op.i != null) {
      return g + ' ' + (op.name || '成员') + ' 个人扣分 ' + op.neu + ' → ' + op.old;
    }
    return g + ' ' + (FIELD_NAME[op.f] || op.f) + ' ' + showVal(op.f, op.neu) +
      ' → ' + showVal(op.f, op.old);
  }

  function dutyLabel(meta,value){return (meta?meta.present+'/'+meta.expected+'人，':'历史分 ')+value+'分';}
  function reverseOp(op){return Object.assign({},op,{old:op.neu,neu:op.old},Object.prototype.hasOwnProperty.call(op,'oldDutyMeta')?{oldDutyMeta:op.neuDutyMeta,neuDutyMeta:op.oldDutyMeta}:{});}

  function showVal(f, v) {
    if (f === 'first') return v ? '已加' : '未加';
    return String(v);
  }

  function addOperationLog(kind, detail, op) {
    if (!S.operationLog) S.operationLog=[];
    S.operationLog.push({id:uid('log'),at:new Date().toISOString(),kind:kind,detail:detail,lessonId:op&&op.lessonId,opId:op&&op.id,audit:op&&op.audit?JSON.parse(JSON.stringify(op.audit)):undefined});
    if(S.operationLog.length>500) S.operationLog.splice(0,S.operationLog.length-500);
  }
  function canUndoAt(index) {
    var op=(S.undo||[])[index]; if(!op || !getLesson(op.lessonId))return false;if(op.projectBatch&&JSON.stringify(window.JFDT_ASSESSMENT.projectNames(getLesson(op.lessonId)))!==JSON.stringify(op.projectNames))return false;
    return true;
  }
  function renderOperationLog() {
    var list=$('#operationLogList'); if(!list) return;
    var classFilter=$('#logClassFilter'),savedClass=classFilter.value,search=$('#logSearch').value.trim().toLowerCase();
    classFilter.innerHTML='<option value="">全部班级</option>'+S.classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>';}).join('');classFilter.value=savedClass;
    var lessonFilter=$('#logLessonFilter'),savedLesson=lessonFilter.value;
    lessonFilter.innerHTML='<option value="">全部课次</option>'+S.lessons.filter(function(l){return !classFilter.value||l.classId===classFilter.value;}).sort(function(a,b){return b.seq-a.seq;}).map(function(l){var c=getClass(l.classId);return '<option value="'+esc(l.id)+'">'+esc((!classFilter.value&&c?c.name+' · ':'')+'第'+l.seq+'次课 · '+l.date)+'</option>';}).join('');lessonFilter.value=Array.from(lessonFilter.options).some(function(o){return o.value===savedLesson;})?savedLesson:'';
    function matches(op){var lesson=getLesson(op.lessonId);return (!classFilter.value||lesson&&lesson.classId===classFilter.value)&&(!lessonFilter.value||op.lessonId===lessonFilter.value)&&(!search||(undoLabel(op)+' '+JSON.stringify(op.audit||{})).toLowerCase().includes(search));}
    function when(at){return at?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'历史记录';}
    function row(op,index,restored){var lesson=getLesson(op.lessonId),cls=lesson&&getClass(lesson.classId),allowed=restored||canUndoAt(index),meta=Object.assign({},op.audit||{}),label=undoLabel(reverseOp(op)),title=meta.lesson||(cls?cls.name+' · 第'+lesson.seq+'次课 · '+(lesson.date||'')+' · '+(lesson.topic||''):'历史课次');if(!meta.delta&&op.effect&&op.effect.length){var effects=op.effect,pointOnly=effects.every(function(e){return e.path.startsWith('point:');}),single=effects.length===1&&['duty','group','first','phone'].includes(effects[0].path);if((pointOnly&&effects.every(function(e){return e.delta===effects[0].delta;}))||single){var d=effects[0].delta*(effects[0].path==='phone'?-1:1);meta.delta=(d>0?'+':'')+d+((pointOnly&&effects.length>1)||(single&&op.i==null)?'/人':'');}}return '<tr class="operation-row"><td title="'+esc(when(op.at))+'">'+esc(when(op.at))+'</td><td>'+esc(meta.source||'课堂记分')+'</td><td title="'+esc(title+'；'+label)+'">'+esc(title)+'</td><td class="log-student" title="'+esc(meta.student||label)+'"><span class="log-no">'+esc(meta.sid||'第'+op.gno+'组')+'</span><b>'+esc(meta.student||op.name||'小组记分')+'</b></td><td class="delta '+(String(meta.delta||'').startsWith('-')?'minus':'plus')+'" title="'+esc(label)+'">'+esc(meta.delta||'—')+'</td><td title="当时的累计原始积分；多人操作按成员顺序排列">'+esc(meta.after||'—')+'</td><td><button class="edit-log-btn '+(restored?'log-restore':'log-undo')+'" '+(restored?'data-redo-index':'data-undo-index')+'="'+index+'" '+(!allowed?'disabled':'')+' title="'+esc((meta.sid==='全组操作'?'整笔全组操作：':'')+(restored?'恢复实际效果':'撤销实际效果'))+'">'+(restored?'恢复':'撤销')+'</button></td></tr>';}
    function table(rows,restored){return '<div class="bubble-audit-scroll"><table class="bubble-audit-table"><thead class="log-table-head"><tr><th>北京时间</th><th>来源</th><th>课次</th><th>学生</th><th>加减分</th><th>操作后总分</th><th>操作</th></tr></thead><tbody>'+rows.map(function(r){return row(r.op,r.index,restored);}).join('')+'</tbody></table></div>';}
    var pending=(S.undo||[]).map(function(op,i){return {op:op,index:i};}).filter(function(r){return matches(r.op);}).reverse(),redo=(S.redo||[]).map(function(e,i){return {op:e.op,index:i};}).filter(function(r){return matches(r.op);}).reverse();
    function entryLesson(e){if(e.lessonId)return getLesson(e.lessonId);var detail=e.detail||'',m=detail.match(/第\s*(\d+)\s*次(?:课)?/),c=S.classes.find(function(c){return detail.startsWith(c.name+' ·');});return c&&m?S.lessons.find(function(l){return l.classId===c.id&&l.seq===+m[1];}):null;}
    function auditRow(e){var l=entryLesson(e),c=l&&getClass(l.classId),meta=e.audit||{},detail=e.detail||'',parts=detail.split(' · '),tail=parts.slice(2).join(' · ')||detail;var source=meta.source||e.kind||'历史记录',title=meta.lesson||(l?c.name+' · 第'+l.seq+'次课 · '+l.date+' · '+(l.topic||''):parts.slice(0,2).join(' · '));return '<tr class="audit-row"><td>'+esc(when(e.at))+'</td><td>'+esc(source)+'</td><td title="'+esc(detail)+'">'+esc(title||'历史记录')+'</td><td class="log-student" title="'+esc(detail)+'"><b>'+esc(meta.student||tail)+'</b></td><td class="delta '+(String(meta.delta||'').startsWith('-')?'minus':'plus')+'">'+esc(meta.delta||'—')+'</td><td>'+esc(meta.after||'—')+'</td><td>'+esc(e.kind==='撤销'?'已撤销':e.kind==='重做'?'已恢复':'核对记录')+'</td></tr>';}
    var entries=(S.operationLog||[]).slice().reverse().filter(function(e){var l=entryLesson(e);return (!classFilter.value||(l?l.classId===classFilter.value:(e.detail||'').startsWith((getClass(classFilter.value)||{}).name+' ·')))&&(!lessonFilter.value||l&&l.id===lessonFilter.value)&&(!search||(e.detail||'').toLowerCase().includes(search));});
    var auditTable=table([],false).replace('<tbody></tbody>','<tbody>'+entries.map(auditRow).join('')+'</tbody>');
    list.innerHTML=(pending.length?table(pending,false):'<div class="log-empty">'+(search||classFilter.value||lessonFilter.value?'没有匹配的记录':'暂无可撤销记分')+'</div>')+'<details class="log-restored"'+(redo.length?' open':'')+'><summary>已撤销，可恢复 <span>'+redo.length+'</span></summary>'+(redo.length?table(redo,true):'<div class="log-empty">暂无已撤销记录</div>')+'</details><details class="log-audit"><summary>完整流水 <span>'+entries.length+'</span></summary>'+auditTable+'</details>';
    var entry=(S.redo || []).slice(-1)[0];
    $('#redoDetail').textContent=entry ? '下一步重做：'+undoLabel(reverseOp(entry.op)) : '暂无可重做操作';
  }

  function fadeLogRow(row) {
    if(!row || window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    var rect=row.getBoundingClientRect(), ghost=row.cloneNode(true);
    ghost.classList.add('log-row-ghost'); ghost.setAttribute('aria-hidden','true');
    ghost.style.cssText='position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;z-index:5;pointer-events:none;';
    $('#dlgOperationLog').appendChild(ghost);
    setTimeout(function(){ghost.remove();},220);
  }

  function renderUndoBtn() {
    var b = $('#btnUndo');
    if (!b) return;
    var n = (S.undo || []).length;
    b.disabled = !n;
    b.textContent = n ? '↶ 撤销' + (n > 1 ? '（' + n + '）' : '') : '↶ 撤销';
    var lastLesson = n && getLesson(S.undo[n - 1].lessonId);
    var lastClass = lastLesson && getClass(lastLesson.classId);
    if (lastClass && lastClass.id !== S.ui.classId) b.textContent = '↶ 撤销其他班操作';
    var detail = $('#undoDetail');
    if (detail) detail.textContent = n ? '下一步撤销：' + undoLabel(S.undo[n-1]) : '暂无可撤销操作';
    var rb = $('#btnRedo'); if(rb) rb.disabled = !(S.redo || []).length;
    renderOperationLog();
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
    if (UI) UI.clear();

    var key = String(op.gno);
    var beforeUndo=JSON.parse(JSON.stringify(l.scores[key]||{}));if(!S.redo)S.redo=[];var actual=applyEffect(op,operationEffect(op),-1);var undoChanged=actual.length>0;S.redo.push({op:JSON.parse(JSON.stringify(op)),redoEffect:actual.map(function(e){return {path:e.path,delta:-e.delta,wasBlank:e.wasBlank};})});

    var cls = getClass(l.classId);
    var sameView = cls && S.ui.classId === l.classId && S.ui.lessonId === l.id;
    if (cls) { S.ui.classId = l.classId; S.ui.lessonId = l.id; }
    addOperationLog('撤销',undoLabel(op));
    save(false);
    renderUndoBtn();

    if(op.projectBatch)renderLeader();
    if (sameView) { refreshCard(cls, l, op.gno); renderMetrics(cls, l); }
    else { renderScore(); }

    flash('已撤销：' + undoLabel(op));
    if (UI && undoChanged) UI.feedback(op.gno, op.reset ? null : op.f, op.i, 0, '已撤销：' + undoLabel(op), true);
    return true;
  }

  /** 顶栏那句小字兼做提示条 */
  function flash(msg, quiet) {
    var el = $('#saveState');
    el.textContent = msg;
    el.classList.add('flash');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      el.classList.remove('flash');
      var d = new Date();
      el.textContent = '已自动保存到本机 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    }, 2600);

    if (!quiet) toast(msg);
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
    if (UI) UI.pill();
  }

  /* ================= 视图切换 ================= */

  var attendanceContext = null;
  var view = 'score';

  function switchView(v) {
    groupPicking=null;
    if(view==='attendance' && v!=='attendance' && attendanceContext && attendanceContext.isDirty && attendanceContext.isDirty()){flash('请先保存本课考勤，再切换页面。');return;}
    if (v === 'admin' && !(CLOUD && CLOUD.profile() && CLOUD.profile().isAdmin)) v = 'score';
    view = v;
    ['score', 'leader', 'rank', 'attendance', 'pool', 'data', 'admin'].forEach(function (k) {
      var el = $('#view-' + k);
      if (el) el.hidden = (k !== v);
    });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (UI) UI.setView(v);
    if (v === 'rank') renderRank();
    if (v === 'pool') renderPool();
    if (v === 'data') renderData();
    if (v === 'admin') renderAdmin();
    if (v === 'score') renderScore();
    if (v === 'leader') renderLeader();
    if (v === 'attendance') renderAttendance();
  }

  function renderAttendance() {
    var cls=curClass(); if(!cls || !window.JFDT_ASSESSMENT)return;
    if(!$('#view-attendance')){var section=document.createElement('section');section.id='view-attendance';section.className='view';$('#main').appendChild(section);}
    $('#view-attendance').hidden=false;
    attendanceContext={root:$('#view-attendance'),cls:cls,classes:S.classes,lessons:lessonsOf(cls.id),lesson:curLesson(cls),raw:memberTotals(cls),save:function(){save();},log:addOperationLog,message:function(text){flash(text);},select:function(classId,lessonId){S.ui.classId=classId;S.ui.lessonId=lessonId;save(false);fillClassSelects();renderAttendance();}};
    window.JFDT_ASSESSMENT.renderAttendance(attendanceContext);
  }

  function renderLeader() {
    if (!$('#view-leader')) {
      var section = document.createElement('section');
      section.id = 'view-leader'; section.className = 'view';
      $('#main').appendChild(section);
    }
    if (window.JFDT_LEADER_RENDER) window.JFDT_LEADER_RENDER({
      root: $('#view-leader'), state: S,
      save: function () { save(); var cls=curClass(),lesson=curLesson(cls);if(lesson)renderGroups(cls,lesson); },
      log: function(detail) { addOperationLog('个人项目评分',detail); },
      fullMarks:function(lesson,groups,columns,names){var cls=getClass(lesson.classId),changed=0;if(!lesson.leaderScores)lesson.leaderScores={};groups.forEach(function(g){var r=lesson.leaderScores[String(g.no)]||(lesson.leaderScores[String(g.no)]={projects:names.slice(),members:{},signedBy:'',note:''}),effect=[];g.members.filter(function(m){return m.name;}).forEach(function(m){var key=m.sid?'sid:'+m.sid:'id:'+m.id,values=r.members[key]||(r.members[key]=[]);columns.forEach(function(i){var old=values[i];if(old===5)return;effect.push({path:'leader:'+key+'|'+i,delta:5-(Number(old)||0),wasBlank:old==null});values[i]=5;changed++;});});if(!effect.length)return;var totals=memberTotals(cls);pushUndo({lessonId:lesson.id,gno:g.no,projectBatch:true,projectNames:names.slice(),effect:effect,audit:{source:'项目批量满分',lesson:cls.name+' · 第'+lesson.seq+'次课 · '+lesson.date+' · '+(lesson.topic||''),student:'第'+g.no+'组全员，'+columns.length+'项各5分',sid:'全组操作',delta:'+'+effect.reduce(function(a,e){return a+e.delta;},0)+'（全组合计）',after:g.members.filter(function(m){return m.name;}).map(function(m){var t=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===g.no&&t.name===m.name;});return t?t.total:'—';}).join(' / ')}});});save();renderGroups(cls,lesson);flash(changed?'已将'+changed+'个项目成绩填为5分':'所选项目已全部满分，无需修改');},

      select: function (classId, lessonId) {
        S.ui.classId = classId; S.ui.lessonId = lessonId;
        fillClassSelects(); save(false); renderLeader();
      },
      openScore: function () { switchView('score'); }
      ,openGroups: function () { switchView('pool'); }
    });
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
    $('#rosterSetupHint').hidden = !!(rosterOf(cls).length || cls.groups.some(function (g) { return memberCount(g) > 0; }));

    var ls = lessonsOf(cls.id);
    var sel = $('#lessonSel');
    sel.innerHTML = ls.map(function (l) {
      return '<option value="' + l.id + '">第 ' + l.seq + ' 次课 · ' + esc(l.date || '') + '</option>';
    }).join('') || '<option value="">暂无课次</option>';
    var lesson = curLesson(cls);
    if (lesson) sel.value = lesson.id;
    sel.disabled = !ls.length;
    renderUndoBtn();

    $('#noLessonHint').hidden = !!lesson;
    $('#lessonMeta').hidden = !lesson;
    $('#scoreMetrics').hidden = !lesson;
    $('#scoreHint').hidden = !lesson;
    $('#groupList').hidden = !lesson;

    if (!lesson) { $('#lessonMeta').innerHTML = ''; $('#groupList').innerHTML = ''; return; }

    renderLessonMeta(cls, lesson);
    renderGroups(cls, lesson);
    renderMetrics(cls, lesson);
    if (UI) UI.pill();
  }

  function renderLessonMeta(cls, lesson) {
    var dutyOpts = '<option value="">无</option>' + cls.groups.map(function (g) {
      return '<option value="' + g.no + '"' + (+lesson.dutyGroup === g.no ? ' selected' : '') +
        '>第 ' + g.no + ' 组</option>';
    }).join('');
    $('#lessonMeta').innerHTML='<div class="lesson-topic-summary" title="'+esc(lesson.topic||'未填写任务')+'">'+esc(lesson.topic||'未填写任务')+'</div>'+(dutyGroups(lesson).length?'<small class="lesson-duty-summary">值日：'+dutyGroups(lesson).map(function(n){return '第'+n+'组';}).join('、')+'</small>':'')+'<div class="btnrow"><button class="btn" id="btnEditLesson">课次设置</button><button class="btn" id="btnPrintLesson">打印本课</button></div>';
    $('#btnEditLesson').addEventListener('click',function(){openLessonEditor(cls,lesson);});
    $('#btnPrintLesson').addEventListener('click', function () { openLessonPrint(cls, lesson); });
    var excelButton=document.createElement('button');excelButton.className='btn';excelButton.textContent='下载本课Excel';excelButton.onclick=function(){downloadLessonExcel(cls,lesson);};$('#lessonMeta .btnrow').appendChild(excelButton);
    var pdfButton=document.createElement('button');pdfButton.className='btn';pdfButton.textContent='下载打印版PDF';pdfButton.onclick=function(){openLessonPrint(cls,lesson,true);};$('#lessonMeta .btnrow').prepend(pdfButton);
  }

  var lessonEditor=document.createElement('dialog');lessonEditor.id='dlgEditLesson';lessonEditor.setAttribute('aria-labelledby','editLessonTitle');
  lessonEditor.innerHTML='<form id="editLessonForm"><h2 id="editLessonTitle">修改课次</h2><p class="note">更正课次资料，保留本课分数、项目评价和考勤。日期不参与计分。</p><label class="field col">课次序号<input id="editLessonSeq" type="number" min="1" step="1" required></label><label class="field col">上课日期<input id="editLessonDate" type="date" required></label><label class="field col">本节任务<input id="editLessonTopic" maxlength="300"></label><label class="field col">值日组<select id="editLessonDuty" multiple size="4"></select></label><p id="editLessonError" role="alert" class="note"></p><div class="btnrow"><button type="button" class="btn" id="cancelEditLesson">取消</button><button type="submit" class="btn primary">保存修改</button></div></form>';
  document.body.appendChild(lessonEditor);wireDialog(lessonEditor);var editingLessonId=null;
  function openLessonEditor(cls,lesson){editingLessonId=lesson.id;$('#editLessonTitle').textContent=cls.name+' · 修改课次';$('#editLessonSeq').value=lesson.seq;$('#editLessonDate').value=lesson.date||'';$('#editLessonTopic').value=lesson.topic||'';$('#editLessonDuty').innerHTML='<option value="">无</option>'+cls.groups.map(function(g){return '<option value="'+g.no+'"'+(dutyGroups(lesson).includes(g.no)?' selected':'')+'>第'+g.no+'组</option>';}).join('');$('#editLessonError').textContent='';openDlg(lessonEditor);}
  $('#cancelEditLesson').addEventListener('click',function(){lessonEditor.close();});
  $('#editLessonForm').addEventListener('submit',function(e){e.preventDefault();var lesson=getLesson(editingLessonId);if(!lesson)return;var seq=Number($('#editLessonSeq').value),date=$('#editLessonDate').value,topic=$('#editLessonTopic').value.trim(),duties=Array.from($('#editLessonDuty').selectedOptions).map(function(o){return Number(o.value);}).filter(Boolean),duty=duties[0]||null;if(!Number.isInteger(seq)||seq<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)){$('#editLessonError').textContent='请填写有效的课次序号和日期。';return;}if(S.lessons.some(function(l){return l.classId===lesson.classId&&l.id!==lesson.id&&l.seq===seq;})){$('#editLessonError').textContent='本班已有第 '+seq+' 次课，请使用其他序号。';return;}var before='第'+lesson.seq+'次 · '+lesson.date+' · '+(lesson.topic||'未填任务');if(lesson.seq===seq&&lesson.date===date&&(lesson.topic||'')===topic&&JSON.stringify(dutyGroups(lesson))===JSON.stringify(duties)){lessonEditor.close();return;}lesson.seq=seq;lesson.date=date;lesson.topic=topic;lesson.dutyGroup=duty;lesson.dutyGroups=duties;var cls=S.classes.find(function(c){return c.id===lesson.classId;});addOperationLog('修改课次',cls.name+' · '+before+' → 第'+seq+'次 · '+date+' · '+(topic||'未填任务'));save();lessonEditor.close();renderScore();flash('课次资料已修改，分数和考勤已保留');});

  /* ---- 记分控件（卡片视图与表格视图共用，保证两边的操作完全一致） ---- */

  /** 某个计分项在本组的上限 */
  function maxOf(f, maxPhone) {
    return f === 'group' ? 5 : f === 'duty' ? 5 : f === 'phone' ? maxPhone : 99;
  }

  function ctlFirst(gno, s) {
    return '<button class="toggle' + (s.first ? ' on' : '') + '" data-g="' + gno + '" data-act="first" aria-label="第'+gno+'组首个正确，加1分" aria-pressed="'+!!s.first+'">' +
      '✓</button>';
  }

  /** ± 步进 + 可直接输入的数字框 */
  function ctlStep(gno, f, s, max, hint) {
    var v = +s[f] || 0;
    var neg = (f === 'phone' || f === 'personal') && v > 0;
    return '<div class="step">' +
      '<button data-g="' + gno + '" data-act="d" data-f="' + f + '" data-max="' + max + '" title="' + (f === 'phone' ? '减少扣分次数，返还1分' : '减 1') + '">−</button>' +
      '<input class="num' + (neg ? ' neg' : '') + '" data-g="' + gno + '" data-f="' + f + '" data-max="' + max +
        '" size="1" inputmode="numeric" value="' + v + '" title="' + hint + '：可以直接点进来输数字（0-' + max + '）">' +
      '<button data-g="' + gno + '" data-act="i" data-f="' + f + '" data-max="' + max + '" title="' + (f === 'phone' ? '增加扣分次数，扣1分' : '加 1') + '">+</button>' +
    '</div>';
  }

  function ctlDuty(gno,s,count) {
    var record=s.dutyParticipation,expected=record?record.expected:count;
    if(!expected)return '<span class="note">先录入小组成员</span>';
    return '<button type="button" class="duty-score" data-duty-open="'+gno+'" aria-label="第'+gno+'组值日 '+fmt(+s.duty||0)+'分，点击选择参与人数">'+fmt(+s.duty||0)+'</button>';

  }

  function semesterBadge(cls,gno,index) {
    return '';
  }

  function lessonMemberTotals(cls,lesson,g){var s=sc(lesson,g.no),net=window.JFDT_ASSESSMENT.groupNet(lesson,g.no,lessonsOf(cls.id)),base=Math.max(0,Math.min(5,(+s.group||0)+(s.first?1:0))-(+s.phone||0)),duty=net-base;return '<div data-member-lesson-totals="'+g.no+'">'+g.members.map(function(m,i){if(!m.name)return '';var value=Math.round((remaining(lesson,g.no,i)+projectScore(lesson,g.no,m)+duty)*100)/100;return '<div class="home-grade-person" data-lesson-member="'+i+'"><span class="home-grade-name">'+(i+1)+'</span><strong>'+value+'</strong></div>';}).join('')+'</div>';}
  function ctlSum(gno, total, cumVal) {
    return '<div hidden class="legacy-group-total v '+signClass(total)+'" data-total="'+gno+'">'+fmt(total)+'</div>'+lessonMemberTotals(curClass(),curLesson(curClass()),groupOf(curClass(),gno));

  }

  function attendanceCell(cls,lesson,g,printing){var A=window.JFDT_ASSESSMENT,rows=A.rows(cls,lessonsOf(cls.id),memberTotals(cls));return '<td rowspan="2" class="home-attendance">'+g.members.filter(function(m){return !!m.name;}).map(function(m,i){var k=A.key(m),row=rows.find(function(r){return r.key===k;}),score=row?row.attendance:9;return '<div class="home-attendance-person compact"><span>'+(i+1)+'</span>'+(printing?'<strong>'+score+'</strong>':'<button type="button" class="attendance-score" data-attendance-open="'+esc(k)+'" aria-label="成员'+(i+1)+' '+esc(m.name)+' 考勤'+score+'分，点击修改">'+score+'</button>')+'</div>';}).join('')+'</td>';}
  var attendanceDialog=document.createElement('dialog');attendanceDialog.id='dlgHomeAttendance';attendanceDialog.setAttribute('aria-labelledby','homeAttendanceTitle');attendanceDialog.innerHTML='<form id="homeAttendanceForm"><h2 id="homeAttendanceTitle">考勤</h2><label class="field col">本课状态<select id="homeAttendanceStatus"></select></label><label class="field col">本次扣分<input id="homeAttendanceLoss" type="number" min="0" max="100" step="1" required></label><p class="note">扣分只影响考勤分；迟到早退折算仅用于挂科标记，不再次扣分。</p><button type="button" class="linkbtn" id="homeAttendanceRules">考勤扣分与挂科设置</button><div class="btnrow"><button type="button" class="btn" id="cancelHomeAttendance">取消</button><button class="btn primary" type="submit">保存</button></div></form>';document.body.appendChild(attendanceDialog);wireDialog(attendanceDialog);var attendanceEdit=null;
  $('#groupList').addEventListener('click',function(e){var button=e.target.closest('[data-attendance-open]');if(!button)return;var cls=curClass(),lesson=curLesson(cls),A=window.JFDT_ASSESSMENT;if(!lesson)return;var key=button.dataset.attendanceOpen,member=A.roster(cls,memberTotals(cls)).find(function(m){return m.key===key;}),cfg=A.settings(cls),record=lesson.attendance&&lesson.attendance[key],opts=[['present','到课'],['leave','请假'],['truant','旷课'],['late','迟到'],['early','早退']].concat(cfg.customRules.map(function(r){return [r.id,r.name];}));if(record&&!opts.some(function(o){return o[0]===record.status;}))opts.push([record.status,record.label]);attendanceEdit={key:key,lessonId:lesson.id,classId:cls.id};$('#homeAttendanceTitle').textContent=member.name+' · 第'+lesson.seq+'次课';$('#homeAttendanceStatus').innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'"'+((record?record.status:'present')===o[0]?' selected':'')+'>'+esc(o[1])+'</option>';}).join('');$('#homeAttendanceLoss').value=record?record.loss:0;$('#homeAttendanceLoss').disabled=!record;openDlg(attendanceDialog);});
  $('#homeAttendanceStatus').addEventListener('change',function(){var cls=curClass();$('#homeAttendanceLoss').disabled=!this.value;$('#homeAttendanceLoss').value=this.value?window.JFDT_ASSESSMENT.deduction(this.value,window.JFDT_ASSESSMENT.settings(cls)):0;});
  $('#cancelHomeAttendance').addEventListener('click',function(){attendanceDialog.close();});
  $('#homeAttendanceRules').addEventListener('click',function(){attendanceDialog.close();switchView('attendance');var settings=$('.assessment-settings');if(settings)settings.open=true;});
  $('#homeAttendanceForm').addEventListener('submit',function(e){e.preventDefault();var edit=attendanceEdit,cls=curClass(),lesson=curLesson(cls),A=window.JFDT_ASSESSMENT;if(!edit||!lesson||edit.lessonId!==lesson.id||edit.classId!==cls.id)return;var status=$('#homeAttendanceStatus').value,loss=Number($('#homeAttendanceLoss').value);if(!Number.isInteger(loss)||loss<0||loss>100)return;var old=lesson.attendance&&lesson.attendance[edit.key];if((old?old.status:'present')===status&&(!old?loss===0:old.loss===loss)){attendanceDialog.close();return;}var option=$('#homeAttendanceStatus').selectedOptions[0],member=A.roster(cls,memberTotals(cls)).find(function(m){return m.key===edit.key;});if(!lesson.attendance)lesson.attendance={};if(status)lesson.attendance[edit.key]={status:status,label:option.textContent,loss:loss,updatedAt:new Date().toISOString()};else delete lesson.attendance[edit.key];addOperationLog('考勤',cls.name+' · 第'+lesson.seq+'次 · '+member.name+'：'+(old?old.label+' 扣'+old.loss:'默认到课')+' → '+(status?option.textContent+' 扣'+loss:'默认到课'));save();attendanceDialog.close();renderGroups(cls,lesson);flash('考勤已保存');});
  function attendanceNameClass(cls,m){var A=window.JFDT_ASSESSMENT,r=A.rows(cls,lessonsOf(cls.id),memberTotals(cls)).find(function(r){return r.key===A.key(m);});return r&&r.attendanceFailed?' attendance-failed':'';}

  function homeGradeHead(){return '<th rowspan="2" class="home-grade regular">平时分<br>（至今完成率）</th><th rowspan="2" class="home-grade contribution">计入总评<br>/40</th><th rowspan="2" class="home-grade needed">期末至少需考<br>/100</th>';}
  function homeGradeCells(cls,g){
    var A=window.JFDT_ASSESSMENT;if(!A)return '<td rowspan="2" colspan="3">成绩模块未加载</td>';
    var rows=A.rows(cls,lessonsOf(cls.id),memberTotals(cls));
    var members=g.members.filter(function(m){return !!m.name;}).map(function(m,i){return {member:m,index:i+1,row:rows.find(function(r){return r.key===A.key(m);})};});
    return ['regular','contribution','needed'].map(function(field){return '<td rowspan="2" class="home-grade '+field+'" data-home-grade="'+field+'">'+members.map(function(item){var m=item.member,r=item.row;if(!r)return '';var value=field==='needed'?(r.attendanceFailed?'不适用':r.needed>100?'无法达到':r.needed):r[field];return '<div class="home-grade-person" data-grade-student="'+esc(r.key)+'" title="'+esc(m.name)+'：'+(r.ready?'记录已齐':'预估，项目或考勤记录未齐')+'"><span class="home-grade-name">'+item.index+'</span><strong>'+value+(field==='regular'?' <span class="completion-rate">（'+(r.task.maximum?Math.round(r.task.rate*1000)/10+'%':'—')+'）</span>':'')+'</strong>'+(r.attendanceFailed?'<small>考勤挂科</small>':'')+'</div>';}).join('')+'</td>';}).join('');
  }

  /** 个人扣分格：点一次 +1；右键 / 长按 −1 */
  function remaining(lesson,gno,i){var s=sc(lesson,gno);return Math.max(0,Math.min(5,(+s.group||0)+(s.first?1:0))-(+s.phone||0)-(+s.personal[String(i)]||0));}
  function ctlBatch(gno){return '<button class="btn" data-g="'+gno+'" data-act="batch-deduct">全组 −1</button>';}
  function ctlPersonal(gno, m, i, n, fullName) {
    n=remaining(curLesson(curClass()),gno,i);
    var attrs = ' data-g="' + gno + '" data-i="' + i + '"';
    return '<span class="personal-control"><button class="pchip' + (n<5 ? ' hit' : '') + '"' + attrs + ' data-act="p" title="' + esc(m.name) + '：点击扣1分">' +
      (fullName ? '<span class="pname">' + esc(m.name) + '</span>' : '') + '<span class="n">' + n + '</span><span class="deduct-action" aria-hidden="true">−</span></button>' +
      '<button class="personal-refund"' + attrs + ' data-act="pr" title="' + esc(m.name) + '：恢复项目1分">+</button>' +
      '<button class="personal-reset"' + attrs + ' data-act="pz" title="' + esc(m.name) + '：清空个人扣分">清零</button></span>';
  }

  function ctlClear(gno, compact) {
    return '<button class="mini" data-cleargroup="' + gno + '" type="button" title="把本组这节课的分数全部归零">' +
      (compact ? '↺' : '↺ 清零') + '</button>';
  }

  var groupPicking = null;
  function mountGroupPicker(cls,lesson){
    if(groupPicking&&(groupPicking.classId!==cls.id||groupPicking.lessonId!==lesson.id))groupPicking=null;
    cls.groups.forEach(function(g){
      var card=$('[data-card="'+g.no+'"]');if(!card)return;
      var unlocked=groupPicking&&groupPicking.no===g.no;
      var lock=document.createElement('button');lock.type='button';lock.className='btn tiny group-pick-lock';lock.textContent=unlocked?'✓':'🔒';lock.title=unlocked?'完成分组':'解锁分组';lock.setAttribute('aria-label','第'+g.no+'组'+lock.title);
      var target=scoreLayout==='table'?card.querySelector('.c-no'):card.querySelector('.group-identity');target.appendChild(lock);
      lock.onclick=function(e){e.stopPropagation();groupPicking=unlocked?null:{classId:cls.id,lessonId:lesson.id,no:g.no};renderGroups(cls,lesson);};
      if(!unlocked)return;
      var slot=scoreLayout==='table'?Array.from(card.querySelectorAll('.gname td.c-mem')).find(function(el,i){return !g.members[i]||!g.members[i].name;}):card.querySelector('.gnames');
      if(!slot){lock.title='本组已满6人，请到名单与分组调整';return;}
      var box=document.createElement('div');box.className='group-pick-box';box.innerHTML='<button type="button" class="btn tiny" data-pick-add aria-label="第'+g.no+'组新增成员">＋</button><div data-pick-editor hidden><input type="search" autocomplete="off" aria-label="第'+g.no+'组检索学号" placeholder="学号或后两位"><div class="group-pick-results" role="list"></div><button type="button" class="btn tiny" data-pick-exit>退出选人</button></div>';slot.appendChild(box);
      var editor=box.querySelector('[data-pick-editor]'),input=box.querySelector('input'),results=box.querySelector('.group-pick-results');
      function matches(){var query=input.value.trim().toLowerCase(),pending=pendingList(cls),list=pending.filter(function(r){return !query||String(r.sid||'').includes(query)||r.name.toLowerCase().includes(query);});results.innerHTML='';if(!list.length){results.textContent='没有匹配的待分配成员';return;}list.forEach(function(r){var button=document.createElement('button');button.type='button';button.className='btn tiny';button.textContent=r.name+' '+(r.sid||'');button.setAttribute('data-pick-sid',r.sid||'');button.onclick=function(e){e.stopPropagation();if(!groupPicking||groupPicking.no!==g.no||curClass().id!==cls.id)return;if(memberCount(g)>=GROUP_CAP){flash('本组已满6人');return;}if(!pendingList(cls).some(function(p){return p===r;})){matches();return;}pushMember(g,{id:uid('m'),name:r.name,sid:r.sid||'',no:studentNo(cls,r.name,r.sid)});addOperationLog('分组',cls.name+' · '+r.name+'加入第'+g.no+'组');save();renderScore();renderPoolBanner(cls);flash('已加入第'+g.no+'组，分组已全局同步');};results.appendChild(button);});}
      box.onclick=function(e){e.stopPropagation();};box.querySelector('[data-pick-add]').onclick=function(){editor.hidden=false;this.hidden=true;matches();input.focus();};input.oninput=matches;box.querySelector('[data-pick-exit]').onclick=function(){groupPicking=null;renderGroups(cls,lesson);};
    });
  }
  function renderGroups(cls, lesson) {
    var host = $('#groupList');
    host.innerHTML = scoreLayout === 'table'
      ? groupsTable(cls, lesson)
      : groupsCards(cls, lesson);
    mountGroupPicker(cls,lesson);
  }

  function groupsCards(cls, lesson) {
    return '<div class="groups">' + cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var total = groupTotal(lesson, g.no);
      var duty = dutyGroups(lesson).includes(g.no);
      var cnt = memberCount(g);
      var maxPhone = 1000000;
      var names = cnt
        ? g.members.slice(0, cnt).map(function (m,i) { return '<span class="member-name'+attendanceNameClass(cls,m)+'">' + esc(m.name) + semesterBadge(cls,g.no,i) + '</span>'; }).join('')
        : '<span style="color:var(--muted);font-weight:400">（未录入名单）</span>';

      var personal = cnt
        ? '<div class="personals"><span class="plabel">本节小组项目分 <small>0–5分</small></span>' +
          g.members.slice(0, cnt).map(function (m, i) {
            return ctlPersonal(g.no, m, i, +s.personal[String(i)] || 0, true);
          }).join('') + '</div>'
        : '';

      return '' +
      '<div class="gcard' + (duty ? ' is-duty' : '') + (touched(lesson, g.no) ? ' touched' : '') + '" data-card="' + g.no + '">' +
        '<div class="gcard-head">' +
          '<div class="group-identity"><span class="gnum">第 ' + g.no + ' 组</span>' +
            (duty ? '<span class="dutytag">值日</span>' : '') + '</div>' +
          '<div class="gsum"><span class="k">本节</span>' +
            '<div class="v ' + signClass(total) + '" data-total="' + g.no + '">' + fmt(total) + '</div></div>' +
        '</div>' +
        '<div class="gnames">' + names + '</div>' +
        '<div class="gcard-secondary"><span class="card-feedback-space" aria-hidden="true"></span>' + ctlClear(g.no, false) + '</div>' +
        '<div class="gctl">' +
          '<div>' +
            '<div class="lbl legacy-group-control">小组项目原分</div>' +
            ctlStep(g.no, 'group', s, maxOf('group', maxPhone), '小组分') +
          '</div>' +
          '<div>' +
            '<div class="lbl" title="手机未入袋：增加次数即扣分，每次扣1分">全组扣分</div><div class="deduction-note">每次 −1 分</div>' +
            ctlBatch(g.no) +
          '</div>' +
          '<div>' +
            '<div class="lbl">值日分</div>' +
            ctlDuty(g.no,s,cnt) +
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
    cols += '<col class="w-attendance"><col class="w-phone"><col class="w-grp">' +
      '<col class="w-duty"><col class="w-sum"><col class="w-grade"><col class="w-grade"><col class="w-grade">';

    var sub = '';
    for (var k = 0; k < GROUP_CAP; k++) sub += '<th class="c-mem">成员' + (k + 1) + '</th>';

    var head = '<thead>' +
      '<tr>' +
        '<th class="c-no" rowspan="2">组<br>号</th>' +
        '<th class="c-mem" colspan="' + GROUP_CAP + '">小组成员姓名 / 本节项目分（0–5）</th>' +
        '<th class="home-attendance" rowspan="2">考勤分<br>/9</th><th class="c-phone" rowspan="2">全组扣分<br>（每人扣1）</th>' +
        '<th class="c-grp" rowspan="2">全组·小组分<br>(0-5)</th>' +
        '<th class="c-duty" rowspan="2">全组·值日<br>(0-5)</th>' +
        '<th class="c-sum" rowspan="2">本节<br>合计</th>'+homeGradeHead() +
      '</tr><tr>' + sub + '</tr>' +
    '</thead>';

    var body = cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var duty = dutyGroups(lesson).includes(g.no);
      var cnt = memberCount(g);
      var maxPhone = 1000000;
      var names = '', deds = '';

      for (var i = 0; i < GROUP_CAP; i++) {
        var m = g.members[i];
        names += '<td class="c-mem'+(m&&m.name?attendanceNameClass(cls,m):'')+'">' + ((m && m.name)
          ? esc(m.name) + (m.no == null ? '' : ' ' + two(m.no)) + semesterBadge(cls,g.no,i) : '') + '</td>';
        deds += '<td class="c-ded">' + (i < cnt ? ctlPersonal(g.no, m, i, +s.personal[String(i)] || 0) : '') + '</td>';
      }

      return '<tbody class="' + (duty ? 'is-duty ' : '') + (touched(lesson, g.no) ? 'touched' : '') +
          '" data-card="' + g.no + '">' +
        '<tr class="gname">' +
          '<td class="c-no" rowspan="2">' + g.no + '</td>' +
          names + attendanceCell(cls,lesson,g,false) +
          '<td class="c-phone" rowspan="2">' + ctlBatch(g.no) + '</td>' +
          '<td class="c-grp" rowspan="2">' + ctlStep(g.no, 'group', s, maxOf('group', maxPhone), '小组分') + '</td>' +
          '<td class="c-duty" rowspan="2">' + ctlDuty(g.no,s,cnt) + '</td>' +
          '<td class="c-sum" rowspan="2">' + ctlSum(g.no, groupTotal(lesson, g.no), groupCumThrough(cls, g.no, lesson)) +
            ctlClear(g.no, true) + '</td>' + homeGradeCells(cls,g) +
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
    var leaders = ranked.filter(function (r) { return r.t === lead.t; });
    var allZero = ranked.every(function (r) { return r.t === 0; });
    var bestCount = best ? cls.groups.filter(function(g){ return groupTotal(lesson,g.no) === best.t; }).length : 0;
    var leadText = allZero ? '暂无领先' : leaders.length > 1
      ? '并列领先 <small>' + (leaders.length <= 3 ? leaders.map(function(r){return '第' + r.no + '组';}).join('、') : leaders.length + '个小组') + ' · ' + fmt(lead.t) + '</small>'
      : '第 ' + lead.no + ' 组 <small>' + fmt(lead.t) + '</small>';

    $('#scoreMetrics').innerHTML =
      '<div class="metric"><div class="k">已记分小组</div><div class="v">' + done +
        ' <small>/ ' + cls.groups.length + ' 组</small></div></div>' +
      '<div class="metric"><div class="k">本节最高</div><div class="v ' + signClass(best ? best.t : 0) + '">' +
        (best && done ? fmt(best.t) + ' <small>' + (bestCount > 1 ? bestCount + '组并列' : '第 ' + best.no + ' 组') + '</small>' : '—') + '</div></div>' +
      '<div class="metric"><div class="k">累计领先</div><div class="v' + (allZero ? '' : ' good') + '">' + leadText + '</div></div>' +
      '<div class="metric"><div class="k">已记录课次</div><div class="v">' + ls.length + ' <small>次</small></div></div>';
  }

  function refreshCard(cls, lesson, gno) {
    var card = $('[data-card="' + gno + '"]');
    if (!card) return;
    var s = sc(lesson, gno);
    var t = groupTotal(lesson, gno);
    var v = $('[data-total="' + gno + '"]', card);
    v.textContent = fmt(t);
    v.className = 'legacy-group-total v ' + signClass(t);var memberTotalsEl=$('[data-member-lesson-totals]',card);if(memberTotalsEl)memberTotalsEl.outerHTML=lessonMemberTotals(cls,lesson,groupOf(cls,gno));var gradeCells=$$('[data-home-grade]',card);if(gradeCells.length){var holder=document.createElement('tr');holder.innerHTML=homeGradeCells(cls,groupOf(cls,gno));gradeCells.forEach(function(cell,i){cell.innerHTML=holder.children[i].innerHTML;});}
    
    var totals=memberTotals(cls);
    $$('[data-semester-group]',card).forEach(function(el){var member=cls.groups.find(function(g){return g.no===gno;}).members[+el.dataset.semesterIndex];var total=totals.find(function(m){return m.gno===gno && m.name===member.name && m.sid===member.sid;});el.querySelector('b').textContent=fmt(total?total.total:0);});
    var duty=$('[data-duty-open]',card);if(duty)duty.outerHTML=ctlDuty(gno,s,memberCount(groupOf(cls,gno)));
    card.classList.toggle('touched', touched(lesson, gno));
    $$('.num', card).forEach(function (inp) {
      var f = inp.dataset.f;
      inp.value = (+s[f] || 0);
      if (f === 'phone') inp.classList.toggle('neg', (+s.phone || 0) > 0);
    });
    var tg = $('[data-act="first"]', card);
    if(tg){tg.classList.toggle('on', !!s.first);tg.textContent='✓';tg.setAttribute('aria-pressed',String(!!s.first));}
    $$('.pchip', card).forEach(function (c) {
      var n = remaining(lesson,gno,c.dataset.i);
      c.classList.toggle('hit', n<5);
      $('.n', c).textContent = n;
    });
  }

  // A single editor keeps conversion and participation metadata out of the sheet.
  var dutyDialog=document.createElement('dialog');dutyDialog.id='dlgDutyPeople';
  dutyDialog.innerHTML='<form method="dialog"><h2 id="dutyPeopleTitle">值日人数</h2><label class="field col">参与人数<select id="dutyPeopleSelect" autofocus></select></label><details><summary>调整应到人数</summary><label class="field col">应到人数<input id="dutyExpectedInput" type="number" min="1" max="99" step="1" required></label></details><p class="note">确认后自动填入值日分。</p><div class="btnrow"><button class="btn" value="cancel" formnovalidate>取消</button><button class="btn primary" value="ok">确定</button></div></form>';
  document.body.appendChild(dutyDialog);wireDialog(dutyDialog);
  var dutyEditing=null;
  function dutyChoices(expected,selected){$('#dutyPeopleSelect').innerHTML=Array.from({length:expected+1},function(_,i){return '<option value="'+i+'"'+(i===selected?' selected':'')+'>'+i+' 人</option>';}).join('');}
  $('#dutyExpectedInput').addEventListener('input',function(){var n=Number(this.value);if(Number.isInteger(n)&&n>0&&n<=99)dutyChoices(n,Math.min(n,Number($('#dutyPeopleSelect').value)||0));});
  $('#groupList').addEventListener('click',function(e){var button=e.target.closest('[data-duty-open]');if(!button)return;var cls=curClass(),lesson=curLesson(cls);if(!lesson)return;var gno=Number(button.dataset.dutyOpen),state=sc(lesson,gno),count=memberCount(groupOf(cls,gno)),record=state.dutyParticipation;dutyEditing={classId:cls.id,lessonId:lesson.id,gno:gno};var expected=record?record.expected:count;$('#dutyPeopleTitle').textContent='第 '+gno+' 组 · 值日人数';$('#dutyExpectedInput').value=expected;dutyChoices(expected,record?record.present:0);dutyDialog.returnValue='';openDlg(dutyDialog);});
  dutyDialog.addEventListener('close',function(){if(dutyDialog.returnValue!=='ok'||!dutyEditing)return;var cls=curClass(),lesson=curLesson(cls),edit=dutyEditing;dutyEditing=null;if(!lesson||lesson.id!==edit.lessonId||cls.id!==edit.classId)return;var present=Number($('#dutyPeopleSelect').value),expected=Number($('#dutyExpectedInput').value);if(!Number.isInteger(expected)||expected<1||expected>99||!Number.isInteger(present)||present<0||present>expected)return;var s=sc(lesson,edit.gno),oldMeta=s.dutyParticipation?JSON.parse(JSON.stringify(s.dutyParticipation)):null,old=+s.duty||0,next=Math.round(500*present/expected)/100;if(oldMeta&&oldMeta.present===present&&oldMeta.expected===expected)return;s.dutyParticipation={present:present,expected:expected};s.duty=next;pushUndo({lessonId:lesson.id,gno:edit.gno,f:'duty',old:old,neu:next,oldDutyMeta:oldMeta,neuDutyMeta:{present:present,expected:expected}});save();refreshCard(cls,lesson,edit.gno);renderMetrics(cls,lesson);if(next!==old)scoreFeedback(edit.gno,'duty',null,next-old);});

  /* ================= 记分交互（事件委托） ================= */

  $('#groupList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +btn.dataset.g;
    var s = sc(lesson, gno);
    var act = btn.dataset.act;
    if(act==='batch-deduct'){changeMemberPoints(cls,lesson,gno,null,-1);return;}
    if (act === 'pr' || act === 'pz') {
      var chip = btn.parentElement.querySelector('.pchip');
      if (act === 'pr') bumpPersonal(cls, lesson, chip, -1);
      else setPersonal(cls, lesson, chip, 0);
      return;
    }

    if (act === 'first') {
      var oldF = s.first ? 1 : 0, newF = oldF ? 0 : 1;
      s.first = newF;
      pushUndo({ lessonId: lesson.id, gno: gno, f: 'first', old: oldF, neu: newF });
    } else if (act === 'i' || act === 'd') {
      var f = btn.dataset.f;
      var max = btn.dataset.max ? +btn.dataset.max : maxOf(f, 99);
      var oldV = +s[f] || 0, newV = oldV > max
        ? (act === 'i' ? oldV : oldV - 1)
        : clamp(oldV + (act === 'i' ? 1 : -1), 0, max);
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
    if (act === 'first') scoreFeedback(gno, 'first', null, newF - oldF);
    else if (act === 'i' || act === 'd') scoreFeedback(gno, f, null, (f === 'phone' ? -1 : 1) * (newV - oldV));
  });

  /** 个人扣分走这里，±1 和归零都记录、都可撤销。
      纸质表上「犯几次写几次」，所以不封 5，只封 99 防手滑。 */
  function changeMemberPoints(cls,lesson,gno,index,delta){var s=sc(lesson,gno),old=JSON.parse(JSON.stringify(s)),g=groupOf(cls,gno),base=Math.min(5,(+s.group||0)+(s.first?1:0)),values=g.members.map(function(_,i){return remaining(lesson,gno,i);});s.phone=0;g.members.forEach(function(m,i){if(!m.name)return;var value=values[i];if(index===null||String(i)===String(index))value=Math.max(0,Math.min(base,value+delta));s.personal[String(i)]=base-value;});if(JSON.stringify(old)===JSON.stringify(s))return;pushUndo({lessonId:lesson.id,gno:gno,reset:true,old:old,label:index===null?'全组项目各扣1分':'成员'+(+index+1)+'项目分调整'});save();refreshCard(cls,lesson,gno);renderMetrics(cls,lesson);}
  function bumpPersonal(cls, lesson, chip, delta) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    if(+s.phone>0){changeMemberPoints(cls,lesson,gno,i,-delta);return;}
    var old = +s.personal[i] || 0;
    var neu = clamp(old + delta, 0, Math.min(5,(+s.group||0)+(s.first?1:0)));
    if (neu === old) return;
    s.personal[i] = neu;
    pushUndo({
      lessonId: lesson.id, gno: gno, i: i, old: old, neu: neu,
      name: memberName(cls, gno, +i)
    });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    scoreFeedback(gno, null, i, old - neu);
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
    scoreFeedback(gno, null, i, old - val);
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
    lesson.scores[key] = { first: 0, group: lesson.memberProjectBase===5?5:0, phone: 0, duty: 0, personal: {} };
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

  /* 清零使用明确按钮，避免连续两次扣分被浏览器dblclick误判为清零。 */

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
    scoreFeedback(gno, f, null, (f === 'phone' ? -1 : 1) * (neu - old));
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
          var w = r.t === 0 ? 0 : Math.max(2, Math.round(Math.abs(r.t) / maxAbs * 100));
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
    $('#semesterSummary').textContent = cls.name+' · '+ls.length+'次课 · '+ms.length+'名已分组学生 · 学期累计合计 '+ms.reduce(function(a,m){return a+m.total;},0)+'分。包含当前班全部已录入课次，随记分实时更新。';
    if(window.JFDT_ASSESSMENT) window.JFDT_ASSESSMENT.renderRank({root:$('#memberRank'),cls:cls,lessons:ls,raw:ms,save:function(){save();},log:addOperationLog,message:flash,openAttendance:function(){switchView('attendance');},export:function(name,rows){download(name,toCsv(rows),'text/csv');}});

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
    if (n > 0) { b.hidden = false; b.textContent = '全部班级 ' + n + ' 人'; }
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
      '<div class="metric"><div class="k">本班待分配</div><div class="v ' + (nPending ? 'neg' : '') + '">' +
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
    rows.push(['组号', '成员', '小组分', '手机未入袋', '值日分', '值日参与人数', '值日应到人数', '个人扣分合计', '本节合计', '小组累计']);
    cls.groups.forEach(function (g) {
      var s = sc(lesson, g.no);
      rows.push([g.no,
        g.members.map(function (m) { return m.name; }).join('、'),
        Math.min(5,(+s.group||0)+(s.first?1:0)), +s.phone || 0, +s.duty || 0,
        s.dutyParticipation?s.dutyParticipation.present:'',s.dutyParticipation?s.dutyParticipation.expected:'',
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
    rows.push(['排名', '姓名', '学号', '小组', '全组加分', '个人项目分', '个人扣分', '总分']);
    ms.forEach(function (m, i) {
      rows.push([i + 1, m.name, m.sid || (m.no == null ? '' : m.no), '第' + m.gno + '组',
                 m.groupScore, m.project, m.personal, m.total]);
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
    download('夜夜小组制加分助手_备份_' + stamp() + '.json',
      JSON.stringify(S, null, 2), 'application/json');
  });

  $('#btnRestore').addEventListener('click', function () { $('#fileRestore').click(); });
  $('#btnRosterSetup').addEventListener('click', function () { switchView('data'); });
  $('#btnRosterGroups').addEventListener('click',function(){switchView('pool');});
  $('#btnRosterTemplate').addEventListener('click', function () {
    rosterDownload([['班级','姓名','学号','小组','班内序号'],['示例班','张三','26000000001',1,1],['示例班','李四','26000000002',1,2]], '名单导入模板');
  });
  $('#btnImportRoster').addEventListener('click', function () { $('#fileRoster').click(); });
  $('#fileRoster').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 10000000) { alert('名单文件不能超过 10MB。'); return; }
    var excel = /\.(xlsx|xls|ods)$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = CLOUD && CLOUD.profile();
        var rows = excel ? window.JFDT_ROSTER.workbook(reader.result) : window.JFDT_ROSTER.parse(reader.result);
        var result = window.JFDT_ROSTER.apply(S, rows, p ? p.displayName : '');
        if (!confirm('识别到：'+Array.from(new Set(rows.map(function(r){return r['班级'];}))).join('、')+'；共 ' + result.students + ' 名学生。'+(rows.skippedSheets&&rows.skippedSheets.length?' 已跳过非名单页：'+rows.skippedSheets.join('、')+'。':'')+'确认导入？同名班级的空白名单将被替换；仅提取名单与已有分组，不导入纸表考勤格。')) return;
        S = result.state;
        var importedClass=S.classes.find(function(c){return c.name===rows[0]['班级'];});if(importedClass){S.ui.classId=importedClass.id;S.ui.lessonId=null;}
        save(); fillClassSelects(); renderData(); renderUndoBtn();
        $('#rosterImportStatus').textContent = '已导入 ' + result.classes + ' 个班、' + result.students + ' 名学生。下一步：点击“名单与分组”核对或分配小组。';
        flash('名单已导入，正在同步');
      } catch (e) { alert('导入失败：' + e.message); }
    };
    reader.onerror = function () { alert('名单文件读取失败。'); };
    if(excel) reader.readAsArrayBuffer(file); else reader.readAsText(file, 'UTF-8');
  });

  function rosterDownload(rows, name) {
    var format = $('#rosterFormat').value;
    if(format==='csv'){download(name+'.csv',toCsv(rows),'text/csv;charset=utf-8');return;}
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:20},{wch:16},{wch:26},{wch:10},{wch:12}];
    XLSX.utils.book_append_sheet(wb,ws,'名单');
    var bytes=XLSX.write(wb,{bookType:format,type:'array'});
    download(name+'.'+format,bytes,'application/octet-stream');
  }
  $('#btnExportRoster').addEventListener('click',function(){
    var rows=[['班级','姓名','学号','小组','班内序号']];
    S.classes.forEach(function(c){
      (c.roster||[]).forEach(function(m){
        var group=c.groups.find(function(g){return g.members.some(function(p){return p.sid===m.sid;});});
        rows.push([c.name,m.name,String(m.sid),group?group.no:'',m.no==null?'':m.no]);
      });
    });
    rosterDownload(rows,'全部班级名单_'+stamp());
  });

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
    if(lessonExporting)return;
    if(orient!=='lesson'||!html.includes('lesson-duplex')){window.print();return;}
    var old=document.querySelector('#lessonPrintFrame');if(old)old.remove();
    var frame=document.createElement('iframe');frame.id='lessonPrintFrame';frame.title='本课打印文档';frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    var css=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function(l){return '<link rel="stylesheet" href="'+esc(l.href)+'">';}).join('');
    var pageStyle=$('#lessonPageStyle');
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><title>本课加分表</title>'+css+'<style>'+(pageStyle?pageStyle.textContent:'')+'@media print{html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;display:block!important}body::before,body::after{display:none!important}#printArea{display:block!important;position:static!important;margin:0!important}.lesson-duplex-page:last-child{break-after:auto!important;page-break-after:auto!important}}</style></head><body class="print-lesson"><div id="printArea">'+html+'</div></body></html>';
    frame.onload=function(){frame.contentWindow.focus();frame.contentWindow.print();};document.body.appendChild(frame);
  }

  var XL_RULE = "每课小组项目5分，每个命名个人项目5分；学期值日项目只计一次5分，全班未完成先按0计，重复值日取最高分。全组扣分从每位成员项目分扣除，个人扣分只扣本人，两类扣分合计仅扣本课小组项目，最低0且不跨课。完成率＝项目净得分÷项目满分（换算范围0%–100%）；学习＝91×完成率，考勤＝max(0,9−累计考勤扣分)，平时＝学习＋考勤；计入总评＝学习×40%＋考勤×40%，满分36.4＋3.6＝40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。";


  /** 班内序号补两位，跟纸质表的「张三 05」一致 */
  function two(n) {
    if (n == null || n === '') return '';
    return n < 10 ? '0' + n : '' + n;
  }

  /** 打印本课：完全照着纸质《课堂分组与加分记录表》的 12 列版式 */
  var lessonPrintOptions={range:'both',orientation:'portrait'},lessonExporting=false;
  function openLessonPrint(cls,lesson,asPdf){
    var dlg=$('#dlgLessonPrint');
    if(!dlg){dlg=document.createElement('dialog');dlg.id='dlgLessonPrint';dlg.innerHTML='<form method="dialog"><h2>打印本课</h2><label class="field col">打印范围<select id="lessonPrintRange"><option value="both">加分表＋背面说明</option><option value="front">仅加分表</option><option value="rules">仅规则说明</option></select></label><label class="field col">纸张方向<select id="lessonPrintOrientation"><option value="portrait">A4 竖向</option><option value="landscape">A4 横向</option></select></label><p class="note">范围和方向在此选择。双面打印选择长边翻转；建议关闭页眉页脚。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(dlg);}
    dlg.querySelector('h2').textContent=asPdf?'下载打印版 PDF':'打印本课';dlg.querySelector('[value="ok"]').textContent=asPdf?'下载 PDF':'开始打印';
    dlg.onclose=function(){if(dlg.returnValue!=='ok')return;lessonPrintOptions={range:$('#lessonPrintRange').value,orientation:$('#lessonPrintOrientation').value};if(asPdf)downloadLessonPdf(cls,lesson);else printLesson(cls,lesson);};dlg.returnValue='';openDlg(dlg);
  }
  var pdfExportBusy=false;
  async function downloadLessonPdf(cls,lesson){
    if(pdfExportBusy)return;pdfExportBusy=true;
    var frame=null,pdfOrientation=lessonPrintOptions.orientation;
    try{
      flash('正在生成打印版 PDF…');
      lessonExporting=true;try{printLesson(cls,lesson);}finally{lessonExporting=false;document.body.classList.remove('print-lesson');}
      var html=$('#printArea').innerHTML,pageCss=$('#lessonPageStyle').textContent;
      var css=await (await fetch(new URL('styles.css',location.href))).text();
      css=(css+'\n'+pageCss).replace(/@media screen/g,'@media not all').replace(/@media print/g,'@media all');
      css+='\nhtml,body{margin:0!important;padding:0!important;width:100%!important;height:auto!important;min-height:0!important;background:white!important}#printArea{display:block!important;position:static!important}.lesson-duplex-page{width:100%!important;margin:0!important;border:0!important}';
      var landscape=pdfOrientation==='landscape',widthMm=landscape?277:190,heightMm=landscape?178:264,widthPx=Math.round(widthMm*96/25.4),heightPx=Math.round(heightMm*96/25.4);
      frame=document.createElement('iframe');frame.title='生成打印PDF';frame.style.cssText='position:fixed;left:-20000px;top:0;width:'+widthPx+'px;height:'+heightPx+'px;border:0';
      var loaded=new Promise(function(resolve){frame.onload=resolve;});
      frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css+'</style><body class="print-lesson"><div id="printArea">'+html+'</div></body>';
      document.body.appendChild(frame);await loaded;await frame.contentDocument.fonts.ready;
      var doc=frame.contentDocument,pages=Array.from(doc.querySelectorAll('.lesson-duplex-page'));
      if(!pages.length)throw new Error('没有可导出的页面。');
      var pdf=new window.jspdf.jsPDF({orientation:landscape?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
      for(var i=0;i<pages.length;i++){
        var body=doc.createElement('body');body.className='print-lesson';body.setAttribute('xmlns','http://www.w3.org/1999/xhtml');body.style.cssText='margin:0;width:'+widthPx+'px;height:'+heightPx+'px;background:white';
        var style=doc.createElement('style');style.textContent=css;
        var area=doc.createElement('div');area.id='printArea';area.appendChild(pages[i].cloneNode(true));body.appendChild(style);body.appendChild(area);
        var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+widthPx+'" height="'+heightPx+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(body)+'</foreignObject></svg>';
        var img=new Image();await new Promise(function(resolve,reject){img.onload=resolve;img.onerror=function(){reject(new Error('打印页面渲染失败。'));};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
        var canvas=document.createElement('canvas');canvas.width=Math.round(widthPx*3.125);canvas.height=Math.round(heightPx*3.125);var context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
        if(i)pdf.addPage('a4',landscape?'landscape':'portrait');pdf.addImage(canvas.toDataURL('image/png'),'PNG',10,10,widthMm,heightMm,undefined,'FAST');canvas.width=canvas.height=1;
      }
      download(cls.name+'_第'+lesson.seq+'次课_打印版.pdf',pdf.output('arraybuffer'),'application/pdf');flash('打印版 PDF 已下载，换电脑可直接打印');
    }catch(e){alert('PDF 下载失败：'+e.message+'。也可使用“打印本课”并选择另存为 PDF。');}
    finally{if(frame)frame.remove();pdfExportBusy=false;}
  }
  function downloadLessonExcel(cls,lesson){
    var box=document.createElement('div'),original=window.print,options=lessonPrintOptions;window.print=function(){};lessonPrintOptions={range:'both',orientation:'portrait'};lessonExporting=true;
    try{printLesson(cls,lesson);box.innerHTML=$('#printArea').innerHTML;}finally{window.print=original;lessonPrintOptions=options;lessonExporting=false;document.body.classList.remove('print-lesson');}
    var table=box.querySelector('.sheet-tb');
    var wb=XLSX.utils.book_new();
    if(table)XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(table,{raw:true}),'本课加分表');
    var A=window.JFDT_ASSESSMENT,rows=[['班级','课次','日期','姓名','学号','平时分','至今项目完成率','考勤分','计入总评','期末至少需考']];
    A.rows(cls,lessonsOf(cls.id),memberTotals(cls)).forEach(function(m){rows.push([cls.name,lesson.seq,lesson.date,m.name,String(m.sid||''),m.regular,m.task.maximum?Math.round(m.task.rate*1000)/10+'%':'—',m.attendance,m.contribution,m.attendanceFailed?'不适用':m.needed>100?'无法达到':m.needed]);});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'个人成绩');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['加分与换算说明'],[box.querySelector('.lesson-rules-back').textContent]]),'规则说明');
    var rules=Array.from(box.querySelector('.lesson-rules-back').children).map(function(el){return {text:el.textContent,heading:/^H/.test(el.tagName)};});
    var formatted=window.JFDT_PRINT_EXCEL(table,cls.name+' · 第'+lesson.seq+'次 · '+lesson.date+' · '+(lesson.topic||''),rows,rules);
    download(cls.name+'_第'+lesson.seq+'次课_可编辑打印版.xlsx',formatted,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function printLesson(cls, lesson) {
    var dg = lesson.dutyGroup ? +lesson.dutyGroup : null;

    var cols = '<col class="w-no">';
    for (var c = 0; c < GROUP_CAP; c++) cols += '<col class="w-mem">';
    cols += '<col class="w-attendance"><col class="w-phone"><col class="w-grp">' +
      '<col class="w-duty"><col class="w-sum"><col class="w-grade"><col class="w-grade"><col class="w-grade">';

    var subHead = '';
    for (var k = 0; k < GROUP_CAP; k++) subHead += '<th class="c-mem">成员' + (k + 1) + '</th>';

    var head = '<thead><tr>' +
      '<th class="c-no" rowspan="2">组<br>号</th>' +
      '<th class="c-mem" colspan="' + GROUP_CAP + '">小组成员姓名 / 本节项目分（0–5）</th>' +
      '<th class="home-attendance" rowspan="2">考勤分<br>/9</th><th class="c-phone" rowspan="2">全组扣分<br>（每人扣1）</th>' +
      '<th class="c-grp" rowspan="2">全组·小组分<br>(0-5)</th>' +
      '<th class="c-duty" rowspan="2">全组·值日<br>(0-5)</th>' +
      '<th class="c-sum" rowspan="2">本节<br>合计</th>'+homeGradeHead() +
      '</tr><tr>' + subHead + '</tr></thead>';

    var body = cls.groups.map(function (g) {
      var s = sc(lesson, g.no);
      var isDuty = (dg === g.no);
      var names = '', deds = '';
      for (var i = 0; i < GROUP_CAP; i++) {
        var m = g.members[i];
        names += '<td class="c-mem'+(m&&m.name?attendanceNameClass(cls,m):'')+'">' +
          ((m && m.name) ? esc(m.name) + ' ' + two(m.no == null ? null : m.no) : '') + '</td>';
        var dv = m&&m.name ? remaining(lesson,g.no,i) : 0;
        deds += '<td class="c-ded">' + (dv ? dv : '') + '</td>';
      }
      return '<tbody data-pg="' + g.no + '"' + (isDuty ? ' class="is-duty"' : '') + '>' +
        '<tr class="gname">' +
          '<td class="c-no' + (isDuty ? ' duty' : '') + '" rowspan="2">' + g.no + '</td>' +
          names + attendanceCell(cls,lesson,g,true) +
          '<td class="c-phone" rowspan="2">' + (+s.phone || '') + '</td>' +
          '<td class="c-grp" rowspan="2">' + (+s.group || '') + '</td>' +
          '<td class="c-duty" rowspan="2">' + (+s.duty || '') + (s.dutyParticipation?'<br><small>'+s.dutyParticipation.present+'/'+s.dutyParticipation.expected+'人</small>':'') + '</td>' +
          '<td class="c-sum" rowspan="2">' +
            lessonMemberTotals(cls,lesson,g) + '</td>'+homeGradeCells(cls,g) +
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
    var foot='<tfoot><tr><td class="c-note" colspan="'+(GROUP_CAP+9)+'">'+note+'</td></tr><tr><td class="c-note" colspan="'+(GROUP_CAP+9)+'">右侧三列为本学期当前个人成绩，与排名页相同；按姓名逐行对应。成绩按已登记的项目和考勤计算，考勤挂科时考试目标不适用。打印后不会自动更新。</td></tr></tfoot>';

    var cfg=window.JFDT_ASSESSMENT.settings(cls);
    var reverse='<section class="lesson-duplex-page lesson-rules-back"><h1>小组制课堂 · 加分与成绩换算说明</h1><p>'+esc(cls.name)+' · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><h2>1. 项目与扣分</h2><p>每新开一课，小组项目满分增加5；每个命名个人项目再增加5。同课任一组修改个人项目名，全班同步。全组扣分从每个人项目得分扣除，个人扣分只扣本人，合计仅扣本课小组项目，最低0，不跨课。</p><h2>2. 值日与成绩换算</h2><p>每课小组项目5分，每个命名个人项目5分；学期值日项目只计一次5分，全班未完成先按0计，重复值日取最高分。全组扣分从每位成员项目分扣除，个人扣分只扣本人，两类扣分合计仅扣本课小组项目，最低0且不跨课。完成率＝项目净得分÷项目满分（换算范围0%–100%）；学习＝91×完成率，考勤＝max(0,9−累计考勤扣分)，平时＝学习＋考勤；计入总评＝学习×40%＋考勤×40%，满分36.4＋3.6＝40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。</p><h2>3. 考勤与挂科标记</h2><p>本班默认扣分：迟到'+cfg.late+'、早退'+cfg.early+'、旷课'+cfg.truant+'、请假'+cfg.leave+'；每次可由教师更正。迟到＋早退每'+cfg.lateEarlyConversion+'次折算1次旷课，只用于挂科计数，不重复扣分。实际＋折算旷课合计'+cfg.truantFailure+'次触发标红；当前考勤挂科标记'+(cfg.attendanceFailureEnabled?'开启':'关闭')+'。门槛与开关由教师在二级设置调整，更正后自动重算。</p><h2>4. 期末还需考多少分</h2><p>平时占40%，期末占60%，本班及格线'+cfg.passScore+'。期末需考=max(0,(及格线−平时成绩×0.4)÷0.6)，向上取0.1分。折合列仅显示一位小数，计算使用未提前舍入的数值。超过100表示无法达到；考勤挂科时目标不适用，考试高分不能解除标记。</p><h2>5. 阅读与使用</h2><p>正面三列按成员序号1、2、3…对应，是打印时本学期当前个人成绩，与排名页相同；不是小组平均分。未编辑考勤默认到课，只登记请假、旷课、迟到或早退等异常。资料未齐时供参考。纸上填写不会自动识别，教师需回网页补录；以网页最新记录为准。</p><p class="duplex-note">双面打印：A4竖向，长边翻转；关闭浏览器页眉页脚。每张加分表正面后紧跟这份规则背面。</p></section>';
    var groupBodies=body.match(/<tbody[\s\S]*?<\/tbody>/g)||[],pages=[];
    for(var offset=0;offset<groupBodies.length;offset+=groupBodies.length){pages.push('<section class="lesson-duplex-page lesson-duplex-front"><div class="sheet-title">课堂分组与加分记录表</div><div class="sheet-info">'+esc(cls.name)+' · 第'+lesson.seq+'次 · '+esc(lesson.date||'')+' · '+esc(lesson.topic||'')+'</div><div class="sheet-duty">值日：'+(dg?'第'+dg+'组':'未指定')+' · 第'+(offset/6+1)+'张</div><table class="sheet-tb"><colgroup>'+cols+'</colgroup>'+head+groupBodies.slice(offset,offset+groupBodies.length).join('')+foot+'</table></section>');pages.push(reverse);}
    var holder=document.createElement('div');holder.innerHTML=pages.join('');
    if(lessonPrintOptions.range==='front')holder.querySelectorAll('.lesson-rules-back').forEach(function(e){e.remove();});
    if(lessonPrintOptions.range==='rules')holder.querySelectorAll('.lesson-duplex-front').forEach(function(e){e.remove();});
    var style=$('#lessonPageStyle');if(!style){style=document.createElement('style');style.id='lessonPageStyle';document.head.appendChild(style);}
    var landscape=lessonPrintOptions.orientation==='landscape';
    var printSlots=cls.groups.reduce(function(n,g){return n+Math.max(3,g.members.filter(function(m){return !!m.name;}).length);},0);
    var printLine=Math.min(4,(landscape?118:200)/Math.max(1,printSlots)),printFont=Math.min(10,printLine*2.5);
    style.textContent='@media print{@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:10mm}@page leaderPaper{size:A4 '+(landscape?'landscape':'portrait')+';margin:10mm}.lesson-duplex-page{height:'+(landscape?'178':'264')+'mm!important}.lesson-duplex-front .sheet-tb{top:'+(landscape?'31':'22')+'mm!important;transform:none!important;zoom:'+(landscape?'.65':'.92')+';width:100%!important}.lesson-rules-back{font-size:'+(landscape?'8':'10')+'pt!important}.lesson-rules-back p{font-size:'+(landscape?'8':'10')+'pt!important}.lesson-rules-back h2{margin:2mm 0 1mm!important}}';
    style.textContent+='@media print{.lesson-duplex-front .sheet-tb{top:20mm!important;transform:none!important;zoom:1!important;width:100%!important;--print-font:'+printFont+'pt;--print-line:'+printLine+'mm}}';
    printArea('<div class="lesson-duplex">'+holder.innerHTML+'</div>','lesson');
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

    if(window.JFDT_ASSESSMENT) html+=window.JFDT_ASSESSMENT.printHtml(cls,ls,ms);
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
  $('#btnUndo').addEventListener('click', function () {
    undo();
  });
  function redo(index) {if(typeof index!=='number')index=(S.redo||[]).length-1;var entry=(S.redo||[]).splice(index,1)[0];if(!entry)return false;var l=getLesson(entry.op.lessonId);if(!l)return false;var effect=entry.redoEffect||operationEffect(entry.op),actual=applyEffect(entry.op,effect,1);entry.op.effect=actual;S.undo.push(entry.op);S.ui.classId=l.classId;S.ui.lessonId=l.id;addOperationLog('重做',undoLabel(reverseOp(entry.op)));save(false);renderScore();if(entry.op.projectBatch)renderLeader();renderUndoBtn();flash('已恢复所选操作');return true;}
  $('#btnRedo').addEventListener('click', redo);
  var specialDialog=document.createElement('dialog');specialDialog.id='dlgSpecialRecords';specialDialog.innerHTML='<div id="specialContent"></div>';document.body.appendChild(specialDialog);wireDialog(specialDialog);var specialClassId=null,specialEditing=null;
  function specialMembers(cls){var map=new Map();cls.groups.forEach(function(g){g.members.forEach(function(m){if(m.name)map.set(window.JFDT_ASSESSMENT.key(m),m);});});(cls.roster||[]).forEach(function(m){if(m.name&&!map.has(window.JFDT_ASSESSMENT.key(m)))map.set(window.JFDT_ASSESSMENT.key(m),m);});return Array.from(map.entries()).map(function(pair){return {key:pair[0],name:pair[1].name,sid:pair[1].sid||''};});}
  function renderSpecial(){var cls=getClass(specialClassId)||curClass(),members=specialMembers(cls),records=cls.specialRecords||[],editing=records.find(function(r){return r.id===specialEditing;});specialClassId=cls.id;$('#specialContent').innerHTML='<h2>特殊表现记录</h2><p class="note">仅供期末核分参考，不计入项目满分、完成率、平时分、总评、排名或期末需考。</p><label class="field col">班级<select id="specialClass">'+S.classes.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label><form id="specialForm"><div class="btnrow"><label class="field">日期<input type="date" id="specialDate" value="'+esc(editing?editing.date:today())+'" required></label><label class="field">参考加分<input type="number" id="specialPoints" min="0.1" max="1000" step="0.1" value="'+(editing?editing.points:1)+'" required></label></div><label class="field col">事由<input id="specialReason" maxlength="300" value="'+esc(editing?editing.reason:'')+'" placeholder="例如：非本组值日，主动留下打扫" required></label><label class="field col">选择学生<input id="specialSearch" placeholder="姓名或学号筛选"></label><div class="special-members">'+members.map(function(m){return '<label data-special-person="'+esc(m.name+' '+m.sid)+'"><input type="checkbox" name="specialMember" value="'+esc(m.key)+'"'+(editing&&editing.members.some(function(x){return x.key===m.key;})?' checked':'')+'>'+esc(m.name)+' <small>'+esc(m.sid)+'</small></label>';}).join('')+'</div><p id="specialError" class="note" role="alert"></p><div class="btnrow"><button class="btn primary" type="submit">'+(editing?'保存修改':'记录特殊表现')+'</button><button class="btn" type="button" id="specialNew">清空填写</button></div></form><details><summary>按学生汇总（独立参考）</summary><table class="data"><thead><tr><th>学生</th><th>次数</th><th>参考分</th></tr></thead><tbody>'+members.map(function(m){var hits=records.filter(function(r){return r.members.some(function(x){return x.key===m.key;});});return hits.length?'<tr><td>'+esc(m.name)+'</td><td>'+hits.length+'</td><td>'+Math.round(hits.reduce(function(a,r){return a+r.points;},0)*10)/10+'</td></tr>':'';}).join('')+'</tbody></table></details><div class="btnrow"><button class="btn" id="specialExport">导出参考Excel</button><button class="btn" id="specialRestore"'+(!(cls.specialRecordsTrash||[]).length?' disabled':'')+'>恢复最近删除</button><button class="btn" id="specialClose">关闭</button></div><div class="special-history">'+records.slice().sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(r){return '<article><b>'+esc(r.date)+' · +'+r.points+'</b><p>'+esc(r.members.map(function(m){return m.name;}).join('、'))+'</p><p>'+esc(r.reason)+'</p><button class="btn" data-special-edit="'+esc(r.id)+'">修改</button> <button class="btn" data-special-delete="'+esc(r.id)+'">删除</button></article>';}).join('')+(!records.length?'<p class="note">暂无特殊表现记录。</p>':'')+'</div>';
    $('#specialClass').onchange=function(){specialClassId=this.value;specialEditing=null;renderSpecial();};$('#specialClose').onclick=function(){specialDialog.close();};$('#specialNew').onclick=function(){specialEditing=null;renderSpecial();};$('#specialSearch').oninput=function(){var q=this.value.trim();$$('[data-special-person]',specialDialog).forEach(function(el){el.hidden=!el.dataset.specialPerson.includes(q);});};$('#specialForm').onsubmit=function(e){e.preventDefault();var selected=$$('input[name="specialMember"]:checked',specialDialog).map(function(el){return members.find(function(m){return m.key===el.value;});}),points=Number($('#specialPoints').value),date=$('#specialDate').value,reason=$('#specialReason').value.trim();if(!selected.length||!reason||!Number.isFinite(points)||points<=0||points>1000||!/^\d{4}-\d{2}-\d{2}$/.test(date)){$('#specialError').textContent='请选择学生并填写有效日期、事由和正数参考分。';return;}if(!cls.specialRecords)cls.specialRecords=[];var record={id:specialEditing||uid('special'),date:date,points:Math.round(points*10)/10,reason:reason,members:selected,updatedAt:new Date().toISOString()};if(editing)cls.specialRecords[cls.specialRecords.findIndex(function(r){return r.id===specialEditing;})]=record;else cls.specialRecords.push(record);specialEditing=null;save();renderSpecial();};$$('[data-special-edit]',specialDialog).forEach(function(b){b.onclick=function(){specialEditing=b.dataset.specialEdit;renderSpecial();};});$$('[data-special-delete]',specialDialog).forEach(function(b){b.onclick=function(){var index=cls.specialRecords.findIndex(function(r){return r.id===b.dataset.specialDelete;});if(index<0)return;if(!cls.specialRecordsTrash)cls.specialRecordsTrash=[];cls.specialRecordsTrash.push(cls.specialRecords.splice(index,1)[0]);cls.specialRecordsTrash=cls.specialRecordsTrash.slice(-100);save();renderSpecial();};});$('#specialRestore').onclick=function(){if(!cls.specialRecords)cls.specialRecords=[];var record=(cls.specialRecordsTrash||[]).pop();if(record&&!cls.specialRecords.some(function(r){return r.id===record.id;}))cls.specialRecords.push(record);save();renderSpecial();};$('#specialExport').onclick=function(){var X=window.XLSX,wb=X.utils.book_new(),summary=[['班级','姓名','学号','记录次数','特殊参考分（不计成绩）']],detail=[['日期','班级','姓名','学号','参考加分','事由']];members.forEach(function(m){var hits=records.filter(function(r){return r.members.some(function(x){return x.key===m.key;});});if(hits.length)summary.push([cls.name,m.name,m.sid,hits.length,Math.round(hits.reduce(function(a,r){return a+r.points;},0)*10)/10]);});records.forEach(function(r){r.members.forEach(function(m){detail.push([r.date,cls.name,m.name,m.sid,r.points,r.reason]);});});[summary,detail].forEach(function(rows,i){var ws=X.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map(function(_,j){return {wch:j===5?50:22};});X.utils.book_append_sheet(wb,ws,i?'事由明细':'独立参考汇总');});var url=URL.createObjectURL(new Blob([X.write(wb,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=cls.name+'_特殊表现参考.xlsx';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
  }
  $('#btnSpecialRecords').onclick=function(){specialClassId=curClass().id;specialEditing=null;renderSpecial();openDlg(specialDialog);};
  var restoreFiveDialog=document.createElement('dialog');restoreFiveDialog.id='dlgRestoreFive';restoreFiveDialog.innerHTML='<form method="dialog"><h2>恢复默认5分</h2><label class="field col">恢复范围<select id="restoreFiveScope"><option value="lesson">当前课次</option><option value="class">当前班级全部课次</option><option value="all">所有班级全部课次</option></select></label><p class="note">直接恢复每人的本节小组项目5分，不生成逐人加分日志。相关扣分及撤销项移入备份归档，避免再次撤掉默认分。个人评分表项目、值日和考勤保留。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">恢复5分</button></div></form>';document.body.appendChild(restoreFiveDialog);wireDialog(restoreFiveDialog);
  $('#btnRestoreFive').onclick=function(){openDlg(restoreFiveDialog);};restoreFiveDialog.addEventListener('close',function(){if(restoreFiveDialog.returnValue!=='ok')return;var cls=curClass(),current=curLesson(cls),scope=$('#restoreFiveScope').value,lessons=S.lessons.filter(function(l){return scope==='all'||scope==='class'&&l.classId===cls.id||scope==='lesson'&&current&&l.id===current.id;}),ids=new Set(lessons.map(function(l){return l.id;}));if(!lessons.length){flash('所选范围没有课次');return;}var archived={at:new Date().toISOString(),scope:scope,records:[],undo:[],redo:[],logs:[]};lessons.forEach(function(l){var c=getClass(l.classId);if(!c)return;l.memberProjectBase=5;c.groups.forEach(function(g){var old=sc(l,g.no);archived.records.push({lessonId:l.id,gno:g.no,group:old.group,first:old.first,phone:old.phone,personal:JSON.parse(JSON.stringify(old.personal||{}))});old.group=5;old.first=0;old.phone=0;old.personal={};});});function projectOp(op){return ids.has(op.lessonId)&&(op.i!=null||op.reset||['group','first','phone'].includes(op.f));}S.undo=(S.undo||[]).filter(function(op){if(projectOp(op)){archived.undo.push(op);return false;}return true;});S.redo=(S.redo||[]).filter(function(e){if(projectOp(e.op)){archived.redo.push(e);return false;}return true;});var classNames=new Set(lessons.map(function(l){return getClass(l.classId).name;}));S.operationLog=(S.operationLog||[]).filter(function(e){if(/个人扣分|项目分调整|全组项目|小组分|首个正确|全组扣分/.test(e.detail||'')&&(scope==='all'||Array.from(classNames).some(function(name){return (e.detail||'').includes(name);} ))){archived.logs.push(e);return false;}return true;});S.baselineRecoveryArchive=(S.baselineRecoveryArchive||[]).concat([archived]).slice(-3);save();renderScore();renderUndoBtn();flash('已直接恢复'+lessons.length+'课默认5分，无逐人加分日志');});
  $('#logClassFilter').addEventListener('change',function(){$('#logLessonFilter').value='';renderOperationLog();});$('#logLessonFilter').addEventListener('change',renderOperationLog);$('#logSearch').addEventListener('input',renderOperationLog);
  $('#btnOperationLog').addEventListener('click',function(){renderUndoBtn();openDlg($('#dlgOperationLog'));});
  $('#closeOperationLog').addEventListener('click',function(){$('#dlgOperationLog').close();});
  (function wireLogSwipe(){
    var list=$('#operationLogList'), gesture=null, suppressClick=false;
    list.addEventListener('pointerdown',function(e){
      if(e.pointerType!=='touch' && e.pointerType!=='pen')return;
      if(e.target.closest('button'))return;
      var row=e.target.closest('.operation-row'), button=row&&row.querySelector('[data-undo-index]:not([disabled])');
      if(!button)return;
      gesture={row:row,button:button,id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,locked:false};
    });
    list.addEventListener('pointermove',function(e){
      if(!gesture || gesture.id!==e.pointerId)return;
      var dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
      if(!gesture.locked && Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)){gesture=null;return;}
      if(!gesture.locked && dx < -10 && Math.abs(dx)>Math.abs(dy)*1.2){
        gesture.locked=true;gesture.row.setPointerCapture(e.pointerId);gesture.row.classList.add('log-swiping');
      }
      if(!gesture.locked)return;
      gesture.dx=Math.max(-150,Math.min(0,dx));
      gesture.row.style.transform='translateX('+gesture.dx+'px)';
      gesture.row.classList.toggle('swipe-ready',gesture.dx<=-96);
    });
    function finish(e,cancel){
      if(!gesture || gesture.id!==e.pointerId)return;
      var g=gesture;gesture=null;
      g.row.classList.remove('log-swiping','swipe-ready');g.row.style.transform='';
      if(!cancel && g.locked && g.dx<=-96){suppressClick=true;g.button.click();setTimeout(function(){suppressClick=false;},350);}
    }
    list.addEventListener('pointerup',function(e){finish(e,false);});
    list.addEventListener('pointercancel',function(e){finish(e,true);});
    list.addEventListener('click',function(e){if(suppressClick && e.isTrusted){e.preventDefault();e.stopPropagation();}},true);
  })();
  $('#operationLogList').addEventListener('click',function(event){
    var button=event.target.closest('button[data-undo-index],button[data-redo-index]');
    if(!button || button.disabled)return;
    if(button.dataset.undoIndex!=null){
      var index=+button.dataset.undoIndex; if(!canUndoAt(index))return;
      fadeLogRow(button.closest('.operation-row'));
      var op=S.undo.splice(index,1)[0]; S.undo.push(op); undo();
    } else {fadeLogRow(button.closest('.operation-row'));redo(+button.dataset.redoIndex);}
  });


  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k !== 'z') return;
    var ae = document.activeElement;
    var tag = ae ? ae.tagName : '';
    /* 在输入框里按 Ctrl+Z 交给浏览器自己的文本撤销，别抢 */
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.shiftKey ? redo() : undo()) e.preventDefault();
  });

  /* 表格式 / 卡片式 切换 */
  $('#layoutSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-l]');
    if (!b || b.dataset.l === scoreLayout) return;
    scoreLayout = b.dataset.l;
    S.ui.scoreLayout = scoreLayout;
    $$('#layoutSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
    save(false);
    if (UI) UI.layout(renderScore);
    else renderScore();
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
    var duties=$('#nlDuty').value.split(/[、,，\s]+/).map(Number).filter(function(n){return Number.isInteger(n)&&n>0;});var duty=duties[0];
    var l = {
      id: uid('l'),
      classId: cls.id,
      seq: seq,
      date: $('#nlDate').value || today(),
      topic: $('#nlTopic').value.trim(),
      dutyGroup: isNaN(duty) ? null : duty, dutyGroups:Array.from(new Set(duties)),
      scores: {}, memberProjectBase:5
    };
    cls.groups.forEach(function(g){l.scores[String(g.no)]={first:0,group:5,phone:0,duty:0,personal:{}};});
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
    ['login', 'invite', 'offline', 'reset'].forEach(function (k) { var node = $('#gate' + k[0].toUpperCase() + k.slice(1)); if (node) node.hidden = (k !== which); });
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
    ['#btnAccountLogin', '#btnRedeem', '#btnLocalOnly'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.disabled = !!busy;
    });
  }

  /* Returning from an OAuth error page may restore disabled controls from bfcache. */
  window.addEventListener('pageshow', function () { setGateBusy(false); });

  function doLogin() {
    var username = $('#loginUsername').value.trim();
    var password = $('#loginPassword').value;
    if (!username || !password) { gateShow('login', '请填写账号和密码。'); return; }
    setGateBusy(true);
    gateShow('login', null);
    CLOUD.login(username, password).then(function () {
      $('#loginPassword').value = '';
      setGateBusy(false);
    }).catch(function (e) {
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
    box.classList.toggle('is-admin', !!p.isAdmin);
    var vip = $('#userVip');
    if (vip) vip.hidden = !p.isAdmin;
    $('#tabAdmin').hidden = !p.isAdmin;
  }

  /* ---------------- 个人信息 ---------------- */

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
    $('#meAvatar').textContent = (p.displayName || p.name || '老师').slice(0, 1);
    $('#mePreviewName').textContent = p.displayName || p.name || '未命名老师';
    $('#meRole').textContent = p.isAdmin ? '👑 管理员 VIP' : '教师账号';
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
      flash('个人信息已保存', true);
      document.querySelectorAll('.profile-save-feedback').forEach(function (old) { old.remove(); });
      var feedback = document.createElement('div');
      feedback.className = 'profile-save-feedback';
      feedback.setAttribute('role', 'status');
      feedback.innerHTML = '<span class="profile-save-check" aria-hidden="true">✓</span><span>个人信息已保存</span>';
      document.body.appendChild(feedback);
      setTimeout(function () { feedback.remove(); }, 1700);
    }).catch(function (e) {
      $('#btnMeSave').disabled = false;
      msg.textContent = '没能保存：' + (e && e.message ? e.message : e);
      msg.className = 'gate-msg';
      msg.hidden = false;
      reopenDlg(dlgMe);
    });
  });

  var syncEditBlocked=true;
  function setSyncEditGate(blocked,message){syncEditBlocked=blocked;if(!S)return;['#view-score','#view-leader','#view-attendance','#view-pool','#scoreTools','#rosterCard','#lessonListCard'].forEach(function(selector){var el=$(selector);if(el)el.toggleAttribute('inert',blocked);});['#btnImportRoster','#btnRestore','#btnWipe'].forEach(function(selector){var b=$(selector);if(b)b.disabled=blocked;});var gate=$('#syncEditGate');if(!gate){gate=document.createElement('div');gate.id='syncEditGate';gate.className='sync-edit-gate';gate.setAttribute('role','status');$('#main').prepend(gate);}gate.hidden=!blocked;gate.textContent=message||'正在核对云端，确认后开放编辑';}
  var conflictNotice=document.createElement('dialog');conflictNotice.id='dlgSyncConflict';conflictNotice.innerHTML='<div class="dlg"><div class="dlg-head"><h3>两台设备的记录不同</h3><button type="button" class="dlg-x" id="closeSyncConflict" aria-label="关闭同步冲突提示">✕</button></div><div class="dlg-body"><p>本机改动还没有上传，云端也有更新。系统已暂停上传，避免覆盖另一台设备的记录。</p><div id="syncConflictDetails"></div><p class="note">先保存本机备份，再到“数据与备份”核对。分数不同不代表默认规则改变，请不要直接用旧记录覆盖云端。</p><div class="btnrow"><button class="btn" id="backupConflictLocal">下载本机备份</button><button class="btn primary" id="openSyncConflictTools">查看同步处理</button></div></div></div>';document.body.appendChild(conflictNotice);wireDialog(conflictNotice);var conflictNoticeShown=false;
  $('#closeSyncConflict').onclick=function(){conflictNotice.close();};$('#backupConflictLocal').onclick=function(){$('#btnBackup').click();};$('#openSyncConflictTools').onclick=function(){conflictNotice.close();switchView('data');$('.sync-row').scrollIntoView({block:'center',behavior:'smooth'});};
  $('#cloudChip').onclick=function(){if(CLOUD&&CLOUD.status().mode==='conflict')openDlg(conflictNotice);};$('#cloudChip').setAttribute('tabindex','0');$('#cloudChip').setAttribute('role','button');$('#cloudChip').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();this.click();}};
  function renderCloudStatus(st) {
    st = st || (CLOUD && CLOUD.status()) || { mode: 'idle', text: '' };
    var map = { checking:'saving',ok: 'ok', saving: 'saving', connecting: 'saving', offline: 'offline', error: 'error', conflict: 'error' };
    var cls = map[st.mode] || '';
    if(st.mode==='conflict'&&S){var conflictNames=(st.conflicts||[]).map(function(path){var parts=path.split('/'),lesson=parts[1]==='lessons'&&getLesson(parts[2]),c=lesson&&getClass(lesson.classId);if(!lesson)return '班级分组、课次或名单同时发生变动';var prefix=c.name+' · 第'+lesson.seq+'次课';if(parts[3]==='scores'){var g=groupOf(c,+parts[4]),m=g&&g.members[+parts[6]];return prefix+' · 第'+parts[4]+'组 · '+(parts[5]==='personal'?(m?m.name:'成员')+'项目分':parts[5]==='duty'||parts[5]==='dutyParticipation'?'值日分':'小组项目分');}if(parts[3]==='leaderScores')return prefix+' · 第'+parts[4]+'组 · 个人项目评分';if(parts[3]==='attendance')return prefix+' · 考勤';return prefix+' · 课次或项目设置';});$('#syncConflictDetails').textContent=Array.from(new Set(conflictNames)).slice(0,6).join('；');}

    if(CLOUD_ON&&S){if(st.mode==='ok')setSyncEditGate(false);else if(['checking','connecting','offline','error','conflict'].includes(st.mode))setSyncEditGate(true,st.mode==='conflict'?'记录存在冲突，请先处理后再编辑':st.mode==='offline'||st.mode==='error'?'同步未完成，已暂停编辑；恢复连接并核对成功后开放':'正在核对云端，确认后开放编辑');}
    var text = st.mode === 'idle' ? '未连接云端' : st.text;

    var chip = $('#cloudChip');
    chip.className = 'chip ' + cls;
    chip.textContent = text;chip.title='云端版本：'+(st.cloudVersion==null?'未核对':st.cloudVersion)+'；最近核对：'+(st.checkedAt?new Date(st.checkedAt).toLocaleString():'尚未核对')+'；云端保存：'+(st.serverTime?new Date(st.serverTime).toLocaleString():'未知');
    if(st.mode==='conflict'){chip.textContent='同步冲突 · 点击处理';chip.title=text;chip.classList.add('conflict-action');if(!conflictNoticeShown){conflictNoticeShown=true;setTimeout(function(){if(!document.querySelector('dialog[open]')&&CLOUD.status().mode==='conflict')openDlg(conflictNotice);},0);}}else{chip.classList.remove('conflict-action');if(st.mode==='ok')conflictNoticeShown=false;}
    chip.hidden = false;

    var row = $('.sync-row');
    if (row) {
      row.className = 'sync-row ' + cls;
      $('#syncText').textContent = text+(st.checkedAt?' · 核对时间 '+new Date(st.checkedAt).toLocaleTimeString():'');
    }

    /* 进了应用但云端没连上：在页面顶部挂一条明确的提示，别让人以为已经在同步 */
    var warn = $('#localWarn');
    if (warn) {
      var bad = !!S && (!CLOUD_ON || /^(offline|error|conflict)$/.test(st.mode)) && st.mode !== 'connecting';
      warn.hidden = !bad;
      if (bad) {
        warn.innerHTML = (st.mode === 'conflict' ? '<b>同步冲突，本机记录已保留</b> —— 请先下载备份，再选择从云端覆盖本机或把本机覆盖云端。' :
          '<b>记录尚未同步</b> —— 这节课的改动保存在当前浏览器；请检查连接与账号状态。') +
          (offlineWhy ? '<span class="why">（' + esc(offlineWhy) + '）</span>' : '') +
          ' <button class="linkbtn" id="btnRetryCloud">重试连接</button>';
        var rb = $('#btnRetryCloud');
        if (rb) rb.addEventListener('click', function () { refreshCloud(); });
      }
    }
  }

  /** 云端有更新就拉下来覆盖本机（只在本机没更新时） */
  function editingGrade(){var el=document.activeElement;return !!(el&&el.matches('input,textarea,select')&&!el.disabled&&!el.readOnly);}
  function applyCloudState(data){var keep=JSON.parse(JSON.stringify(S.ui||{}));S=migrate(JSON.parse(JSON.stringify(data)));S.ui=Object.assign({},S.ui||{},keep);writeLocal();fillClassSelects();switchView(view);renderUndoBtn();}
  function refreshCloud() {if(!CLOUD_ON||!CLOUD||!CLOUD.profile())return Promise.resolve(false);if(editingGrade())return Promise.resolve(false);return CLOUD.checkLatest(function(){return S;},function(rec){applyCloudState(rec.data);}).then(function(verified){if(verified)renderCloudStatus(CLOUD.status());return verified;});}
  function pauseForDeviceSwitch(){if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();setSyncEditGate(true,'切回页面后先核对云端，再开放编辑');}}
  window.addEventListener('blur',pauseForDeviceSwitch);window.addEventListener('focus',function(){if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();refreshCloud();}});document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')pauseForDeviceSwitch();else if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();refreshCloud();}});setInterval(function(){if(document.visibilityState!=='hidden'&&S&&CLOUD_ON)refreshCloud();},30000);
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
        download('夜夜小组制加分助手_' + name + '_' + stamp() + '.json',
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

    /* Keep the historical data key, but archive it by account before switching teachers. */
    if (profile && profile.uid) {
      try {
        var ownerKey = 'jfdt.owner.v1';
        var owner = localStorage.getItem(ownerKey);
        if (!owner && CLOUD && CLOUD.generation === 2 && localStorage.getItem(LS_KEY)) {
          localStorage.setItem('jfdt.legacy.' + Date.now(), localStorage.getItem(LS_KEY));
          localStorage.removeItem(LS_KEY);
        }
        if (owner && owner !== profile.uid) {
          var previous = localStorage.getItem(LS_KEY);
          if (previous) localStorage.setItem('jfdt.account.' + owner, previous);
          var ownState = localStorage.getItem('jfdt.account.' + profile.uid);
          if (ownState) localStorage.setItem(LS_KEY, ownState);
          else localStorage.removeItem(LS_KEY);
        }
        localStorage.setItem(ownerKey, profile.uid);
      } catch (e) {
        gateShow('login', '无法安全切换账号：浏览器存储不可用，请先备份原账号记录。');
        return;
      }
    }

    var hadLocalState = false;
    try { hadLocalState = !!localStorage.getItem(LS_KEY); } catch (e) {}
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
    var syncConflict = !!(hadLocalState && CLOUD && CLOUD.hasConflict && CLOUD.hasConflict(rec, S));
    var mergedOnStart=false;if(syncConflict&&CLOUD.mergeRecord){var merged=CLOUD.mergeRecord(rec,S);if(merged&&!merged.conflicts.length){var keepUi=S.ui;S=migrate(merged.data);S.ui=keepUi;CLOUD.acceptRemote(rec);syncConflict=false;mergedOnStart=true;}}
    if(CLOUD&&CLOUD.bindState)CLOUD.bindState({get:function(){return S;},apply:applyCloudState,canApply:function(){return !editingGrade();}});

    if (!syncConflict && !mergedOnStart && cloudData && cloudData.classes && (!hadLocalState || cloudAt > localAt)) {
      S = migrate(JSON.parse(JSON.stringify(cloudData)));   // 云端更新 → 以云端为准
      if (CLOUD.acceptRemote) CLOUD.acceptRemote(rec);
      writeLocal();
    }

    if (!S.ui) S.ui = {};
    if (!S.undo) S.undo = [];
    if (!S.ui.classId && S.classes[0]) S.ui.classId = S.classes[0].id;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };
    writeLocal();

    initLayout();
    fillClassSelects();
    renderUndoBtn();
    renderUserBox(profile);

    /* 兼容缺少显示名的旧存档，首次进入时请老师补全姓名。
       只在本次启动提示一次，关掉了就不再烦人。 */
    if (profile && !profile.displayName && !meNudged) {
      meNudged = true;
      openMe();
    }
    gateHide();
    setSyncEditGate(true,'正在核对云端，确认后开放编辑');

    /* 本机比云端新（含"第一次登录，把本机旧记录搬上云"）→ 推上去 */
    if (!syncConflict && CLOUD_ON && (mergedOnStart || !cloudData || (hadLocalState && localAt > cloudAt))) {
      CLOUD.touch(function () { return S; });
    }
    renderCloudStatus();
    if (syncConflict) CLOUD.reportConflict(merged&&merged.conflicts);
    renderPoolBanner(curClass());
    switchView('score');
    if(CLOUD_ON)setTimeout(function(){refreshCloud();},0);
  }

  /* ================= 启动 ================= */

  /* 云端状态 → 顶栏小圆点 + 数据页同步条 */
  if (CLOUD) CLOUD.onStatus(renderCloudStatus);
  var checkCloudButton=document.createElement('button');checkCloudButton.id='btnCheckCloudLatest';checkCloudButton.className='btn';checkCloudButton.textContent='核对云端最新版';checkCloudButton.onclick=function(){refreshCloud();};$('#btnSyncNow').parentElement.appendChild(checkCloudButton);

  /* 闸门上的按钮 */
  $('#btnAccountLogin').addEventListener('click', doLogin);
  $('#loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('#btnShowRegister').addEventListener('click', function () { gateShow('invite'); });
  $('#btnShowLogin').addEventListener('click', function () { gateShow('login'); });
  $('#btnLocalOnly').addEventListener('click', function () {
    gateShow('login','请连接云端并核对成功后记分。',true);
  });
  $('#btnRedeem').addEventListener('click', function () {
    var code = $('#inviteCode').value.trim();
    if (!code) { gateShow('invite', '请先填写邀请码。', true); return; }
    var password = $('#regPassword').value;
    if (password.length < 6 || password.length > 128 || password !== $('#regConfirm').value) { gateShow('invite', '密码需为 6–128 位，且两次输入须一致。'); return; }
    setGateBusy(true);
    CLOUD.register($('#regUsername').value.trim(), password, $('#regName').value.trim(), code).then(function () {
      setGateBusy(false);
      $('#regPassword').value = ''; $('#regConfirm').value = ''; $('#inviteCode').value = '';
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
    refreshCloud().then(function (verified) { if(verified)return CLOUD.flush(); }).catch(function (e) {
      alert('同步失败：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnPullCloud').addEventListener('click', function () {
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再拉取。'); return; }
    if (!confirm('用云端的记录覆盖这台设备上的记录？\n\n本机现在的分数会被替换掉（云端记录是同一账号在别的设备上存的那份）。')) return;
    if (CLOUD.cancelPending && !CLOUD.cancelPending()) {
      alert('正在上传记录，请等待同步结束后再拉取。'); return;
    }
    var pullStartedAt = S.updatedAt;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };
    CLOUD.pull().then(function (rec) {
      if (S.updatedAt !== pullStartedAt) { alert('拉取期间记录已改变，本次未覆盖，请重试。'); return; }
      if (!rec || !rec.data || !rec.data.classes) { alert('云端还没有这个账号的记录。'); return; }
      S = migrate(JSON.parse(JSON.stringify(rec.data)));
      if (CLOUD.acceptRemote) CLOUD.acceptRemote(rec);
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
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再上传。'); return; }
    if (!confirm('把这台设备上的记录传到云端，覆盖云端那一份？')) return;
    var upload = CLOUD.forcePush ? CLOUD.forcePush(function () { return S; }) : (CLOUD.touch(function () { return S; }), CLOUD.flush());
    upload.then(function () { alert('已经上传到云端。'); }).catch(function (e) {
      alert('上传失败，记录仍保存在当前设备：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnSignOut').addEventListener('click', function () {
    if (!confirm('退出登录？\n\n未同步的记录仅保存在当前浏览器，建议先确认同步成功或下载备份。下次用同一教师账号登录可继续。')) return;
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
  function bootCloud() {
    if (!CLOUD) { gateShow('login','云端组件未加载，暂停编辑，请刷新重试。',true); return; }
    gateShow('login', '正在连接账号服务…', true);
    CLOUD.boot({
      onReady: function (profile, rec) { renderUserBox(profile); startApp(profile, rec); },
      onNeedLogin: function (msg) {
        document.body.classList.add('gated');
        renderUserBox(null);
        gateShow('login', msg ? ('登录没能完成：' + msg) : null);
      },
      onOffline: function (why) {offlineWhy=why;document.body.classList.add('gated');renderUserBox(null);$('#btnLocalOnly').hidden=true;gateShow('login','无法核对云端，暂停编辑。请恢复连接后刷新重试。本机未上传改动仍保留。',true);}

    });
  }
  bootCloud();
})();
