/* 组长评分表：每课、每组十个自定义项目，个人每项0–5分，独立于课堂小组分。 */
(function () {
  'use strict';
  var selectedGroup = 1, printing = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function key(member) { return member.sid ? 'sid:'+member.sid : 'id:'+member.id; }
  function total(scores) { return scores.some(function (n) { return n !== null && n !== undefined; }) ? scores.reduce(function (sum,n) { return sum+(n||0); },0) : '—'; }
  function csvCell(value) { var s=String(value == null ? '' : value); if (/^[=+\-@]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  window.addEventListener('afterprint',function () { if(printing) { document.body.classList.remove('print-rank','print-leader'); printing=false; } });
  function printableGroup(cls,lesson,g){var r=lesson.leaderScores&&lesson.leaderScores[String(g.no)]||{projects:Array(10).fill(''),members:{},signedBy:'',note:''};var projects=Array.from({length:10},function(_,i){return r.projects[i]||'';});return '<section class="leader-slip"><h2>组长课堂评分表</h2><p class="slip-meta">'+esc(cls.name)+' · 第'+g.no+'组 · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><p class="slip-rule">每项0–5分；空白项目由组长手写，教师复核。</p><table class="leader-table"><colgroup><col style="width:6%"><col style="width:22%">'+projects.map(function(){return '<col style="width:6.5%">';}).join('')+'<col style="width:7%"></colgroup><thead><tr><th>序号</th><th>成员 / 学号</th>'+projects.map(function(v){return '<th>'+esc(v)+'</th>';}).join('')+'<th>小计</th></tr></thead><tbody>'+g.members.filter(function(m){return m.name;}).map(function(m,i){var scores=r.members[key(m)]||Array(10).fill(null),sum=total(scores);return '<tr><td>'+(i+1)+'</td><td class="slip-member">'+esc(m.name)+'<small>'+esc(m.sid||'')+'</small></td>'+projects.map(function(_,j){return '<td>'+(scores[j]==null?'':scores[j])+'</td>';}).join('')+'<td>'+(sum==='—'?'':sum)+'</td></tr>';}).join('')+'</tbody></table><p class="slip-sign">组长 / 复核人：'+esc(r.signedBy||'________________')+'</p><p class="slip-note">备注：'+esc(r.note||'')+'</p></section>';}
  function printSheets(cls,lesson,groups,perPage){var pages=[];for(var i=0;i<groups.length;i+=perPage)pages.push('<div class="leader-paper '+(perPage===2?'two-slips':'one-slip')+'">'+groups.slice(i,i+perPage).map(function(g){return printableGroup(cls,lesson,g);}).join('')+'</div>');return '<div class="leader-print-batch">'+pages.join('')+'</div>';}
  window.JFDT_LEADER_PRINT_HTML=printSheets;
  var printDialog=document.createElement('dialog');printDialog.id='dlgLeaderPrint';printDialog.innerHTML='<form method="dialog"><h2>打印组长评分表</h2><label class="field col">范围<select id="leaderPrintScope"><option value="all">本课全部小组</option><option value="current">当前小组</option></select></label><label class="field col">A4竖向排版<select id="leaderPrintLayout"><option value="2">每页两个组 · 对半裁开</option><option value="1">每组一页</option></select></label><p class="note">未命名项目留空供手写。建议关闭浏览器页眉页脚，按100%比例打印。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(printDialog);var printSelection=null;
  printDialog.addEventListener('close',function(){if(printDialog.returnValue!=='ok'||!printSelection)return;var c=printSelection,groups=document.querySelector('#leaderPrintScope').value==='all'?c.cls.groups:[c.group];document.querySelector('#printArea').innerHTML=printSheets(c.cls,c.lesson,groups,Number(document.querySelector('#leaderPrintLayout').value));document.body.classList.remove('print-lesson','print-rank');document.body.classList.add('print-leader');printing=true;window.print();});
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
    function log(detail) { if(context.log) context.log(cls.name+' · 第'+lesson.seq+'次课 · 第'+group.no+'组 · '+detail); }
    function scores(member) { return record.members[key(member)] || Array(10).fill(null); }
    var members=group.members.filter(function(m){return m.name;});
    var head='<tr><th>序号</th><th>成员 / 完整学号</th>'+record.projects.map(function(p,i){return '<th><input class="leader-project" data-project="'+i+'" aria-label="评分项目'+(i+1)+'" maxlength="80" placeholder="项目'+(i+1)+'" value="'+esc(p)+'"></th>';}).join('')+'<th>小计</th></tr>';
    var body=members.map(function(m,row){var values=scores(m);return '<tr><td>'+(row+1)+'</td><td class="leader-member">'+esc(m.name)+'<small>'+esc(m.sid||'未填写学号')+'</small></td>'+values.map(function(n,col){return '<td><input type="number" class="leader-number" data-member="'+esc(key(m))+'" data-item="'+col+'" aria-label="'+esc(m.name)+' 项目'+(col+1)+'" min="0" max="5" step="1" value="'+(n==null?'':n)+'"></td>';}).join('')+'<td class="leader-total" data-total-key="'+esc(key(m))+'">'+total(values)+'</td></tr>';}).join('');
    sheet.innerHTML='<div class="card"><div class="btnrow"><label class="field"><span>小组</span><select id="leaderGroupSel">'+cls.groups.map(function(g){return '<option value="'+g.no+'"'+(g.no===group.no?' selected':'')+'>第'+g.no+'组（'+g.members.filter(function(m){return m.name;}).length+'人）</option>';}).join('')+'</select></label><button class="btn" id="leaderPrint">打印本组评分表</button><button class="btn" id="leaderExport">导出本组CSV</button></div><p class="note">课次：第'+lesson.seq+'次 · '+esc(lesson.date)+'　任务：'+esc(lesson.topic)+'</p><div class="tablewrap"><table class="leader-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+(!members.length?'<p class="note">本组暂无成员。已确定名单和分组后，成员会出现在这里。</p>':'')+'<label class="field"><span>组长 / 复核人</span><input id="leaderSignedBy" maxlength="100" value="'+esc(record.signedBy)+'"></label><label class="field col"><span>备注</span><textarea id="leaderNote" maxlength="500">'+esc(record.note)+'</textarea></label><p id="leaderFeedback" class="note" role="status">填写后自动保存，随教师账号同步。</p></div>';
    sheet.querySelector('#leaderGroupSel').onchange=function(){selectedGroup=+this.value;window.JFDT_LEADER_RENDER(context);};
    sheet.querySelectorAll('[data-project]').forEach(function(input){input.onchange=function(){var old=record.projects[+input.dataset.project], next=input.value.trim(); if(old===next)return; record.projects[+input.dataset.project]=next; log('项目'+(+input.dataset.project+1)+'名称：'+(old||'空')+' → '+(next||'空'));persist();};});
    sheet.querySelectorAll('[data-member]').forEach(function(input){input.onchange=function(){
      var value=input.value===''?null:Number(input.value), id=input.dataset.member, index=+input.dataset.item;
      if(value!==null&&(!Number.isInteger(value)||value<0||value>5)){input.value=(record.members[id]||[])[index]??'';sheet.querySelector('#leaderFeedback').textContent='每项请填写0–5的整数，或留空。';return;}
      if(!record.members[id])record.members[id]=Array(10).fill(null);
      var old=record.members[id][index]; if(old===value)return;
      record.members[id][index]=value; var member=members.find(function(m){return key(m)===id;});
      log((member?member.name:'成员')+' · '+(record.projects[index]||('项目'+(index+1)))+'：'+(old==null?'未填':old)+' → '+(value==null?'未填':value));persist();
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
    sheet.querySelector('#leaderPrint').textContent='打印评分表';
    sheet.querySelector('#leaderPrint').onclick=function(){printSelection={cls:cls,lesson:lesson,group:group};printDialog.returnValue='';if(printDialog.showModal)printDialog.showModal();else printDialog.setAttribute('open','');};
  };
})();
