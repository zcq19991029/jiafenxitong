/* 独立账号与版本化云同步；不再依赖 WorkBuddy 或微信 SDK。 */
(function (global) {
  'use strict';
  var SESSION_KEY = 'jfdt.session.v2';
  var client = null, profile = null, ready = false, handlers = {};
  var listeners = [], pendingFn = null, revision = 0, remoteRevision = null;
  var inFlight = null, pushTimer = null, retryTimer = null, lastPushed = 0;
  var syncedAt = null, conflicted = false, syncedFingerprint=null, lastChecked=0, serverTime=null, checking=null;
  var stateBinding=null, mergeAttempts=0, conflictPaths=[], conflictDetails=[];
  var st = { mode: 'idle', text: '' };
  var apiBase = '';
  try {
    apiBase = String((global.JFDT_CONFIG || {}).apiBase || global.location.origin || '').replace(/\/+$/, '');
    if (apiBase) {
      var url = new URL(apiBase);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(url.hostname))) apiBase = '';
    }
  } catch (e) { apiBase = ''; }

  function status(mode, text) {
    st = { mode: mode, text: text, at: Date.now(), cloudVersion:remoteRevision, checkedAt:lastChecked, serverTime:serverTime, pending:!!pendingFn, conflicts:conflictPaths.slice(), conflictDetails:copy(conflictDetails) || [] };
    listeners.forEach(function (cb) { try { cb(st); } catch (e) {} });
  }
  function readSession() {
    try { return JSON.parse(global.localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function storeSession(session) {
    global.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    client = session;
  }
  function baseKey() { return 'jfdt.base.v2.' + apiBase + '.' + (profile ? profile.uid : ''); }
  function storeRevision(value, updatedAt) {
    remoteRevision = value;
    if (updatedAt !== undefined) syncedAt = updatedAt;
    try { global.localStorage.setItem(baseKey(), JSON.stringify({ revision: value, updatedAt: syncedAt, fingerprint:syncedFingerprint })); } catch (e) {}
  }
  function acceptRemote(rec) {
    if (rec && Number.isInteger(rec.revision)) {
      if(rec.data)syncedFingerprint=fingerprint(rec.data);serverTime=rec.updated_at||rec.data&&rec.data.updatedAt||serverTime;storeRevision(rec.revision, rec.data ? rec.data.updatedAt : null);
      conflicted = false;conflictPaths=[];conflictDetails=[];
    }
  }
  function hasConflict(rec, state) {
    return !!(rec && remoteRevision !== null && rec.revision !== remoteRevision && isDirty(state));
  }
  function reportConflict(paths, details) {
    if(paths)conflictPaths=paths.slice();conflictDetails=Array.isArray(details)?details.slice():[];
    conflicted = true;
    status('conflict', '同步冲突：本机已保留，请先备份，再选择拉取或覆盖云端');
  }
  function request(path, method, body) {
    if (!apiBase) return Promise.reject(new Error('云服务尚未配置，请联系维护者。'));
    var headers = { 'Content-Type': 'application/json' };
    var sentToken = client && client.token;
    if (sentToken) headers.Authorization = 'Bearer ' + sentToken;
    return global.fetch(apiBase + path, { method: method || 'GET', headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var e = new Error(data.error && data.error.message || '请求失败，请稍后重试。');
          e.code = data.error && data.error.code;
          e.status = response.status;
          if (response.status === 401 && path !== '/api/auth/login' && client && client.token === sentToken) {
            client = null; profile = null;
            try {
              var stored = readSession();
              if (stored && stored.token === sentToken) global.localStorage.removeItem(SESSION_KEY);
            } catch (ignored) {}
            if (handlers.onNeedLogin) handlers.onNeedLogin(e.message);
          }
          throw e;
        }
        return data;
      });
    });
  }
  function payloadOf(state) {
    return { version: 1, createdAt: state.createdAt || null, updatedAt: state.updatedAt || null,
      classes: state.classes || [], lessons: state.lessons || [], undo: state.undo || [],
      redo: state.redo || [], operationLog: state.operationLog || [] };
  }
  function copy(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
  function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function normalized(state){var value=copy(payloadOf(state));delete value.updatedAt;(value.lessons||[]).forEach(function(l){Object.values(l.scores||{}).forEach(function(score){Object.keys(score.personal||{}).forEach(function(k){if(score.personal[k]===0)delete score.personal[k];});});});return value;}
  function fingerprint(state){return JSON.stringify(normalized(state));}
  function isDirty(state){return syncedFingerprint!==null?fingerprint(state)!==JSON.stringify(normalized(JSON.parse(syncedFingerprint))):state.updatedAt!==syncedAt;}
  function mergeStates(base,local,remote){
    var conflicts=[],seenLocal=(local.operationLog||[]).filter(function(op){return op.id&&!((base.operationLog||[]).some(function(b){return b.id===op.id;}));}),alreadyApplied=seenLocal.length>0&&seenLocal.every(function(op){return (remote.operationLog||[]).some(function(r){return r.id===op.id;});});
    base=normalized(base);local=normalized(local);remote=normalized(remote);
    function fail(path){conflicts.push(path);}
    (base.classes||[]).forEach(function(c){var l=(local.classes||[]).find(function(x){return x.id===c.id;}),r=(remote.classes||[]).find(function(x){return x.id===c.id;});if(!l||!r)return;function lessonChanges(state){return (state.lessons||[]).filter(function(x){return x.classId===c.id;});}if((!equal(c.groups,l.groups)&&!equal(lessonChanges(base),lessonChanges(remote)))||(!equal(c.groups,r.groups)&&!equal(lessonChanges(base),lessonChanges(local))))fail('/classes/'+c.id+'/groups');});
    (base.lessons||[]).forEach(function(b){var l=local.lessons.find(function(x){return x.id===b.id;}),r=remote.lessons.find(function(x){return x.id===b.id;});if(!l||!r)return;var count=function(x){return (x.leaderProjectNames||[]).length;};if((count(l)<count(b)&&!equal(b.leaderScores,r.leaderScores))||(count(r)<count(b)&&!equal(b.leaderScores,l.leaderScores)))fail('/lessons/'+b.id+'/project-columns');});
    function merge(b,l,r,path){
      if(equal(l,b))return copy(r);if(equal(r,b))return copy(l);
      if(path.endsWith('/updatedAt'))return [l,r].filter(Boolean).sort().pop();
      if(equal(l,r)&&(l===null||typeof l!=='object')){if(!alreadyApplied&&/^\/lessons\/[^/]+\/(scores|leaderScores|attendance)\//.test(path)&&l!==null&&typeof l!=='object')fail(path);return copy(l);}
      if(l===undefined||r===undefined){fail(path);return copy(l);}
      if(Array.isArray(l)&&Array.isArray(r)){
        var field=path.split('/').pop(),history=['undo','redo','operationLog'].includes(field),idField=['classes','lessons','specialRecords','specialRecordsTrash'].includes(field)?'id':field==='groups'?'no':null;
        if(history||idField){var key=function(v){return history?(v.id||(v.op&&v.op.id)||JSON.stringify(v)):String(v[idField]);},bm=new Map((b||[]).map(function(v){return [key(v),v];})),lm=new Map(l.map(function(v){return [key(v),v];})),rm=new Map(r.map(function(v){return [key(v),v];}));if(lm.size!==l.length||rm.size!==r.length){fail(path);return copy(l);}var out=[];new Set([].concat(Array.from(bm.keys()),Array.from(lm.keys()),Array.from(rm.keys()))).forEach(function(k){var v=merge(bm.get(k),lm.get(k),rm.get(k),path+'/'+k);if(v!==undefined)out.push(v);});if(history){out.sort(function(a,b){return String(a.at||a.op&&a.op.at||'').localeCompare(String(b.at||b.op&&b.op.at||''));});out=out.slice(field==='operationLog'?-500:-60);}return out;}
        if(field==='members'||field==='roster'){if(!equal(l,r))fail(path);return copy(l);}
        if((b||[]).length>Math.min(l.length,r.length)){fail(path);return copy(l);}var values=[];for(var i=0;i<Math.max(l.length,r.length);i++)values[i]=merge((b||[])[i],l[i],r[i],path+'/'+i);return values;
      }
      if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)){var out={};new Set(Object.keys(b||{}).concat(Object.keys(l),Object.keys(r))).forEach(function(k){var v=merge(b&&b[k],l[k],r[k],path+'/'+k);if(v!==undefined)Object.defineProperty(out,k,{value:v,writable:true,enumerable:true,configurable:true});});return out;}
      fail(path);return copy(l);
    }
    var data=merge(base,local,remote,'');
    var classIds=new Set(data.classes.map(function(c){return c.id;})),lessonKeys=new Set();data.lessons.forEach(function(l){if(!classIds.has(l.classId))fail('/lessons/'+l.id+'/deleted-class');var key=l.classId+':'+l.seq;if(lessonKeys.has(key)&&(base.lessons||[]).filter(function(b){return b.classId===l.classId&&b.seq===l.seq;}).length<2)fail('/lessons/duplicate-sequence/'+key);lessonKeys.add(key);});
    data.classes.forEach(function(c){var assigned=new Set();c.groups.forEach(function(g){g.members.forEach(function(m){if(!m.name)return;var key=m.sid||m.id||m.name;if(assigned.has(key))fail('/classes/'+c.id+'/duplicate-member/'+key);assigned.add(key);});});});
    function atPath(root,path){var value=root,tokens=String(path||'').split('/').filter(Boolean);for(var i=0;i<tokens.length;i++){if(value===undefined||value===null)return undefined;var token=tokens[i];if(Array.isArray(value)){var numeric=/^\d+$/.test(token)?Number(token):NaN;var found=value.find(function(item){return item&&typeof item==='object'&&(String(item.id)===token||String(item.no)===token||String(item.key)===token);});value=found!==undefined?found:(Number.isInteger(numeric)?value[numeric]:undefined);}else value=value[token];}return value;}var uniqueConflicts=Array.from(new Set(conflicts)),details=uniqueConflicts.map(function(path){return {path:path,local:copy(atPath(local,path)),remote:copy(atPath(remote,path))};});data.updatedAt=new Date().toISOString();return {data:data,conflicts:uniqueConflicts,conflictDetails:details};
  }
  function mergeRecord(rec,state){if(!syncedFingerprint||!rec||!rec.data)return null;try{return mergeStates(JSON.parse(syncedFingerprint),state,rec.data);}catch(e){return null;}}
  function useMerged(rec,state){var merged=mergeRecord(rec,state);if(!merged||merged.conflicts.length){reportConflict(merged&&merged.conflicts,merged&&merged.conflictDetails);return false;}if(!stateBinding||stateBinding.canApply&&!stateBinding.canApply()){status('saving','等待完成当前输入后合并云端');return false;}stateBinding.apply(merged.data);acceptRemote(rec);pendingFn=stateBinding.get;revision++;conflicted=false;status('saving','已合并不同项目改动，正在同步…');return true;}
  function checkLatest(getState,applyRemote){if(checking)return checking;if(!profile)return Promise.resolve(false);var started=fingerprint(getState()),startRevision=revision;status('checking','正在核对云端版本…');checking=request('/api/state').then(function(rec){if(revision!==startRevision||fingerprint(getState())!==started){status('saving','本机有新改动，等待同步后核对');return false;}lastChecked=Date.now();serverTime=rec.updated_at||serverTime;if(rec.revision!==remoteRevision){if(inFlight)return inFlight.then(function(){return !conflicted;});if(isDirty(getState())||pendingFn){if(!useMerged(rec,getState()))return false;return flush().then(function(){return true;});}if(rec.data&&applyRemote){applyRemote(rec);acceptRemote(rec);}}else if(pendingFn||isDirty(getState())){if(!pendingFn)touch(getState);return flush().then(function(){return true;});}if(!conflicted)status('ok','已核对最新版 · 云端v'+remoteRevision);return !conflicted;}).catch(function(e){if(e.code==='version_conflict')reportConflict();else status('offline','无法核对云端最新版，暂停编辑并保留本机改动');return false;}).finally(function(){checking=null;});return checking;}
  function pull() {
    return request('/api/state').then(function (record) {
      if (remoteRevision === null) acceptRemote(record);
      return record;
    });
  }
  function touch(getState) {
    pendingFn = getState;
    revision++;
    if (!profile) return;
    if (conflicted) { reportConflict(); return; }
    status('saving', '正在同步…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush().catch(function () {}); }, 250);
  }
  function flush() {
    clearTimeout(pushTimer);
    if (inFlight) return inFlight;
    if (!profile) return Promise.reject(new Error('请先登录后再同步。'));
    if (conflicted) return Promise.reject(new Error('存在同步冲突，请先备份并选择拉取或覆盖云端。'));
    if (!pendingFn) return Promise.resolve({ ok: true, unchanged: true });
    var sent = revision;
    var snapshot = JSON.parse(JSON.stringify(payloadOf(pendingFn())));
    inFlight = request('/api/state', 'PUT', { data: snapshot, baseRevision: remoteRevision === null ? 0 : remoteRevision })
      .then(function (result) {
        acceptRemote({ revision: result.revision, data: snapshot });
        if (sent === revision) pendingFn = null;
        clearTimeout(retryTimer);
        mergeAttempts=0;lastPushed = Date.now();
        lastChecked=Date.now();status('ok', '已同步到云端 · v'+remoteRevision);
        return result;
      }).catch(function (e) {
        clearTimeout(retryTimer);
        if (e.code === 'version_conflict') {
          if(mergeAttempts<3&&stateBinding){mergeAttempts++;return request('/api/state').then(function(rec){if(useMerged(rec,stateBinding.get()))return {merged:true};if(!conflicted){mergeAttempts--;retryTimer=setTimeout(function(){flush().catch(function(){});},500);var wait=new Error('等待完成输入后同步');wait.code='merge_deferred';throw wait;}throw e;});}
          reportConflict();
        } else if (e.status) {
          status('error', '同步失败：' + e.message);
        } else {
          status('offline', '网络不可用，记录先保存在当前浏览器，稍后自动重试');
          retryTimer = setTimeout(function () { flush().catch(function () {}); }, 15000);
        }
        throw e;
      }).then(function (result) {
        inFlight = null;
        return pendingFn ? flush() : result;
      }, function (e) { inFlight = null; throw e; });
    return inFlight;
  }
  function cancelPending() {
    if (inFlight) return false;
    clearTimeout(pushTimer); clearTimeout(retryTimer);
    pendingFn = null; revision++;
    return true;
  }
  function forcePush(getState) {
    if (!cancelPending()) return Promise.reject(new Error('正在同步，请稍后再试。'));
    return pull().then(function (record) {
      acceptRemote(record);
      touch(getState);
      return flush();
    });
  }
  function completeLogin(session) {
    storeSession(session);
    profile = session.user;
    remoteRevision = null; syncedAt = null; syncedFingerprint=null; conflicted = false;
    try {
      var saved = global.localStorage.getItem(baseKey());
      if (saved !== null) {
        var base = JSON.parse(saved);
        if (typeof base === 'number') remoteRevision = base;
        else if (base && Number.isInteger(base.revision)) { remoteRevision = base.revision; syncedAt = base.updatedAt;syncedFingerprint=base.fingerprint||null; }
      }
    } catch (e) {}
    return pull().then(function (record) {
      status('ok', '已连接云端');
      if (handlers.onReady) handlers.onReady(profile, record);
      return profile;
    });
  }
  function boot(h) {
    handlers = h || {};
    ready = !!apiBase;
    if (!ready) {
      if (handlers.onNeedLogin) handlers.onNeedLogin('独立云服务尚未配置，正式版正在重构。');
      return;
    }
    client = readSession();
    if (!client || !client.token) { if (handlers.onNeedLogin) handlers.onNeedLogin(); return; }
    status('connecting', '正在连接云端…');
    request('/api/auth/me').then(function (result) {
      client.user = result.user;
      return completeLogin(client);
    }).catch(function (e) {
      if (e.status) { if (handlers.onNeedLogin) handlers.onNeedLogin(e.message); }
      else if (handlers.onOffline) handlers.onOffline(e.message);
    });
  }
  function login(username, password) {
    return request('/api/auth/login', 'POST', { username: username, password: password }).then(completeLogin);
  }
  function register(username, password, name, code) {
    return request('/api/auth/register', 'POST', { username: username, password: password, displayName: name, inviteCode: code }).then(completeLogin);
  }
  function signOut() {
    clearTimeout(pushTimer); clearTimeout(retryTimer); pendingFn = null;
    return request('/api/auth/logout', 'POST', {}).catch(function () {}).then(function () {
      try { global.localStorage.removeItem(SESSION_KEY); } catch (e) {}
      client = null; profile = null;
      global.location.reload();
    });
  }
  global.addEventListener('online', function () {
    if(profile&&st.mode!=='conflict'){if(pendingFn)flush().catch(function(){});else if(stateBinding)checkLatest(stateBinding.get,function(rec){stateBinding.apply(rec.data);});}
  });
  global.JFDT_CLOUD = {
    generation: 2, boot: boot, login: login, register: register, signOut: signOut,
    changePassword: function (oldPassword, password) {
      return request('/api/auth/change-password', 'POST', {oldPassword: oldPassword, password: password}).then(function (r) {
        clearTimeout(pushTimer); clearTimeout(retryTimer); pendingFn = null;
        client = null; profile = null;
        global.localStorage.removeItem(SESSION_KEY);
        if (handlers.onNeedLogin) handlers.onNeedLogin('密码已修改，请使用新密码重新登录。');
        return r;
      });
    },
    resetPassword: function (username, code, password) { return request('/api/auth/reset-password', 'POST', {username:username, code:code, password:password}); },
    available: function () { return ready; }, profile: function () { return profile; },
    bindState:function(binding){stateBinding=binding;},mergeRecord:mergeRecord,_mergeStates:mergeStates,checkLatest:checkLatest,isDirty:isDirty,version:function(){return remoteRevision;},pull: pull, touch: touch, flush: flush, cancelPending: cancelPending, acceptRemote: acceptRemote, forcePush: forcePush,
    hasConflict: hasConflict, reportConflict: reportConflict,
    status: function () { return st; }, lastPushedAt: function () { return lastPushed; },
    onStatus: function (callback) { listeners.push(callback); callback(st); },
    updateProfile: function (name, realName) {
      return request('/api/profile', 'PUT', { displayName: name, realName: realName }).then(function (r) {
        profile = r.user; return profile;
      });
    },
    admin: {
      resetPassword: function (username) { return request('/api/admin/password-reset', 'POST', {username:username}); },
      createInvites: function (count, note, role) { return request('/api/admin/invites', 'POST', { count: count, note: note, role: role }); },
      listInvites: function () { return request('/api/admin/invites'); },
      listTeachers: function () { return request('/api/admin/teachers'); },
      getState: function (uid) { return request('/api/admin/teachers/' + encodeURIComponent(uid)); }
    },
    _payloadOf: payloadOf
  };
})(typeof window !== 'undefined' ? window : this);
