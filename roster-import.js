/* CSV 名单导入：解析时不改存档，全部校验通过后才返回新状态。 */
(function (global) {
  'use strict';
  function csv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted) quoted = false;
        else if (!cell) quoted = true;
        else throw new Error('CSV 引号格式不正确。');
      } else if (!quoted && (ch === ',' || ch === '\t')) { row.push(cell.trim()); cell = ''; }
      else if (!quoted && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); cell = '';
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (quoted) throw new Error('CSV 有未闭合的引号。');
    row.push(cell.trim());
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    if (rows.length < 2) throw new Error('名单为空。');
    var header = rows.shift();
    ['班级', '姓名', '学号'].forEach(function (key) { if (header.indexOf(key) < 0) throw new Error('名单缺少列：' + key); });
    if (new Set(header).size !== header.length) throw new Error('表头列名重复。');
    return rows.map(function (values, index) {
      if (values.length !== header.length) throw new Error('第 ' + (index + 2) + ' 行列数不正确。');
      var item = {};
      header.forEach(function (key, col) { item[key] = values[col]; });
      return item;
    });
  }
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function apply(state, rows, teacher) {
    var next = JSON.parse(JSON.stringify(state));
    var byClass = Object.create(null);
    rows.forEach(function (row) {
      var cls = row['班级'], name = row['姓名'], sid = row['学号'];
      if (!cls || cls.length > 80 || !name || name.length > 60 || !/^\d{1,24}$/.test(sid || '')) {
        throw new Error('班级、姓名不能为空，学号须为 1–24 位数字。');
      }
      if (!Object.prototype.hasOwnProperty.call(byClass, cls)) byClass[cls] = [];
      byClass[cls].push(row);
    });
    var added = 0;
    Object.keys(byClass).forEach(function (className) {
      var items = byClass[className];
      if (items.length > 1000) throw new Error('单班人数不能超过 1000。');
      var existing = next.classes.filter(function (c) { return c.name === className; })[0];
      if (existing && next.lessons.some(function (l) { return l.classId === existing.id; })) {
        throw new Error(className + ' 已有课次，不能直接替换名单。请备份后使用新的班级名。');
      }
      var roster = [], groups = {}, sids = {}, numbers = {};
      items.forEach(function (item, index) {
        var no = item['班内序号'] ? Number(item['班内序号']) : index + 1;
        var group = item['小组'] ? Number(item['小组']) : 0;
        if (!Number.isInteger(no) || no < 1 || no > 10000 || numbers[no]) throw new Error('班内序号无效或重复。');
        if (!Number.isInteger(group) || group < 0 || group > 50) throw new Error('小组须为 1–50 的整数，未分组留空。');
        if (sids[item['学号']]) throw new Error(className + ' 有重复学号。');
        numbers[no] = true; sids[item['学号']] = true;
        var member = { name: item['姓名'], sid: item['学号'], no: no };
        roster.push(member);
        if (group) {
          groups[group] = groups[group] || [];
          groups[group].push({ id: uid('m'), name: member.name, sid: member.sid, no: no });
          if (groups[group].length > 7) throw new Error(className + ' 第 ' + group + ' 组超过 7 人。');
        }
      });
      var count = Math.max.apply(null, [existing ? existing.groups.length : 13].concat(Object.keys(groups).map(Number)));
      var cls = { id: existing ? existing.id : uid('c'), name: className, teacher: teacher || '',
        roster: roster, groups: [] };
      for (var n = 1; n <= count; n++) cls.groups.push({ id: uid('g'), no: n, members: groups[n] || [] });
      if (existing) next.classes[next.classes.indexOf(existing)] = cls;
      else next.classes.push(cls);
      added += roster.length;
    });
    if (!added) throw new Error('名单为空。');
    next.undo = [];
    return { state: next, students: added, classes: Object.keys(byClass).length };
  }
  function workbook(data) {
    if (!global.XLSX) throw new Error('Excel 组件未加载，请刷新网页。');
    var book = global.XLSX.read(data, { type: 'array', cellText: true });
    var all = [], skipped = [];
    book.SheetNames.forEach(function (name) {
      var rows = global.XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: '' });
      if (!rows.some(function(r){return r.some(function(v){return String(v).trim();});})) return;
      rows=rows.map(function(r){return r.map(function(v){return String(v).trim();});});
      var start = rows.findIndex(function(r){return ['姓名','学号'].every(function(k){return r.indexOf(k)>=0;});});
      if(start<0){skipped.push(name);return;}
      var meta=rows.slice(0,start).map(function(r){return r.join(' ');}).join(' ');
      var classMatch=meta.match(/班级\s*[：:]\s*([^\s，,；;]+)/);
      var header=rows[start].map(function(v){return String(v).trim();});
      var used=header.filter(function(k){return ['班级','姓名','学号','小组','班内序号','序号'].indexOf(k)>=0;});
      if(new Set(used).size!==used.length) throw new Error('工作表表头重复。');
      rows.slice(start+1).forEach(function(r){
        if(!r.some(function(v){return String(v).trim();}))return;
        if(!r[header.indexOf('学号')]&&!r[header.indexOf('姓名')])return;
        var item={}; header.forEach(function(k,i){if(used.indexOf(k)>=0)item[k]=String(r[i] == null ? '' : r[i]).trim();});
        if(!item['班级']&&classMatch)item['班级']=classMatch[1];
        if(!item['班级'])throw new Error('工作表“'+name+'”未找到班级，请添加班级列或表头上方的“班级：名称”。');
        if(!item['班内序号']&&item['序号'])item['班内序号']=item['序号'];
        all.push(item);
      });
    });
    if(!all.length)throw new Error('没有找到学生名单页。请确保至少一页含姓名、学号表头；原始考勤表可在表头上方写班级：名称。');
    all.skippedSheets=skipped;
    return all;
  }
  global.JFDT_ROSTER = { parse: csv, workbook: workbook, apply: apply };
})(typeof window !== 'undefined' ? window : this);
