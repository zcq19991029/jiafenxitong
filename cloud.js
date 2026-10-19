/* 独立账号与版本化云同步；不再依赖 WorkBuddy 或微信 SDK。 */
(function (global) {
  'use strict';
  var SESSION_KEY = 'jfdt.session.v2';
  var client = null, profile = null, ready = false, handlers = {};
  var listeners = [], pendingFn = null, revision = 0, remoteRevision = null;
  var inFlight = null, pushTimer = null, retryTimer = null, lastPushed = 0;
  var syncedAt = null, conflicted = false, syncedFingerprint=null, lastChecked=0, serverTime=null, checking=null;
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
    st = { mode: mode, text: text, at: Date.now(), cloudVersion:remoteRevision, checkedAt:lastChecked, serverTime:serverTime, pending:!!pendingFn };
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
      conflicted = false;
    }
  }
  function hasConflict(rec, state) {
    return !!(rec && remoteRevision !== null && rec.revision !== remoteRevision && isDirty(state));
  }
  function reportConflict() {
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
  function fingerprint(state){var value=payloadOf(state);delete value.updatedAt;return JSON.stringify(value);}
  function isDirty(state){return syncedFingerprint!==null?fingerprint(state)!==syncedFingerprint:state.updatedAt!==syncedAt;}
  function checkLatest(getState,applyRemote){if(checking)return checking;if(!profile)return Promise.resolve(false);var started=fingerprint(getState()),startRevision=revision;status('checking','正在核对云端版本…');checking=request('/api/state').then(function(rec){if(revision!==startRevision||fingerprint(getState())!==started){status('saving','本机有新改动，等待同步后核对');return false;}lastChecked=Date.now();serverTime=rec.updated_at||serverTime;if(rec.revision!==remoteRevision){if(isDirty(getState())||pendingFn||inFlight){reportConflict();return false;}if(rec.data&&applyRemote){applyRemote(rec);acceptRemote(rec);}}else if(pendingFn){return flush().then(function(){lastChecked=Date.now();status('ok','已核对最新版 · 云端v'+remoteRevision);return true;});}else if(isDirty(getState())){touch(getState);return flush().then(function(){lastChecked=Date.now();status('ok','已核对最新版 · 云端v'+remoteRevision);return true;});}if(!conflicted)status('ok','已核对最新版 · 云端v'+remoteRevision);return !conflicted;}).catch(function(e){if(e.code==='version_conflict')reportConflict();else status('offline','无法核对云端最新版，本机记录保留');return false;}).finally(function(){checking=null;});return checking;}
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
    pushTimer = setTimeout(function () { flush().catch(function () {}); }, 1200);
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
        lastPushed = Date.now();
        lastChecked=Date.now();status('ok', '已同步到云端 · v'+remoteRevision);
        return result;
      }).catch(function (e) {
        clearTimeout(retryTimer);
        if (e.code === 'version_conflict') {
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
    if (profile && pendingFn && st.mode !== 'conflict') flush().catch(function () {});
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
    checkLatest:checkLatest,isDirty:isDirty,version:function(){return remoteRevision;},pull: pull, touch: touch, flush: flush, cancelPending: cancelPending, acceptRemote: acceptRemote, forcePush: forcePush,
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
