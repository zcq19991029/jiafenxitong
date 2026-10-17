/* Criterion-based regular grades; raw points and attendance history remain unchanged. */
(function (root) {
  'use strict';
  var defaults = {totalLessons:24, late:1, truant:3, leave:0, early:1, passScore:60, taskTarget:0, bonusCap:5, customRules:[]};
  var labels = {present:'正常出勤',late:'迟到',truant:'旷课',leave:'请假',early:'早退'};
  function esc(v) { return String(v == null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function round(n) { return Math.round((n+Number.EPSILON)*10)/10; }
  function key(m) { return m.sid?'sid:'+m.sid:m.id?'id:'+m.id:m.no!=null?'no:'+m.no:'name:'+m.name; }
  function settings(cls) {
    var cfg=Object.assign({},defaults,cls.assessmentSettings||{});
    ['totalLessons','late','truant','leave','early','passScore'].forEach(function(k){var max=k==='totalLessons'?1000:100,min=k==='totalLessons'?1:0;if(!Number.isInteger(cfg[k])||cfg[k]<min||cfg[k]>max)cfg[k]=defaults[k];});
    if(!Number.isFinite(cfg.taskTarget)||cfg.taskTarget<0||cfg.taskTarget>100000)cfg.taskTarget=0;
    if(!Number.isFinite(cfg.bonusCap)||cfg.bonusCap<0||cfg.bonusCap>5)cfg.bonusCap=5;
    cfg.customRules=Array.isArray(cfg.customRules)?cfg.customRules.filter(function(r){return r&&typeof r.id==='string'&&typeof r.name==='string'&&Number.isInteger(r.loss)&&r.loss>=0&&r.loss<=100;}).slice(0,20):[];
    return cfg;
  }
  function roster(cls,raw) {
    var map=new Map();
    cls.groups.forEach(function(g){g.members.forEach(function(m){if(m.name)map.set(key(m),Object.assign({},m,{gno:g.no}));});});
    (cls.roster||[]).forEach(function(m){if(m.name && !map.has(key(m)))map.set(key(m),Object.assign({},m,{gno:0}));});
    return Array.from(map.values()).map(function(m){var r=(raw||[]).find(function(r){return r.gno===m.gno && r.name===m.name && r.sid===m.sid;});return Object.assign({},m,{key:key(m),groupScore:r?r.groupScore:0,project:r?r.project:0,personal:r?r.personal:0,total:r?r.total:0});});
  }
  function deduction(status,cfg) {
    if(status==='present')return 0;
    if(Object.prototype.hasOwnProperty.call(labels,status))return Number(cfg[status])||0;
    var rule=(cfg.customRules||[]).find(function(r){return r.id===status;});return rule?rule.loss:0;
  }
  function statusName(status,cfg) { var r=(cfg.customRules||[]).find(function(r){return r.id===status;});return labels[status]||(r&&r.name)||status; }
  function taskEvidence(lessons,m,cfg) {
    var earned=0,maximum=0,pending=0,planned=0;
    lessons.forEach(function(l){
      var records=l.leaderScores||{},record=records[String(m.gno)];
      if(!record){record=Object.values(records).slice().sort(function(a,b){return b.projects.filter(Boolean).length-a.projects.filter(Boolean).length;})[0];}
      if(!record)return;
      var values=records[String(m.gno)]&&records[String(m.gno)].members[m.key];
      record.projects.forEach(function(name,index){if(!String(name||'').trim())return;planned+=5;
        var n=values&&values[index];
        if(n===null||n===undefined){pending++;return;}
        maximum+=5;earned+=Math.max(0,Math.min(5,Number(n)||0));
      });
    });
    if(cfg.taskTarget>0){maximum=cfg.taskTarget;earned=Math.max(0,m.project);}
    return {earned:earned,maximum:maximum,pending:pending,planned:planned,rate:maximum>0?Math.max(0,Math.min(1,earned/maximum)):0};
  }
  function rows(cls,lessons,raw) {
    var cfg=settings(cls),students=roster(cls,raw),sorted=students.slice().sort(function(a,b){return b.total-a.total||String(a.sid||a.no||a.name).localeCompare(String(b.sid||b.no||b.name),undefined,{numeric:true});});
    var previous=null,rank=0;
    sorted.forEach(function(m,i){
      if(i===0||m.total!==previous)rank=i+1;previous=m.total;
      m.rawRank=rank;m.task=taskEvidence(lessons,m,cfg);
      m.bonus=Math.max(-cfg.bonusCap,Math.min(cfg.bonusCap,m.groupScore));
      m.learning=round(40+Math.max(0,Math.min(40,40*m.task.rate+m.bonus-m.personal)));
      m.confirmation=(cls.foundationChecks||{})[m.key]||'pending';
      var loss=0,recorded=0;
      lessons.forEach(function(l){var a=l.attendance&&l.attendance[m.key];if(a){recorded++;loss+=Number(a.loss)||0;}});
      m.loss=loss;m.recorded=recorded;
      m.attendance=round(Math.max(0,Math.min(20,20*(cfg.totalLessons-loss)/cfg.totalLessons)));
      m.ready=m.confirmation==='met'&&m.task.pending===0&&m.task.maximum>0&&m.recorded===lessons.length&&lessons.length>0;
      m.regular=round(m.learning+m.attendance);m.contribution=round(m.regular*.4);
      m.needed=Math.max(0,Math.ceil(((cfg.passScore-m.contribution)/.6-1e-9)*10)/10);
      var exam=cls.examScores&&cls.examScores[m.key];m.exam=exam==null?'':exam;m.final=m.exam===''?null:round(m.contribution+m.exam*.6);
    });
    sorted.sort(function(a,b){return b.regular-a.regular||a.rawRank-b.rawRank||String(a.sid||a.name).localeCompare(String(b.sid||b.name));});
    previous=null;rank=0;sorted.forEach(function(m,i){if(i===0||m.regular!==previous)rank=i+1;previous=m.regular;m.rank=rank;});return sorted;
  }
  function options(cfg,value) {
    var statuses=Object.keys(labels).concat((cfg.customRules||[]).map(function(r){return r.id;}));
    return '<option value="">未记录</option>'+statuses.map(function(status){var loss=deduction(status,cfg);return '<option value="'+esc(status)+'"'+(status===value?' selected':'')+'>'+esc(statusName(status,cfg))+' · '+(loss?'扣'+loss+'单位':'不扣')+'</option>';}).join('')+(value&&!statuses.includes(value)?'<option selected value="'+esc(value)+'">历史原因（保留）</option>':'');
  }
  function confirmationText(m) {return m.confirmation==='met'?'基础要求已满足':m.confirmation==='makeup'?'待补做':'基础要求待确认';}
  function renderRank(ctx) {
    var cls=ctx.cls,cfg=settings(cls),ms=rows(cls,ctx.lessons,ctx.raw);
    ctx.root.innerHTML='<details class="rank-note"><summary>达标赋分说明：正常完成至少60分，名次不决定赋分</summary><p>原始累计 = 全组累计加分 + 个人项目累计分 − 个人扣分，原记录保留。学习分 = 40基础 + clamp(40×任务达成率 + 有限小组奖励 − 个人扣分, 0, 40)，封顶80；再加考勤0–20得到平时分。小组奖励最多'+cfg.bonusCap+'分，全部同学都达标可以一起得高分。</p><p>达成率按本人已评分项目得分/满分计算，每个命名项目满分5；明确0分计入，未批改不当0分且标记待批改。手动基准为'+(cfg.taskTarget||'自动按已评分项目')+'。基础要求由教师确认，不自动把未做任务的学生判定及格；项目未齐、考勤未齐或基础未确认都只显示预估。考勤未记录按正常预估，不伪造签到。平时40%＋期末60%。</p></details><div class="assessment-actions"><button class="btn" id="assessmentGoAttendance">考勤与规则</button><button class="btn" id="assessmentExport">导出综合成绩CSV</button></div><div class="assessment-scroll"><table class="data assessment-table"><thead><tr><th>展示名次</th><th>姓名 / 基础要求</th><th>小组</th><th>当前累计</th><th>学习赋分/80</th><th>考勤/20</th><th>平时分/100</th><th>折合/40</th><th>期末需考/100</th><th>实际期末</th><th>综合/100</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td><b>'+esc(m.name)+'</b><small>'+esc(m.sid||m.no||'')+'</small><select class="foundation-check" data-foundation-key="'+esc(m.key)+'" aria-label="'+esc(m.name)+' 基础要求"><option value="pending"'+(m.confirmation==='pending'?' selected':'')+'>待确认</option><option value="met"'+(m.confirmation==='met'?' selected':'')+'>已满足</option><option value="makeup"'+(m.confirmation==='makeup'?' selected':'')+'>待补做</option></select></td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><b>'+m.total+'</b><small>全组 '+m.groupScore+' · 个人项目分 '+m.project+' · 扣 '+m.personal+'</small></td><td>'+m.learning+'<small>任务 '+m.task.earned+'/'+m.task.maximum+' · '+round(m.task.rate*100)+'%<br>小组奖励 '+m.bonus+(m.task.pending?' · '+m.task.pending+'项待批改':'')+(!m.task.maximum?' · 未设置有效任务':'')+'</small></td><td>'+m.attendance+'<small>'+m.recorded+'/'+ctx.lessons.length+'课已登记 · 扣'+m.loss+'单位</small></td><td><b>'+m.regular+'</b>'+(!m.ready?'<small>预估 · '+confirmationText(m)+'</small>':'<small>资料已齐</small>')+'</td><td>'+m.contribution+'</td><td>'+(m.needed>100?'超过100，无法达到':m.needed)+(!m.ready?'<small>预估</small>':'')+'</td><td><input class="assessment-exam" aria-label="'+esc(m.name)+' 实际期末成绩" data-exam-key="'+esc(m.key)+'" type="number" min="0" max="100" step="0.1" value="'+m.exam+'" placeholder="待考"></td><td>'+(m.final==null?'—':m.final)+(!m.ready&&m.final!==null?'<small>待复核</small>':'')+'</td></tr>';}).join('')+'</tbody></table></div><p class="rank-note">正常出勤且基础要求已满足时，平时分最低60；考勤扣分可低于60。零分不自动等于已达标。排名仅展示，不改变他人分数。及格线'+cfg.passScore+'，期末需考向上取到0.1分。含待分配'+ms.length+'人，计划'+cfg.totalLessons+'课。</p>';
    ctx.root.querySelector('#assessmentGoAttendance').onclick=ctx.openAttendance;
    ctx.root.querySelectorAll('[data-foundation-key]').forEach(function(input){input.onchange=function(){if(!cls.foundationChecks)cls.foundationChecks={};cls.foundationChecks[input.dataset.foundationKey]=input.value;var m=ms.find(function(m){return m.key===input.dataset.foundationKey;});ctx.log('基础要求确认',cls.name+' · '+m.name+' → '+input.options[input.selectedIndex].textContent);ctx.save();renderRank(ctx);};});
    ctx.root.querySelectorAll('[data-exam-key]').forEach(function(input){input.onchange=function(){var v=input.value===''?null:Number(input.value);if(v!==null&&(!Number.isFinite(v)||v<0||v>100)){ctx.message('期末成绩须为0–100分。');return;}var old=cls.examScores&&cls.examScores[input.dataset.examKey];if(!cls.examScores)cls.examScores={};if(v===null)delete cls.examScores[input.dataset.examKey];else cls.examScores[input.dataset.examKey]=v;ctx.log('期末成绩',cls.name+' · '+ms.find(function(m){return m.key===input.dataset.examKey;}).name+'：'+(old==null?'未填':old)+' → '+(v===null?'未填':v));ctx.save();renderRank(ctx);};});
    ctx.root.querySelector('#assessmentExport').onclick=function(){ctx.export(cls.name+'_综合成绩.csv',[['展示名次','姓名','学号','小组','原始累计','任务得分','任务满分','待批改数','达成率','有限小组奖励','学习赋分/80','考勤/20','平时分/100','折合/40','期末需考','实际期末','综合/100','基础要求','资料齐全']].concat(ms.map(function(m){return [m.rank,m.name,m.sid||m.no||'',m.gno||'待分配',m.total,m.task.earned,m.task.maximum,m.task.pending,round(m.task.rate*100)+'%',m.bonus,m.learning,m.attendance,m.regular,m.contribution,m.needed>100?'超过100':m.needed,m.exam,m.final==null?'':m.final,confirmationText(m),m.ready?'是':'否，预估待复核'];})));};
  }
  function renderAttendance(ctx) {
    var cls=ctx.cls,cfg=settings(cls),students=roster(cls,ctx.raw),lesson=ctx.lesson;
    ctx.root.innerHTML='<h2 class="sec-title">考勤与扣分设置</h2><div class="card lesson-bar"><label class="field">班级<select id="attendanceClassSel">'+ctx.classes.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label><label class="field">课次<select id="attendanceLessonSel"'+(!ctx.lessons.length?' disabled':'')+'>'+(!ctx.lessons.length?'<option>暂无课次</option>':ctx.lessons.map(function(l){return '<option value="'+esc(l.id)+'"'+(lesson&&l.id===lesson.id?' selected':'')+'>第'+l.seq+'次 · '+esc(l.date)+'</option>';}).join(''))+'</select></label></div><details class="card assessment-settings"><summary>本班赋分与考勤规则</summary><form id="assessmentSettingsForm"><div class="assessment-settings-grid">'+[['totalLessons','本学期计划课次',1,1000],['late','迟到扣课节单位',0,100],['truant','旷课扣课节单位',0,100],['leave','请假扣课节单位',0,100],['early','早退扣课节单位',0,100],['passScore','综合及格线',0,100],['taskTarget','手动任务满分（0为自动）',0,100000],['bonusCap','小组奖励上限（最多5）',0,5]].map(function(f){return '<label class="field col">'+f[1]+'<input name="'+f[0]+'" type="number" step="1" min="'+f[2]+'" max="'+f[3]+'" value="'+cfg[f[0]]+'" required></label>';}).join('')+'</div><p class="note">考勤分 = max(0, 20 × (计划课次 − 累计扣单位) ÷ 计划课次)。旧考勤保留当时扣单位，规则修改仅用于之后登记；如需调整旧记录，请在对应课次重新保存。学习40基础+40任务表现（含最多5分小组奖励），正常考勤20，平时40%+期末60%。手动满分为0时按命名且已评分项目计算，空白待批改不会当0。</p><button type="submit" class="btn primary">保存本班规则</button></form><h4>自定义原因</h4><div id="attendanceCustomRules">'+(cfg.customRules||[]).map(function(r){return '<span class="attendance-rule">'+esc(r.name)+' · 扣'+r.loss+'单位 <button class="btn tiny" data-remove-rule="'+esc(r.id)+'" title="停用规则，历史记录保留">停用</button></span>';}).join('')+'</div><form id="attendanceCustomForm" class="btnrow"><input id="attendanceCustomName" aria-label="自定义考勤原因" maxlength="40" placeholder="例如：未到原因" required><input id="attendanceCustomLoss" aria-label="自定义扣单位" type="number" min="0" max="100" step="1" value="1" required><button class="btn" type="submit">添加原因</button></form></details><p class="note">按课次保存，包含未分组人员。未登记不伪造出勤记录；修改此表只影响考勤模块，不重复扣课堂积分。</p>'+(lesson?'<div class="card"><div class="assessment-actions"><input id="attendanceSearch" aria-label="搜索考勤学生" placeholder="姓名 / 学号"><label><input id="attendanceSelectAll" type="checkbox">全选可见</label><select id="attendanceBatchStatus" aria-label="批量考勤状态">'+options(cfg,'')+'</select><button id="attendanceApplyBatch" class="btn">应用到所选</button><button id="attendanceSave" class="btn primary">保存本课考勤</button></div><p id="attendanceDirty" class="note" role="status">没有未保存的改动。</p><div class="assessment-scroll"><table class="data attendance-table"><thead><tr><th>选择</th><th>姓名</th><th>学号</th><th>小组</th><th>本课状态</th><th>已保存扣单位</th></tr></thead><tbody>'+students.map(function(m){var a=lesson.attendance&&lesson.attendance[m.key];return '<tr data-att-row><td><input type="checkbox" data-att-check="'+esc(m.key)+'" aria-label="选择'+esc(m.name)+'"></td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><select data-att-key="'+esc(m.key)+'" aria-label="'+esc(m.name)+' 考勤">'+options(cfg,a&&a.status)+'</select>'+(a&&!labels[a.status]&&!(cfg.customRules||[]).some(function(r){return r.id===a.status;})?'<small>历史原因：'+esc(a.label)+'（保留）</small>':'')+'</td><td>'+(a?a.loss:'—')+'</td></tr>';}).join('')+'</tbody></table></div></div>':'<p class="card">请先在上课记分中新开一课，再登记考勤。</p>');
    var dirty=false,changed=new Set();
    function mark(){dirty=true;var el=ctx.root.querySelector('#attendanceDirty');if(el)el.textContent='有未保存的考勤改动，请点击保存本课考勤。';}
    function guard(){if(dirty){ctx.message('请先保存本课考勤，再切换班级或课次。');return false;}return true;}
    ctx.root.querySelector('#attendanceClassSel').onchange=function(){if(!guard()){this.value=cls.id;return;}ctx.select(this.value,null);};
    ctx.root.querySelector('#attendanceLessonSel').onchange=function(){if(!guard()){this.value=lesson.id;return;}ctx.select(cls.id,this.value);};
    ctx.root.querySelector('#assessmentSettingsForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var next=Object.assign({},cfg);for(var name of ['totalLessons','late','truant','leave','early','passScore','taskTarget','bonusCap']){var input=this.elements.namedItem(name),v=Number(input.value);if(!Number.isInteger(v)||v<Number(input.min)||v>Number(input.max)){ctx.message('请填写范围内的整数。');return;}next[name]=v;}cls.assessmentSettings=next;cfg=next;ctx.log('考勤规则',cls.name+' · 计划'+next.totalLessons+'课；迟到'+next.late+'，旷课'+next.truant+'，请假'+next.leave+'，早退'+next.early+'单位；及格线'+next.passScore);ctx.save();ctx.message('本班规则已保存。');};
    ctx.root.querySelector('#attendanceCustomForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var name=ctx.root.querySelector('#attendanceCustomName').value.trim(),loss=Number(ctx.root.querySelector('#attendanceCustomLoss').value);if(!name||name.length>40||!Number.isInteger(loss)||loss<0||loss>100||Object.keys(labels).some(function(s){return labels[s]===name;})||(cfg.customRules||[]).some(function(r){return r.name===name;})||(cfg.customRules||[]).length>=20){ctx.message('原因须唯一，最多20项，扣单位为0–100整数。');return;}var next=Object.assign({},cfg,{customRules:(cfg.customRules||[]).concat([{id:'custom_'+Date.now().toString(36),name:name,loss:loss}])});cls.assessmentSettings=next;ctx.log('考勤规则',cls.name+' · 新增'+name+'：扣'+loss+'单位');ctx.save();renderAttendance(ctx);};
    ctx.root.querySelectorAll('[data-remove-rule]').forEach(function(b){b.onclick=function(){if(!guard())return;cls.assessmentSettings=Object.assign({},cfg,{customRules:(cfg.customRules||[]).filter(function(r){return r.id!==b.dataset.removeRule;})});ctx.log('考勤规则',cls.name+' · 停用自定义原因，历史保留');ctx.save();renderAttendance(ctx);};});
    if(!lesson)return;
    ctx.root.querySelector('#attendanceSearch').oninput=function(){var q=this.value.trim().toLowerCase();ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){tr.hidden=!tr.textContent.toLowerCase().includes(q);});};
    ctx.root.querySelector('#attendanceSelectAll').onchange=function(){var checked=this.checked;ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){if(!tr.hidden)tr.querySelector('[data-att-check]').checked=checked;});};
    ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){input.onchange=function(){changed.add(input.dataset.attKey);mark();};});
    ctx.root.querySelector('#attendanceApplyBatch').onclick=function(){var value=ctx.root.querySelector('#attendanceBatchStatus').value,count=0;ctx.root.querySelectorAll('[data-att-check]:checked').forEach(function(check){var tr=check.closest('tr');if(!tr.hidden){tr.querySelector('[data-att-key]').value=value;changed.add(check.dataset.attCheck);count++;}});if(count)mark();else ctx.message('请先选择学生。');};
    ctx.root.querySelector('#attendanceSave').onclick=function(){if(!dirty){ctx.message('没有考勤改动需要保存。');return;}if(!lesson.attendance)lesson.attendance={};var current=settings(cls),details=[];ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){var k=input.dataset.attKey;if(!changed.has(k))return;var old=lesson.attendance[k],status=input.value,m=students.find(function(m){return m.key===k;});if(status){lesson.attendance[k]={status:status,label:statusName(status,current),loss:deduction(status,current),updatedAt:new Date().toISOString()};}else delete lesson.attendance[k];details.push(m.name+'：'+(old?old.label:'未记录')+' → '+(status?statusName(status,current)+'（扣'+deduction(status,current)+'单位）':'未记录'));});ctx.log('考勤',cls.name+' · 第'+lesson.seq+'次 · '+lesson.date+' · '+details.join('；'));ctx.save();dirty=false;ctx.message('本课考勤已保存，平时分已实时重算。');renderAttendance(ctx);};
    ctx.isDirty=function(){return dirty;};
  }
  function printHtml(cls,lessons,raw) {
    var ms=rows(cls,lessons,raw);
    return '<h2>平时赋分与期末测算</h2><p>达标赋分：学习40基础＋40任务表现，考勤20；平时40%＋期末60%。名次只展示，未确认/未批改/考勤未齐为预估。</p><table><thead><tr><th>名次</th><th>姓名</th><th>学号</th><th>当前累计</th><th>学习/80</th><th>考勤/20</th><th>平时/100</th><th>折合/40</th><th>期末需考</th><th>实际期末</th><th>综合</th><th>基础要求/状态</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+m.total+'</td><td>'+m.learning+'</td><td>'+m.attendance+'</td><td>'+m.regular+'</td><td>'+m.contribution+'</td><td>'+(m.needed>100?'超过100':m.needed)+'</td><td>'+m.exam+'</td><td>'+(m.final==null?'—':m.final)+'</td><td>'+esc(confirmationText(m))+(m.ready?' · 已齐':' · 预估')+'</td></tr>';}).join('')+'</tbody></table>';
  }
  root.JFDT_ASSESSMENT={printHtml:printHtml,taskEvidence:taskEvidence,key:key,settings:settings,roster:roster,rows:rows,deduction:deduction,renderRank:renderRank,renderAttendance:renderAttendance};
})(typeof window==='undefined'?globalThis:window);
