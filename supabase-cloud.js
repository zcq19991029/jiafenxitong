/* Supabase 账号与云同步适配层（GitHub Pages 静态托管专用）
 *
 * 只依赖 Supabase 的公开 publishable key（浏览器端匿名 key）：
 *   - 登录 / 注册 / 找回密码 / 第三方登录 / 访客登录 都走 Supabase Auth
 *   - 成绩状态存 public.score_states，按 owner_id 隔离，受 RLS 保护
 * 不使用 service_role，仓库里也没有任何密钥可以绕过 RLS。
 */
(function (global) {
  'use strict';

  var cfg = global.JFDT_CONFIG || {};
  var base = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var key = String(cfg.supabasePublishableKey || '');
  if (!base || !key) {
    try { console.warn('[JFDT] 没有配置 Supabase，登录功能已关闭。'); } catch (e) {}
    return;
  }

  var AUTH = base + '/auth/v1';
  var REST = base + '/rest/v1';
  var SESSION_KEY = 'jfdt.supabase.session.v1';
  var SYNC_KEY = 'jfdt.supabase.sync.v1';

  var session = null;      // { access_token, refresh_token, expires_at }
  var user = null;         // Supabase Auth user
  var me = null;           // 应用内使用的 profile
  var binding = null;      // { get, apply, canApply }
  var revision = 0;        // 本机已知的云端版本号
  var pending = null;      // { get } —— 有未上传改动时非空
  var inflight = null, refreshing = null, checking = null, timer = null;
  var listeners = [];
  var state = { mode: 'idle', text: '' };
  var conflictDetails = [];
  var checkedAt = 0, serverTime = null;
  var providersCache = null;
  var bootHandlers = null;   // boot() 传进来的回调：登录成功后用它把界面切进应用

  /* ---------------- 基础工具 ---------------- */

  var MESSAGES = {
    invalid_credentials: '邮箱或密码不对，请再试一次。',
    email_not_confirmed: '这个邮箱还没确认，请先点开注册邮件里的确认链接。',
    email_exists: '这个邮箱已经注册过了，直接登录就行。',
    user_already_exists: '这个邮箱已经注册过了，直接登录就行。',
    weak_password: '密码太短或太常见，请换一个至少 6 位的密码。',
    over_email_send_rate_limit: '确认邮件发得太频繁（Supabase 免费发信有上限）。请等一会儿再试；如果站点用数字账号、不需要邮箱确认，请管理员在 Supabase 后台关掉 Confirm email。',
    over_request_rate_limit: '操作太频繁，请稍等一下再试。',
    signup_disabled: '站点暂时关闭了新用户注册。',
    anonymous_provider_disabled: '访客登录还没在 Supabase 后台开启。',
    validation_failed: '请检查填写的内容是否完整、格式是否正确。',
    same_password: '新密码不能和原来的密码相同。',
    session_not_found: '登录已过期，请重新登录。',
    reauthentication_needed: '为了安全，请重新登录后再试。'
  };

  function emit(mode, text) {
    state = {
      mode: mode, text: text || '', at: Date.now(),
      cloudVersion: revision, checkedAt: checkedAt, serverTime: serverTime,
      pending: !!pending, conflicts: conflictDetails.slice(), conflictDetails: conflictDetails.slice()
    };
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function request(url, options) {
    options = options || {};
    var headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, options.headers || {});
    if (options.token !== false && session && session.access_token) {
      headers.Authorization = 'Bearer ' + session.access_token;
    }
    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body,
      cache: 'no-store',
      credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        if (text) { try { body = JSON.parse(text); } catch (e) { body = { raw: text }; } }
        if (!res.ok) {
          var code = (body && (body.error_code || body.code || body.error)) || '';
          var raw = (body && (body.msg || body.message || body.error_description)) || ('请求失败（HTTP ' + res.status + '）');
          var err = new Error(MESSAGES[code] || raw);
          err.status = res.status;
          err.code = code;
          err.body = body;
          throw err;
        }
        return body;
      });
    }, function () {
      var err = new Error('连不上网络，请检查网络后重试。');
      err.code = 'network';
      throw err;
    });
  }

  /* ---------------- 会话 ---------------- */

  function remember(s) {
    if (!s || !s.access_token) return null;
    var expires = Number(s.expires_at || 0) || (Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600));
    session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token || (session && session.refresh_token) || null,
      expires_at: expires,
      token_type: s.token_type || 'bearer'
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }

  function forget() {
    session = null; user = null; me = null; revision = 0; pending = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function restore() {
    try {
      var saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.access_token) { session = saved; return true; }
    } catch (e) {}
    return false;
  }

  function ensureFresh() {
    if (!session) {
      var err = new Error('请先登录。'); err.code = 'no_session';
      return Promise.reject(err);
    }
    if (!session.refresh_token) return Promise.resolve(session);
    if (session.expires_at && session.expires_at - 60 > Date.now() / 1000) return Promise.resolve(session);
    if (refreshing) return refreshing;
    refreshing = request(AUTH + '/token?grant_type=refresh_token', {
      method: 'POST', token: false,
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (s) {
      remember(s);
      return session;
    }).catch(function (e) {
      forget();
      throw e;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }

  /* OAuth / 邮件链接回跳：token 在 #hash 里，读完立刻从地址栏抹掉 */
  function adoptUrlSession() {
    var hash = String((global.location && global.location.hash) || '').replace(/^#/, '');
    if (!hash) return null;
    var params = {};
    hash.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      try { params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {}
    });
    var clean = function () {
      try { history.replaceState(null, '', global.location.pathname + global.location.search); } catch (e) {}
    };
    if (params.error || params.error_description) {
      clean();
      return { error: MESSAGES[params.error_code] || params.error_description || '登录没有完成，请重试。' };
    }
    if (!params.access_token) return null;
    remember(params);
    clean();
    return { type: params.type || 'oauth' };
  }

  /* ---------------- 账号资料 ---------------- */

  function toProfile(u, row) {
    var meta = u.user_metadata || {};
    var email = u.email || '';
    var anonymous = !!u.is_anonymous || (!email && !meta.provider_id && !meta.full_name);
    var fallbackName = meta.display_name || meta.full_name || meta.name || (email ? email.split('@')[0] : '老师');
    return {
      uid: u.id,
      email: email,
      anonymous: anonymous,
      username: (row && row.username) || meta.username || (email ? email.split('@')[0] : 'guest'),
      displayName: (row && row.display_name) || fallbackName,
      realName: (row && row.real_name) || meta.real_name || '',
      role: (row && row.role) || 'teacher',
      isAdmin: !!(row && row.role === 'admin'),
      avatarUrl: meta.avatar_url || ''
    };
  }

  function loadProfile() {
    return request(REST + '/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,username,display_name,real_name,role')
      .then(function (rows) { return toProfile(user, rows && rows[0]); })
      .catch(function (e) {
        /* 资料行还没建好也不能挡住上课，退化为只用 Auth 里的资料 */
        if (e.status === 401) throw e;
        return toProfile(user, null);
      });
  }

  /* ---------------- 成绩状态 ---------------- */

  function payloadOf(s) {
    return {
      version: 1,
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || null,
      classes: s.classes || [],
      lessons: s.lessons || [],
      undo: s.undo || [],
      redo: s.redo || [],
      operationLog: s.operationLog || []
    };
  }

  function hashOf(value) {
    var text;
    try { text = JSON.stringify(value); } catch (e) { text = ''; }
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(16) + ':' + text.length;
  }

  function readSyncStamp() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { return null; }
  }

  function writeSyncStamp(data) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ hash: hashOf(payloadOf(data)), at: Date.now(), revision: revision })); } catch (e) {}
  }

  function rowsFor(extra) {
    return REST + '/score_states?owner_id=eq.' + encodeURIComponent(user.id) + '&select=data,revision,updated_at' + (extra || '');
  }

  function pull() {
    if (!user) return Promise.reject(new Error('请先登录。'));
    return ensureFresh().then(function () {
      return request(rowsFor());
    }).then(function (rows) {
      var row = (rows && rows[0]) || { data: null, revision: 0, updated_at: null };
      revision = Number(row.revision || 0);
      serverTime = row.updated_at || null;
      return row;
    });
  }

  function currentBind() {
    if (pending && pending.get) return pending;
    if (binding && binding.get) return binding;
    return null;
  }

  function flush() {
    if (inflight) return inflight;
    var bind = currentBind();
    if (!bind || !user) return Promise.resolve({ ok: true, unchanged: true });
    var snapshot = payloadOf(bind.get() || {});

    inflight = ensureFresh()
      .then(function () {
        return request(REST + '/score_states?owner_id=eq.' + encodeURIComponent(user.id) + '&select=revision,updated_at');
      })
      .then(function (rows) {
        var row = (rows && rows[0]) || null;
        var remote = row ? Number(row.revision || 0) : 0;
        if (row && remote !== revision) {
          conflictDetails = [{ path: '/', local: '本机改动', remote: '云端 v' + remote }];
          emit('conflict', '同步冲突：云端已被另一台设备更新');
          var err = new Error('云端有更新的版本（v' + remote + '），已暂停上传以免覆盖。请到「数据与备份」核对。');
          err.code = 'version_conflict';
          throw err;
        }
        var body = {
          owner_id: user.id, data: snapshot, revision: revision + 1,
          updated_at: new Date().toISOString()
        };
        var url = row ? REST + '/score_states?owner_id=eq.' + encodeURIComponent(user.id) : REST + '/score_states';
        return request(url, {
          method: row ? 'PATCH' : 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(body)
        }).then(function (out) {
          /* 资料行存在但记录还没建（例如注册触发器没装）：补一条 */
          if (row && Array.isArray(out) && !out.length) {
            return request(REST + '/score_states', {
              method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body)
            });
          }
          return out;
        });
      })
      .then(function () {
        revision += 1;
        pending = null;
        serverTime = new Date().toISOString();
        writeSyncStamp(snapshot);
        emit('ok', '已同步到 Supabase · v' + revision);
        return { ok: true, revision: revision };
      })
      .catch(function (e) {
        if (e.code !== 'version_conflict') emit('error', e.message || '同步失败');
        throw e;
      })
      .finally(function () { inflight = null; });

    return inflight;
  }

  function touch(getter) {
    pending = { get: getter || (binding && binding.get) };
    clearTimeout(timer);
    emit('saving', '正在同步…');
    timer = setTimeout(function () { flush().catch(function () {}); }, 300);
  }

  function checkLatest(getter, apply) {
    if (!user) return Promise.resolve(false);
    if (checking) return checking;
    checking = ensureFresh()
      .then(function () { return request(rowsFor()); })
      .then(function (rows) {
        var row = (rows && rows[0]) || null;
        var remote = row ? Number(row.revision || 0) : 0;
        checkedAt = Date.now();
        if (!row || remote === revision) {
          emit('ok', '云端已是最新 · v' + revision);
          return true;
        }
        if (pending || inflight) {
          emit('saving', '本机还有改动没上传，稍后自动同步');
          return false;
        }
        revision = remote;
        serverTime = row.updated_at || null;
        writeSyncStamp(row.data);
        if (apply && row.data) apply(row);
        emit('ok', '已同步云端最新版 · v' + revision);
        return true;
      })
      .catch(function (e) {
        emit('error', e.message || '核对云端失败');
        return false;
      })
      .finally(function () { checking = null; });
    return checking;
  }

  function hasConflict(record, local) {
    if (!record || !record.data || !local) return false;
    var stamp = readSyncStamp();
    if (!stamp || !stamp.hash) return false;
    return hashOf(record.data) !== stamp.hash && hashOf(local) !== stamp.hash;
  }

  function acceptRemote(record) {
    revision = Number((record && record.revision) || revision || 0);
    serverTime = (record && record.updated_at) || serverTime;
    if (record && record.data) writeSyncStamp(record.data);
    return revision;
  }

  /* ---------------- 登录动作 ---------------- */

  function startSession() {
    return request(AUTH + '/user').then(function (u) {
      user = u;
      return loadProfile();
    }).then(function (p) {
      me = p;
      return pull().then(function (record) {
        return { profile: p, record: record };
      }, function () {
        return { profile: p, record: { data: null, revision: 0, updated_at: null } };
      });
    }).catch(function (e) {
      forget();
      throw e;
    });
  }

  /* 登录/注册/访客成功后的统一收尾：把界面切进应用，而不是停在登录页 */
  function afterLogin(result, message) {
    emit('ok', message || '已连接 Supabase');
    if (bootHandlers && bootHandlers.onReady) bootHandlers.onReady(result.profile, result.record);
    return result.profile;
  }

  function login(email, password) {
    return request(AUTH + '/token?grant_type=password', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') })
    }).then(function (s) {
      remember(s);
      return startSession();
    }).then(function (result) { return afterLogin(result); });
  }

  function register(email, password, name) {
    var address = String(email || '').trim();
    var options = { data: { username: address.split('@')[0], display_name: String(name || '').trim() } };
    if (global.location && /^https?:$/.test(global.location.protocol)) {
      options.email_redirect_to = global.location.origin + global.location.pathname;
    }
    return request(AUTH + '/signup', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: address, password: String(password || ''), data: options.data, options: options })
    }).then(function (res) {
      if (res && res.access_token) {
        remember(res);
        return startSession().then(function (result) { return afterLogin(result, '账号已建好，已连接 Supabase'); });
      }
      var err = new Error('注册信息已提交。若后台要求邮箱确认，请点开邮件里的确认链接，然后回来登录。');
      err.code = 'confirm_email';
      throw err;
    });
  }

  function resetPasswordFor(email) {
    var options = {};
    if (global.location && /^https?:$/.test(global.location.protocol)) {
      options.redirect_to = global.location.origin + global.location.pathname;
    }
    return request(AUTH + '/recover', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: String(email || '').trim(), ...options })
    }).then(function () { return true; }, function (e) {
      /* 不向外暴露"这个邮箱有没有注册过"：没注册也照常提示已发送 */
      if (e && (e.code === 'user_not_found' || e.status === 404)) return true;
      throw e;
    });
  }

  function signInWithProvider(provider) {
    if (!global.location) throw new Error('当前环境无法跳转第三方登录。');
    var redirect = global.location.origin + global.location.pathname;
    var url = AUTH + '/authorize?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(redirect);
    global.location.assign(url);
  }

  function signInAnonymously() {
    return request(AUTH + '/signup', { method: 'POST', token: false, body: '{}' }).then(function (res) {
      if (!res || !res.access_token) {
        var err = new Error('访客登录没有拿到会话，请在 Supabase 后台开启匿名登录。');
        err.code = 'anonymous_provider_disabled';
        throw err;
      }
      remember(res);
      return startSession();
    }).then(function (result) { return afterLogin(result, '已用访客身份进入（记录同样保存到云端）'); });
  }

  function updateProfile(name, realName) {
    var display = String(name || '').trim();
    var real = String(realName || '').trim();
    return ensureFresh().then(function () {
      return request(REST + '/profiles?id=eq.' + encodeURIComponent(user.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ display_name: display, real_name: real, last_seen_at: new Date().toISOString() })
      });
    }).then(function (rows) {
      me = toProfile(user, (rows && rows[0]) || null);
      if (!rows || !rows.length) { me.displayName = display; me.realName = real; }
      return me;
    });
  }

  function changePassword(oldPassword, newPassword) {
    return ensureFresh().then(function () {
      return request(AUTH + '/user', { method: 'PUT', body: JSON.stringify({ password: String(newPassword || '') }) });
    });
  }

  /* 修改密码前先确认原密码：重新登录一次，失败就不放行 */
  function verifyPassword(password) {
    if (!me || !me.email) return Promise.resolve(true);
    return request(AUTH + '/token?grant_type=password', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: me.email, password: String(password || '') })
    }).then(function (s) { remember(s); return true; });
  }

  function signOut() {
    var done = function () { forget(); global.location.reload(); };
    if (!session) { done(); return; }
    request(AUTH + '/logout', { method: 'POST' }).then(done, done);
  }

  function providers() {
    if (providersCache) return providersCache;
    providersCache = request(AUTH + '/settings', { token: false }).then(function (s) {
      var ext = (s && s.external) || {};
      return {
        email: !!ext.email,
        github: !!ext.github,
        google: !!ext.google,
        guest: !!ext.anonymous_users,
        signup: !(s && s.disable_signup)
      };
    }).catch(function () {
      return { email: true, github: false, google: false, guest: false, signup: true };
    });
    return providersCache;
  }

  /* ---------------- 管理员 ---------------- */

  var admin = {
    canInvite: false,
    listInvites: function () { return Promise.resolve([]); },
    createInvites: function () {
      return Promise.reject(new Error('现在老师用邮箱自助注册，不需要邀请码。'));
    },
    listTeachers: function () {
      return ensureFresh().then(function () {
        return Promise.all([
          request(REST + '/profiles?select=id,username,display_name,real_name,role,last_seen_at&order=created_at.asc'),
          request(REST + '/score_states?select=owner_id,data,updated_at')
        ]);
      }).then(function (out) {
        var profiles = out[0] || [], states = out[1] || [];
        var byOwner = {};
        states.forEach(function (r) { byOwner[r.owner_id] = r; });
        return profiles.map(function (p) {
          var row = byOwner[p.id] || null;
          var data = (row && row.data) || null;
          var lessons = (data && data.lessons) || [];
          return {
            uid: p.id,
            username: p.username || '',
            display_name: p.display_name || p.real_name || p.username || '未命名老师',
            real_name: p.real_name || '',
            is_admin: p.role === 'admin',
            class_count: ((data && data.classes) || []).length,
            lesson_count: lessons.length,
            synced_at: (row && row.updated_at) || null,
            last_seen_at: p.last_seen_at || null
          };
        });
      });
    },
    getState: function (uid) {
      return ensureFresh().then(function () {
        return request(REST + '/score_states?owner_id=eq.' + encodeURIComponent(uid) + '&select=data,revision,updated_at');
      }).then(function (rows) {
        var row = (rows && rows[0]) || null;
        return { ok: !!row, data: row && row.data, revision: row && row.revision, updated_at: row && row.updated_at };
      });
    }
  };

  /* ---------------- 启动 ---------------- */

  function boot(handlers) {
    handlers = handlers || {};
    bootHandlers = handlers;
    var fromUrl = adoptUrlSession();
    if (fromUrl && fromUrl.error) {
      emit('error', fromUrl.error);
      if (handlers.onNeedLogin) handlers.onNeedLogin(fromUrl.error);
      return;
    }
    var recovered = !!(fromUrl && fromUrl.type === 'recovery');
    if (!session && !restore()) {
      emit('idle', '');
      if (handlers.onNeedLogin) handlers.onNeedLogin('');
      return;
    }
    ensureFresh()
      .then(function () { return request(AUTH + '/user'); })
      .then(function (u) { user = u; return loadProfile(); })
      .then(function (p) {
        me = p;
        return pull().then(function (record) {
          if (recovered && handlers.onRecover) {
            emit('ok', '请设置新密码');
            handlers.onRecover(me);
            return;
          }
          emit('ok', '已连接 Supabase');
          if (handlers.onReady) handlers.onReady(me, record);
        });
      })
      .catch(function (e) {
        var why = (e && (e.status === 401 || e.code === 'session_not_found'))
          ? '登录已过期，请重新登录。'
          : (e && e.message ? e.message : '无法连接账号服务');
        forget();
        emit('error', why);
        if (handlers.onNeedLogin) handlers.onNeedLogin(why);
      });
  }

  global.JFDT_CLOUD = {
    generation: 4,
    provider: 'supabase',
    available: function () { return true; },
    boot: boot,
    login: login,
    register: register,
    resetPasswordFor: resetPasswordFor,
    signInWithProvider: signInWithProvider,
    signInAnonymously: signInAnonymously,
    providers: providers,
    signOut: signOut,
    changePassword: changePassword,
    verifyPassword: verifyPassword,
    updateProfile: updateProfile,
    profile: function () { return me; },
    bindState: function (b) { binding = b; },
    touch: touch,
    flush: flush,
    forcePush: function (getter) { pending = { get: getter || (binding && binding.get) }; return flush(); },
    cancelPending: function () {
      if (inflight) return false;
      pending = null; clearTimeout(timer); return true;
    },
    isDirty: function () { return !!(pending || inflight); },
    pull: pull,
    checkLatest: checkLatest,
    acceptRemote: acceptRemote,
    hasConflict: hasConflict,
    reportConflict: function (list) {
      if (Array.isArray(list)) conflictDetails = list;
      emit('conflict', '同步冲突：请先备份并处理');
    },
    status: function () { return state; },
    onStatus: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    },
    onStatusChange: function (fn) { listeners.push(fn); },
    version: function () { return revision; },
    admin: admin
  };
})(window);
