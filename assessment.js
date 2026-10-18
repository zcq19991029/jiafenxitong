/* Criterion-based regular grades; raw points and attendance history remain unchanged. */
(function (root) {
  'use strict';
  var defaults = {totalLessons:24, late:1, truant:3, leave:0, early:1, lateEarlyConversion:3, truantFailure:3, attendanceFailureEnabled:true, passScore:60, taskTarget:0, customRules:[]};
  var labels = {present:'正常出勤',late:'迟到',truant:'旷课',leave:'请假',early:'早退'};
  function esc(v) { return String(v == null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function round(n) { return Math.round((n+Number.EPSILON)*10)/10; }
  function key(m) { return m.sid?'sid:'+m.sid:m.id?'id:'+m.id:m.no!=null?'no:'+m.no:'name:'+m.name; }
  function settings(cls) {
    var cfg=Object.assign({},defaults,cls.assessmentSettings||{});
    ['totalLessons','late','truant','leave','early','passScore'].forEach(function(k){var max=k==='totalLessons'?1000:100,min=k==='totalLessons'?1:0;if(!Number.isInteger(cfg[k])||cfg[k]<min||cfg[k]>max)cfg[k]=defaults[k];});
    if(!Number.isFinite(cfg.taskTarget)||cfg.taskTarget<0||cfg.taskTarget>100000)cfg.taskTarget=0;
    cfg.customRules=Array.isArray(cfg.customRules)?cfg.customRules.filter(function(r){return r&&typeof r.id==='string'&&typeof r.name==='string'&&Number.isInteger(r.loss)&&r.loss>=0&&r.loss<=100;}).slice(0,20):[];
    ['lateEarlyConversion','truantFailure'].forEach(function(k){if(!Number.isInteger(cfg[k])||cfg[k]<1||cfg[k]>100)cfg[k]=3;});if(typeof cfg.attendanceFailureEnabled!=='boolean')cfg.attendanceFailureEnabled=true;
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
      var projects=Array.isArray(l.leaderProjectNames)?l.leaderProjectNames:(record&&record.projects)||[];
      var values=records[String(m.gno)]&&records[String(m.gno)].members&&records[String(m.gno)].members[m.key];
      projects.forEach(function(name,index){if(!String(name||'').trim())return;planned+=5;maximum+=5;
        var n=values&&values[index];
        if(n===null||n===undefined){pending++;return;}
        earned+=Math.max(0,Math.min(5,Number(n)||0));
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
      m.bonus=m.groupScore;
      m.performanceRate=m.task.maximum>0?Math.max(0,Math.min(1,(m.task.earned+m.groupScore-m.personal)/m.task.maximum)):0;
      m.learning=round(52*m.performanceRate);
      m.confirmation=(cls.foundationChecks||{})[m.key]||'pending';
      var loss=0,recorded=lessons.length,late=0,early=0,truant=0;
      lessons.forEach(function(l){var a=l.attendance&&l.attendance[m.key];if(a){loss+=Number(a.loss)||0;if(a.status==='late')late++;if(a.status==='early')early++;if(a.status==='truant')truant++;}});
      m.loss=loss;m.recorded=recorded;
      m.lateCount=late;m.earlyCount=early;m.truantCount=truant;
      m.convertedTruants=Math.floor((late+early)/cfg.lateEarlyConversion);m.effectiveTruants=truant+m.convertedTruants;
      m.attendanceFailed=cfg.attendanceFailureEnabled&&m.effectiveTruants>=cfg.truantFailure;
      m.attendance=round(Math.max(0,Math.min(48,48-loss)));
      m.ready=m.task.pending===0&&m.task.maximum>0&&m.recorded===lessons.length&&lessons.length>0;
      m.regular=round(m.learning+m.attendance);m.contribution=round(m.regular*.4);
      m.needed=m.attendanceFailed?null:Math.max(0,Math.ceil(((cfg.passScore-m.regular*.4)/.6-1e-9)*10)/10);
      var exam=cls.examScores&&cls.examScores[m.key];m.exam=exam==null?'':exam;m.final=m.exam===''?null:round(m.regular*.4+m.exam*.6);
    });
    sorted.sort(function(a,b){return b.regular-a.regular||a.rawRank-b.rawRank||String(a.sid||a.name).localeCompare(String(b.sid||b.name));});
    previous=null;rank=0;sorted.forEach(function(m,i){if(i===0||m.regular!==previous)rank=i+1;previous=m.regular;m.rank=rank;});return sorted;
  }
  function options(cfg,value) { value=value||'present';
    var statuses=Object.keys(labels).concat((cfg.customRules||[]).map(function(r){return r.id;}));
    return statuses.map(function(status){var loss=deduction(status,cfg);return '<option value="'+esc(status)+'"'+(status===value?' selected':'')+'>'+esc(statusName(status,cfg))+' · '+(loss?'扣'+loss+'分':'不扣')+'</option>';}).join('')+(value&&!statuses.includes(value)?'<option selected value="'+esc(value)+'">历史原因（保留）</option>':'');
  }
  function confirmationText(m) {return m.ready?'记录已齐':'项目或考勤记录未齐';}
  function attendanceText(m){return '迟到'+m.lateCount+'次 · 早退'+m.earlyCount+'次 · 实际旷课'+m.truantCount+'次 · 折算'+m.convertedTruants+'次 · 合计'+m.effectiveTruants+'次旷课（含折算）'+(m.attendanceFailed?'；考勤挂科':'');}
  function neededText(m){return m.attendanceFailed?'考勤挂科，不适用':m.needed>100?'超过100，无法达到':String(m.needed);}
  function renderRank(ctx) {
    var cls=ctx.cls,cfg=settings(cls),ms=rows(cls,ctx.lessons,ctx.raw);
    ctx.root.innerHTML='<details class="rank-note"><summary>平时分说明：学习52＋考勤48，无基础赠分</summary><p>项目完成率＝个人项目已得分÷本学期已命名项目满分；每个项目固定满分5分，同一课项目名称由任一组编辑后全组同步，所有学生的项目满分同时增加。新项目暂未评分时按0分计入当前完成率和学习赋分，保存得分后即时更新；空白项目名称不计入。</p><p>学习分＝52×clamp((个人项目得分＋全组累计净加分−个人累计扣分)÷项目满分,0,1)。项目分是学习表现基数；首答、小组分、值日等全组奖励会抬高学习分，手机未入袋等全组扣分降低它，个人扣分只从本人结果中减去。学习分范围0–52，不赠基础分；奖励不增加项目满分，也没有学期封顶。</p><p>考勤分＝max(0,48−个人累计考勤扣分)，独立占平时分的48分。迟到、早退、旷课和自定义原因按本班设置直接扣考勤分；请假默认不扣。折算的旷课次数只用于挂科标记，不再次扣分。迟到＋早退按设置次数折算旷课；实际旷课＋折算旷课达到设置门槛，姓名标红并标记考勤挂科。</p><p>平时分＝学习分＋考勤分（0–100）；计入总评＝平时分×40%；期末至少需考＝max(0,(综合及格线−平时分×0.4)÷0.6)，向上取0.1分。考勤挂科时目标显示不适用。例：项目80/100、净奖励10、全勤：完成率80%，学习分46.8，考勤48，平时94.8，折合37.9，及格线60时期末至少36.8。未评分项目按0分是当前预测，录入成绩后自动重算。</p><p>全勤时表现0%→平时48，80%→89.6，90%→94.8，100%→100。未编辑考勤默认到课，只需登记异常。手动任务满分设置为0时，按本课命名项目自动累计。</p></details><div class="assessment-actions"><button class="btn" id="assessmentGoAttendance">考勤与规则</button><button class="btn" id="assessmentExport">导出综合成绩CSV</button></div><p class="note">窄屏可左右滑动表格查看实际期末与综合成绩。</p><div class="assessment-scroll" tabindex="0" role="region" aria-label="成绩表，可左右滚动"><table class="data assessment-table"><thead><tr><th>展示名次</th><th>姓名 / 学号</th><th>小组</th><th>当前累计</th><th>学习赋分/52</th><th>考勤/48</th><th class="grade-regular">平时分（至今完成率）</th><th class="grade-contribution">计入总评 /40</th><th class="grade-needed">期末至少需考 /100</th><th>实际期末</th><th>综合/100</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td><b class="'+(m.attendanceFailed?'attendance-failed':'')+'">'+esc(m.name)+'</b><small>'+esc(m.sid||m.no||'')+'</small></td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><b>'+m.total+'</b><small>全组 '+m.groupScore+' · 个人项目分 '+m.project+' · 扣 '+m.personal+'</small></td><td>'+m.learning+'<small>任务 '+m.task.earned+'/'+m.task.maximum+' · '+round(m.task.rate*100)+'%<br>累计全组净加分 '+m.bonus+'<br>综合比例 '+round(m.performanceRate*100)+'%'+(m.task.pending?' · '+m.task.pending+'项待批改':'')+(!m.task.maximum?' · 未设置有效任务':'')+'</small></td><td>'+m.attendance+'<small>'+m.recorded+'/'+ctx.lessons.length+'课已登记 · 扣'+m.loss+'分<br>'+esc(attendanceText(m))+'</small></td><td class="grade-regular"><strong class="grade-value">'+m.regular+' <span class="completion-rate">（'+(m.task.maximum?round(m.task.rate*100)+'%':'—')+'）</span></strong>'+(!m.ready?'<small>预估 · '+confirmationText(m)+'</small>':'<small>资料已齐</small>')+'</td><td class="grade-contribution"><strong class="grade-value">'+m.contribution+'</strong><small>平时成绩 × 40%</small></td><td class="grade-needed"><strong class="grade-value">'+neededText(m)+'</strong><small>达到及格线所需</small>'+(!m.ready?'<small>预估</small>':'')+'</td><td><input class="assessment-exam" aria-label="'+esc(m.name)+' 实际期末成绩" data-exam-key="'+esc(m.key)+'" type="number" min="0" max="100" step="0.1" value="'+m.exam+'" placeholder="待考"></td><td>'+(m.attendanceFailed?'考勤挂科'+(m.final==null?'':'<small>数值参考 '+m.final+'</small>'):m.final==null?'—':m.final)+(!m.ready&&m.final!==null?'<small>待复核</small>':'')+'</td></tr>';}).join('')+'</tbody></table></div><p class="rank-note">学习0–52＋考勤0–48，无60分保底。按本班设置的实际＋折算旷课门槛判定考勤挂科，不以数值总分代替资格判定。排名仅展示，不改变他人分数。及格线'+cfg.passScore+'，期末需考向上取到0.1分。共'+ms.length+'人（含待分配），计划'+cfg.totalLessons+'课。</p>';
    // Keep the three student-facing outcomes beside the name; evidence follows.
    ctx.root.querySelectorAll('.assessment-table tr').forEach(function(row){var cells=Array.from(row.children);[0,1,6,7,8,2,3,4,5,9,10].forEach(function(i){row.appendChild(cells[i]);});});
    ctx.root.querySelector('#assessmentGoAttendance').onclick=ctx.openAttendance;
    ctx.root.querySelectorAll('[data-exam-key]').forEach(function(input){input.onchange=function(){var v=input.value===''?null:Number(input.value);if(v!==null&&(!Number.isFinite(v)||v<0||v>100)){ctx.message('期末成绩须为0–100分。');return;}var old=cls.examScores&&cls.examScores[input.dataset.examKey];if(!cls.examScores)cls.examScores={};if(v===null)delete cls.examScores[input.dataset.examKey];else cls.examScores[input.dataset.examKey]=v;ctx.log('期末成绩',cls.name+' · '+ms.find(function(m){return m.key===input.dataset.examKey;}).name+'：'+(old==null?'未填':old)+' → '+(v===null?'未填':v));ctx.save();renderRank(ctx);};});
    ctx.root.querySelector('#assessmentExport').onclick=function(){ctx.export(cls.name+'_综合成绩.csv',[['展示名次','姓名','学号','小组','原始累计','任务得分','任务满分','待批改数','达成率','累计全组净加分','学习赋分/52','考勤/48','平时分/100','折合/40','期末需考','实际期末','综合/100','资料齐全','考勤判定','迟到次数','早退次数','实际旷课次数','折算旷课次数','合计旷课次数']].concat(ms.map(function(m){return [m.rank,m.name,m.sid||m.no||'',m.gno||'待分配',m.total,m.task.earned,m.task.maximum,m.task.pending,round(m.task.rate*100)+'%',m.bonus,m.learning,m.attendance,m.regular,m.contribution,neededText(m),m.exam,m.attendanceFailed?'考勤挂科（数值参考：'+(m.final==null?'待考':m.final)+'）':m.final==null?'':m.final,m.ready?'是':'否，预估待复核',m.attendanceFailed?'考勤挂科':'未触发',m.lateCount,m.earlyCount,m.truantCount,m.convertedTruants,m.effectiveTruants];})));};
  }
  function renderAttendance(ctx) {
    var cls=ctx.cls,cfg=settings(cls),students=roster(cls,ctx.raw),lesson=ctx.lesson;
    ctx.root.innerHTML='<h2 class="sec-title">考勤与扣分设置</h2><div class="card lesson-bar"><label class="field">班级<select id="attendanceClassSel">'+ctx.classes.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label><label class="field">课次<select id="attendanceLessonSel"'+(!ctx.lessons.length?' disabled':'')+'>'+(!ctx.lessons.length?'<option>暂无课次</option>':ctx.lessons.map(function(l){return '<option value="'+esc(l.id)+'"'+(lesson&&l.id===lesson.id?' selected':'')+'>第'+l.seq+'次 · '+esc(l.date)+'</option>';}).join(''))+'</select></label></div><details class="card assessment-settings"><summary>本班赋分与考勤规则</summary><form id="assessmentSettingsForm"><div class="assessment-settings-grid">'+[['totalLessons','计划大节课数（每节80分钟）',1,1000],['late','迟到扣分（48分中）',0,100],['truant','旷课扣分（48分中）',0,100],['leave','请假扣分（48分中）',0,100],['early','早退扣分（48分中）',0,100],['passScore','综合及格线',0,100],['taskTarget','手动任务满分（0为自动）',0,100000],['lateEarlyConversion','迟到早退几次折1次旷课（仅用于挂科）',1,100],['truantFailure','合计旷课几次标记挂科',1,100]].map(function(f){return '<label class="field col">'+f[1]+'<input name="'+f[0]+'" type="number" step="1" min="'+f[2]+'" max="'+f[3]+'" value="'+cfg[f[0]]+'" required></label>';}).join('')+'</div><p class="note">考勤满分固定48，学习满分52。当前折算门槛'+cfg.lateEarlyConversion+'次、挂科门槛'+cfg.truantFailure+'次，标记'+(cfg.attendanceFailureEnabled?'开启':'关闭')+'。默认24大节＝48课时；迟到、早退、旷课和自定义原因按设置直接扣考勤分，请假默认不扣。迟到＋早退按设置次数折旷课，只用于挂科门槛，不重复扣分；实际＋折算旷课达到设置门槛时标红。学习分按52×clamp((项目得分＋全组累计净加分−个人扣分)÷命名项目满分,0,1)计算；全组奖励抬高比例，手机等全组扣分及个人扣分降低比例。考勤分=max(0,48−累计考勤扣分)，平时分=学习分＋考勤分；折合分=平时分×40%，期末目标=(及格线−折合分)÷60%，向上取0.1。新命名项目的5分满分立即计入全组每名学生当前完成率；尚未录入的项目分按0分显示预测，后续录入即重算。</p><label><input type="checkbox" id="attendanceFailureEnabled"'+(cfg.attendanceFailureEnabled?' checked':'')+'>启用考勤挂科标记</label><button type="submit" class="btn primary">保存本班规则</button></form><h4>自定义原因</h4><div id="attendanceCustomRules">'+(cfg.customRules||[]).map(function(r){return '<span class="attendance-rule">'+esc(r.name)+' · 扣'+r.loss+'分 <button class="btn tiny" data-remove-rule="'+esc(r.id)+'" title="停用规则，历史记录保留">停用</button></span>';}).join('')+'</div><form id="attendanceCustomForm" class="btnrow"><input id="attendanceCustomName" aria-label="自定义考勤原因" maxlength="40" placeholder="例如：未到原因" required><input id="attendanceCustomLoss" aria-label="自定义扣分" type="number" min="0" max="100" step="1" value="1" required><button class="btn" type="submit">添加原因</button></form></details><p class="note">按课次保存，包含未分组人员。默认到课不伪造出勤记录；修改此表只影响考勤模块，不重复扣课堂积分。</p>'+(lesson?'<div class="card"><div class="assessment-actions"><input id="attendanceSearch" aria-label="搜索考勤学生" placeholder="姓名 / 学号"><label><input id="attendanceSelectAll" type="checkbox">全选可见</label><select id="attendanceBatchStatus" aria-label="批量考勤状态">'+options(cfg,'')+'</select><button id="attendanceApplyBatch" class="btn">应用到所选</button><button id="attendanceSave" class="btn primary">保存本课考勤</button></div><p id="attendanceDirty" class="note" role="status">没有未保存的改动。</p><div class="assessment-scroll"><table class="data attendance-table"><thead><tr><th>选择</th><th>姓名</th><th>学号</th><th>小组</th><th>本课状态</th><th>已保存扣分</th></tr></thead><tbody>'+students.map(function(m){var a=lesson.attendance&&lesson.attendance[m.key];return '<tr data-att-row><td><input type="checkbox" data-att-check="'+esc(m.key)+'" aria-label="选择'+esc(m.name)+'"></td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><select data-att-key="'+esc(m.key)+'" aria-label="'+esc(m.name)+' 考勤">'+options(cfg,a&&a.status)+'</select>'+(a&&!labels[a.status]&&!(cfg.customRules||[]).some(function(r){return r.id===a.status;})?'<small>历史原因：'+esc(a.label)+'（保留）</small>':'')+'</td><td>'+(a?a.loss:0)+'</td></tr>';}).join('')+'</tbody></table></div></div>':'<p class="card">请先在上课记分中新开一课，再登记考勤。</p>');
    var dirty=false,changed=new Set();
    function mark(){dirty=true;var el=ctx.root.querySelector('#attendanceDirty');if(el)el.textContent='有未保存的考勤改动，请点击保存本课考勤。';}
    function guard(){if(dirty){ctx.message('请先保存本课考勤，再切换班级或课次。');return false;}return true;}
    ctx.root.querySelector('#attendanceClassSel').onchange=function(){if(!guard()){this.value=cls.id;return;}ctx.select(this.value,null);};
    ctx.root.querySelector('#attendanceLessonSel').onchange=function(){if(!guard()){this.value=lesson.id;return;}ctx.select(cls.id,this.value);};
    ctx.root.querySelector('#assessmentSettingsForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var next=Object.assign({},cfg);for(var name of ['totalLessons','late','truant','leave','early','passScore','taskTarget','lateEarlyConversion','truantFailure']){var input=this.elements.namedItem(name),v=Number(input.value);if(!Number.isInteger(v)||v<Number(input.min)||v>Number(input.max)){ctx.message('请填写范围内的整数。');return;}next[name]=v;}next.attendanceFailureEnabled=ctx.root.querySelector('#attendanceFailureEnabled').checked;cls.assessmentSettings=next;cfg=next;ctx.log('考勤规则',cls.name+' · 计划'+next.totalLessons+'课；迟到'+next.late+'，旷课'+next.truant+'，请假'+next.leave+'，早退'+next.early+'分；及格线'+next.passScore);ctx.save();ctx.message('本班规则已保存。');};
    ctx.root.querySelector('#attendanceCustomForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var name=ctx.root.querySelector('#attendanceCustomName').value.trim(),loss=Number(ctx.root.querySelector('#attendanceCustomLoss').value);if(!name||name.length>40||!Number.isInteger(loss)||loss<0||loss>100||Object.keys(labels).some(function(s){return labels[s]===name;})||(cfg.customRules||[]).some(function(r){return r.name===name;})||(cfg.customRules||[]).length>=20){ctx.message('原因须唯一，最多20项，扣分为0–100整数。');return;}var next=Object.assign({},cfg,{customRules:(cfg.customRules||[]).concat([{id:'custom_'+Date.now().toString(36),name:name,loss:loss}])});cls.assessmentSettings=next;ctx.log('考勤规则',cls.name+' · 新增'+name+'：扣'+loss+'分');ctx.save();renderAttendance(ctx);};
    ctx.root.querySelectorAll('[data-remove-rule]').forEach(function(b){b.onclick=function(){if(!guard())return;cls.assessmentSettings=Object.assign({},cfg,{customRules:(cfg.customRules||[]).filter(function(r){return r.id!==b.dataset.removeRule;})});ctx.log('考勤规则',cls.name+' · 停用自定义原因，历史保留');ctx.save();renderAttendance(ctx);};});
    if(!lesson)return;
    ctx.root.querySelector('#attendanceSearch').oninput=function(){var q=this.value.trim().toLowerCase();ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){tr.hidden=!tr.textContent.toLowerCase().includes(q);});};
    ctx.root.querySelector('#attendanceSelectAll').onchange=function(){var checked=this.checked;ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){if(!tr.hidden)tr.querySelector('[data-att-check]').checked=checked;});};
    ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){input.onchange=function(){changed.add(input.dataset.attKey);mark();};});
    ctx.root.querySelector('#attendanceApplyBatch').onclick=function(){var value=ctx.root.querySelector('#attendanceBatchStatus').value,count=0;ctx.root.querySelectorAll('[data-att-check]:checked').forEach(function(check){var tr=check.closest('tr');if(!tr.hidden){tr.querySelector('[data-att-key]').value=value;changed.add(check.dataset.attCheck);count++;}});if(count)mark();else ctx.message('请先选择学生。');};
    ctx.root.querySelector('#attendanceSave').onclick=function(){if(!dirty){ctx.message('没有考勤改动需要保存。');return;}if(!lesson.attendance)lesson.attendance={};var current=settings(cls),details=[];ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){var k=input.dataset.attKey;if(!changed.has(k))return;var old=lesson.attendance[k],status=input.value,m=students.find(function(m){return m.key===k;});if(status){lesson.attendance[k]={status:status,label:statusName(status,current),loss:deduction(status,current),updatedAt:new Date().toISOString()};}else delete lesson.attendance[k];details.push(m.name+'：'+(old?old.label:'未记录')+' → '+(status?statusName(status,current)+'（扣'+deduction(status,current)+'分）':'未记录'));});ctx.log('考勤',cls.name+' · 第'+lesson.seq+'次 · '+lesson.date+' · '+details.join('；'));ctx.save();dirty=false;ctx.message('本课考勤已保存，平时分已实时重算。');renderAttendance(ctx);};
    ctx.isDirty=function(){return dirty;};
  }
  function printHtml(cls,lessons,raw) {
    var ms=rows(cls,lessons,raw);
    return '<h2>平时赋分与期末测算</h2><p>学习0–52＋考勤0–48，无基础赠分；迟到/早退合计3次折旷课1次，实际旷课＋折算旷课合计3次考勤挂科，折算不重复扣分；平时40%＋期末60%。名次只展示，未批改/考勤未齐为预估。</p><table><thead><tr><th>名次</th><th>姓名</th><th>学号</th><th>当前累计</th><th>学习/52</th><th>考勤/48</th><th>平时/100</th><th>折合/40</th><th>期末需考</th><th>实际期末</th><th>综合</th><th>记录状态</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+m.total+'</td><td>'+m.learning+'</td><td>'+m.attendance+'</td><td>'+m.regular+'</td><td>'+m.contribution+'</td><td>'+(neededText(m))+'</td><td>'+m.exam+'</td><td>'+(m.attendanceFailed?'考勤挂科'+(m.final==null?'':'<small>数值参考 '+m.final+'</small>'):m.final==null?'—':m.final)+'</td><td>'+esc(confirmationText(m))+(m.ready?' · 已齐':' · 预估')+'<br>'+esc(attendanceText(m))+'</td></tr>';}).join('')+'</tbody></table>';
  }
  root.JFDT_ASSESSMENT={printHtml:printHtml,taskEvidence:taskEvidence,key:key,settings:settings,roster:roster,rows:rows,deduction:deduction,renderRank:renderRank,renderAttendance:renderAttendance};
})(typeof window==='undefined'?globalThis:window);
