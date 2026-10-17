/* 组长评分表：每课、每组十个自定义项目，个人每项0–5分，独立于课堂小组分。 */
(function () {
  'use strict';
  var selectedGroup = 1, printing = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function key(member) { return member.sid ? 'sid:'+member.sid : 'id:'+member.id; }
  function total(scores) { return scores.some(function (n) { return n !== null && n !== undefined; }) ? scores.reduce(function (sum,n) { return sum+(n||0); },0) : '—'; }
  function csvCell(value) { var s=String(value == null ? '' : value); if (/^[=+\-@]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  window.addEventListener('afterprint',function () { if(printing) { document.body.classList.remove('print-rank'); printing=false; } });
  window.JFDT_LEADER_RENDER = function (context) {
    var root=context.root, state=context.state;
    var cls=state.classes.find(function (c) { return c.id===state.ui.classId; }) || state.classes[0];
    var lessons=state.lessons.filter(function (l) { return cls && l.classId===cls.id; }).sort(function (a,b) { return b.seq-a.seq; });
    var lesson=lessons.find(function (l) { return l.id===state.ui.lessonId; }) || lessons[0];
    root.innerHTML='<h2 class="sec-title">组内个人评分</h2><p class="note">参考组长评分表：填写项目名称，每项0–5分，最多10项；个人项目分自动汇入个人总分，与全组加分相加后减去个人扣分。</p>'+
      '<div class="card lesson-bar"><label class="field"><span>班级</span><select id="leaderClassSel">'+state.classes.map(function(c){return '<option value="'+esc(c.id)+'"'+(cls&&c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'+
      '<label class="field"><span>课次</span><select id="leaderLessonSel"'+(!lessons.length?' disabled':'')+'>'+lessons.map(function(l){return '<option value="'+esc(l.id)+'"'+(lesson&&l.id===lesson.id?' selected':'')+'>第'+l.seq+'次 · '+esc(l.date)+'</option>';}).join('')+'</select></label></div><div id="leaderSheet"></div>';
    root.querySelector('#leaderClassSel').onchange=function(){context.select(this.value,null);};
    root.querySelector('#leaderLessonSel').onchange=function(){context.select(cls.id,this.value);};
    var sheet=root.querySelector('#leaderSheet');
    if(!cls||!lesson) { sheet.innerHTML='<div class="card empty-hint">请先在“上课记分”新开一课，再填写个人评分。<p><button class="btn" id="leaderGoScore">前往上课记分</button></p></div>';sheet.querySelector('button').onclick=context.openScore;return; }
    var group=cls.groups.find(function(g){return g.no===selectedGroup;}) || cls.groups[0];
    if(!group) { sheet.textContent='该班还没有小组，请先导入或安排分组。';return; }
    selectedGroup=group.no;
    var record=lesson.leaderScores&&lesson.leaderScores[String(group.no)];
    if(!record) record={projects:Array(10).fill(''),members:{},signedBy:'',note:''};
    function persist() { if(!lesson.leaderScores) lesson.leaderScores={};lesson.leaderScores[String(group.no)]=record;context.save(); }
    function scores(member) { return record.members[key(member)] || Array(10).fill(null); }
    var members=group.members.filter(function(m){return m.name;});
    var head='<tr><th>序号</th><th>成员 / 完整学号</th>'+record.projects.map(function(p,i){return '<th><input class="leader-project" data-project="'+i+'" aria-label="评分项目'+(i+1)+'" maxlength="80" placeholder="项目'+(i+1)+'" value="'+esc(p)+'"></th>';}).join('')+'<th>小计</th></tr>';
    var body=members.map(function(m,row){var values=scores(m);return '<tr><td>'+(row+1)+'</td><td class="leader-member">'+esc(m.name)+'<small>'+esc(m.sid||'未填写学号')+'</small></td>'+values.map(function(n,col){return '<td><input type="number" class="leader-number" data-member="'+esc(key(m))+'" data-item="'+col+'" aria-label="'+esc(m.name)+' 项目'+(col+1)+'" min="0" max="5" step="1" value="'+(n==null?'':n)+'"></td>';}).join('')+'<td class="leader-total" data-total-key="'+esc(key(m))+'">'+total(values)+'</td></tr>';}).join('');
    sheet.innerHTML='<div class="card"><div class="btnrow"><label class="field"><span>小组</span><select id="leaderGroupSel">'+cls.groups.map(function(g){return '<option value="'+g.no+'"'+(g.no===group.no?' selected':'')+'>第'+g.no+'组（'+g.members.filter(function(m){return m.name;}).length+'人）</option>';}).join('')+'</select></label><button class="btn" id="leaderPrint">打印本组评分表</button><button class="btn" id="leaderExport">导出本组CSV</button></div><p class="note">课次：第'+lesson.seq+'次 · '+esc(lesson.date)+'　任务：'+esc(lesson.topic)+'</p><div class="tablewrap"><table class="leader-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+(!members.length?'<p class="note">本组暂无成员。已确定名单和分组后，成员会出现在这里。</p>':'')+'<label class="field"><span>组长 / 复核人</span><input id="leaderSignedBy" maxlength="100" value="'+esc(record.signedBy)+'"></label><label class="field col"><span>备注</span><textarea id="leaderNote" maxlength="500">'+esc(record.note)+'</textarea></label><p id="leaderFeedback" class="note" role="status">填写后自动保存，随教师账号同步。</p></div>';
    sheet.querySelector('#leaderGroupSel').onchange=function(){selectedGroup=+this.value;window.JFDT_LEADER_RENDER(context);};
    sheet.querySelectorAll('[data-project]').forEach(function(input){input.onchange=function(){record.projects[+input.dataset.project]=input.value.trim();persist();};});
    sheet.querySelectorAll('[data-member]').forEach(function(input){input.onchange=function(){
      var value=input.value===''?null:Number(input.value), id=input.dataset.member, index=+input.dataset.item;
      if(value!==null&&(!Number.isInteger(value)||value<0||value>5)){input.value=(record.members[id]||[])[index]??'';sheet.querySelector('#leaderFeedback').textContent='每项请填写0–5的整数，或留空。';return;}
      if(!record.members[id])record.members[id]=Array(10).fill(null);
      record.members[id][index]=value;persist();
      sheet.querySelectorAll('[data-total-key]').forEach(function(td){if(td.dataset.totalKey===id)td.textContent=total(record.members[id]);});
      sheet.querySelector('#leaderFeedback').textContent='已保存，正在随账号同步。';
    };});
    sheet.querySelector('#leaderSignedBy').onchange=function(){record.signedBy=this.value.trim();persist();};
    sheet.querySelector('#leaderNote').onchange=function(){record.note=this.value;persist();};
    sheet.querySelector('#leaderExport').onclick=function(){
      var rows=[['班级','课次','小组','姓名','学号'].concat(record.projects.map(function(p,i){return p||'项目'+(i+1);})).concat(['小计'])];
      members.forEach(function(m){rows.push([cls.name,lesson.seq,group.no,m.name,m.sid||''].concat(scores(m)).concat([total(scores(m))]));});
      var blob=new Blob(['\uFEFF'+rows.map(function(row){return row.map(csvCell).join(',');}).join('\r\n')],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url;a.download=cls.name+'_第'+group.no+'组_个人评分.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    };
    sheet.querySelector('#leaderPrint').onclick=function(){
      var headers='<tr><th>序号</th><th>成员 / 学号</th>'+record.projects.map(function(p,i){return '<th>'+esc(p||'项目'+(i+1))+'</th>';}).join('')+'<th>小计</th></tr>';
      var rows=members.map(function(m,i){return '<tr><td>'+(i+1)+'</td><td>'+esc(m.name)+'<br>'+esc(m.sid||'')+'</td>'+scores(m).map(function(n){return '<td>'+(n==null?'':n)+'</td>';}).join('')+'<td>'+total(scores(m))+'</td></tr>';}).join('');
      document.querySelector('#printArea').innerHTML='<div class="leader-print"><h2>组长课堂评分表</h2><p>'+esc(cls.name)+' · 第'+group.no+'组 · 第'+lesson.seq+'次课 · '+esc(lesson.date)+'</p><p>每项0–5分，项目由组长填写，教师复核。</p><table class="leader-table"><thead>'+headers+'</thead><tbody>'+rows+'</tbody></table><p>组长 / 复核人：'+esc(record.signedBy||'________________')+'</p><p>备注：'+esc(record.note)+'</p></div>';
      document.body.classList.remove('print-lesson');document.body.classList.add('print-rank');printing=true;window.print();
    };
  };
})();
