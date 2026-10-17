/* =========================================================================
   课堂记分台 · 云端模块（账号 / 邀请码 / 多设备同步 / 管理员）
   -------------------------------------------------------------------------
   本文件是「云端能力」的唯一入口，app.js 只通过 window.JFDT_CLOUD 使用它。

   三条设计原则：
     1. 本机 localStorage 永远是第一现场 —— 教室没网照常记分，云端是同步副本。
     2. 谁能看谁的数据，由服务端 RLS 决定；前端不做"这行是不是我的"这种判定。
     3. 云端连不上就降级成"仅本机"，但一定在界面上写明，不偷偷降级。

   账号模型（平台没有"邀请码登录"这种能力，所以邀请码做成准入闸门）：
     微信扫码登录 = 真实身份（同一个人在任何设备扫码 → 同一个账号 → 记录自动回来）
     邀请码     = 管理员发的一次性通行证，凭码建立"教师档案"，用掉即失效
   ========================================================================= */
(function (global) {
  'use strict';

  /* 这四项就是开通云服务时服务端返回的 publicConfig，是唯一允许写进前端的值。
     纯静态站点没有构建步骤、也没有自己的后端来下发它，只能固化成常量。
     publishableKey 只标识"是哪个应用"，本身不带权限；服务端还会校验来源域名。 */
  var PUBLIC_CONFIG = {
    endpoint: 'https://class-score-board-17272.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_2Ekmh0EvpCxKGweIYuuj70_LS2uynZrVFzOmZ4lGh0Cos5NEBQBuw0t'
  };

  var PUSH_DELAY = 1600;        // 改动后多久推一次云端（合并连续点击）
  var RETRY_DELAY = 15000;      // 推失败后多久重试
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 去掉 0/O/1/I/L 这类易混字符

  var cloud = null;             // SDK 客户端
  var ready = false;            // SDK 是否可用
  var profile = null;           // { uid, name, avatarUrl, displayName, realName, isAdmin }
  var listeners = [];
  var st = { mode: 'idle', text: '', at: 0 };

  var pushTimer = null, retryTimer = null, pushing = false;
  var pendingFn = null;         // 取"当前要推的数据"的函数
  var lastPushedAt = 0;

  /* ---------------- 小工具 ---------------- */

  function setStatus(mode, text) {
    st = { mode: mode, text: text, at: Date.now() };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](st); } catch (e) { /* 界面回调不该影响同步 */ }
    }
  }

  function errText(e) {
    if (!e) return '未知错误';
    if (typeof e === 'string') return e;
    return e.message || e.error_description || '请求失败';
  }

  /** 网络类错误（断网 / 服务端连不上）与"业务错误"要分开对待 */
  function isNetwork(e) {
    if (!e) return false;
    var k = e.kind || e.code || '';
    if (k === 'network' || k === 'backend-unavailable' || k === 'unavailable') return true;
    var m = String(e.message || '');
    return /Failed to fetch|NetworkError|Load failed|timeout|timed out|连不上|网络/i.test(m);
  }

  function rpcJson(name, params) {
    var q = cloud.database.rpc(name, params || {});
    return Promise.resolve(q).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function genCode() {
    var buf = new Uint8Array(8);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(buf);
    else for (var j = 0; j < 8; j++) buf[j] = Math.floor(Math.random() * 256);
    var out = '';
    for (var i = 0; i < 8; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    return out.slice(0, 4) + '-' + out.slice(4);
  }

  /* ---------------- SDK 初始化 ---------------- */

  function initSdk() {
    var W = global.WorkBuddyCloud;
    if (!W || typeof W.createWorkBuddyCloud !== 'function') return false;
    cloud = W.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
    return !!(cloud && cloud.auth && cloud.database);
  }

  /* ---------------- 登录回调（必须早于任何"未登录就跳登录页"的判断） ---------------- */

  function dispatchCallback() {
    var url = new URL(global.location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return Promise.resolve(null);

    var provider = url.searchParams.get('provider');
    var fn = provider === 'workbuddy' ? cloud.auth.handleWorkBuddyCallback
      : provider === 'wechat' ? cloud.auth.handleWechatWebCallback
        : null;
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('这个版本的云端组件不支持该登录方式，请刷新页面重试。'));
    }
    return Promise.resolve(fn.call(cloud.auth)).then(function (res) {
      if (res.error) throw res.error;
      if (res.data) {
        /* state 是一次性的，用完必须从地址栏抹掉，否则用户刷新会拿失效的 code 再换一次 */
        for (var k of ['code', 'state', 'provider']) url.searchParams.delete(k);
        global.history.replaceState(null, '', url.pathname + url.search + url.hash);
        return res.data;
      }
      return null;   // 空结果 = 不是本应用的登录回调，按普通访问继续
    });
  }

  /** 登录入口：微信扫码（主）/ WorkBuddy 账号（备） */
  function oauthLogin(provider) {
    if (!ready) return Promise.reject(new Error('云端组件还没加载好，请稍后重试。'));
    var back = new URL(global.location.href);
    back.pathname = '/';
    for (var k of ['code', 'state', 'provider']) back.searchParams.delete(k);
    for (var k2 of ['c', 'v', 'lay']) back.searchParams.delete(k2);   // 截图辅助参数不参与回调
    return Promise.resolve(cloud.auth.signInWithOAuth({
      provider: provider,
      redirectTo: back.toString()
    })).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.url) throw new Error('没能生成登录地址，请稍后重试。');
      global.location.assign(r.data.url);   // 必须同标签页跳转，否则本地的校验凭据会丢
      return null;
    });
  }

  /* ---------------- 会话 / 档案 ---------------- */

  function readSession() {
    return Promise.resolve(cloud.auth.getSession()).then(function (r) {
      if (r.error) throw r.error;
      return r.data || null;
    });
  }

  function toProfile(session) {
    var u = (session && session.user) || {};
    return {
      uid: u.id || u.uid || '',
      name: u.name || '',
      avatarUrl: u.avatarUrl || '',
      displayName: '',
      realName: '',
      isAdmin: false
    };
  }

  /** 读自己的教师档案；没有档案 = 还没用邀请码激活 */
  function loadProfile() {
    return rpcJson('my_profile').then(function (p) {
      if (!p) return null;
      profile = profile || {};
      profile.displayName = p.display_name || profile.name || '';
      profile.realName = p.real_name || '';
      profile.isAdmin = !!p.is_admin;
      profile.joinedAt = p.created_at || null;
      return profile;
    });
  }

  /* ---------------- 数据同步 ---------------- */

  /** 只同步"业务数据"，ui（当前选中的班级/课次、布局）是每台设备自己的偏好 */
  function payloadOf(S) {
    return {
      version: S.version || 1,
      createdAt: S.createdAt || null,
      updatedAt: S.updatedAt || null,
      classes: S.classes || [],
      lessons: S.lessons || [],
      undo: S.undo || []
    };
  }

  function pull() {
    if (!ready) return Promise.resolve(null);
    return rpcJson('my_state');
  }

  function pushNow(S) {
    if (!ready || !profile) return Promise.resolve(null);
    var name = profile.displayName || profile.name || null;
    return rpcJson('save_my_state', { p_data: payloadOf(S), p_name: name }).then(function (r) {
      if (r && r.ok === false) throw new Error(r.error || '保存失败');
      lastPushedAt = Date.now();
      setStatus('ok', '已同步到云端 ' + clock(new Date()));
      return r;
    });
  }

  function clock(d) {
    return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /** 每次本机保存后调一次；连续点击只会推最后一次 */
  function touch(getState) {
    pendingFn = getState;
    if (!ready || !profile) return;
    setStatus('saving', '正在同步…');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, PUSH_DELAY);
  }

  function flush() {
    clearTimeout(pushTimer);
    if (pushing || !pendingFn || !ready || !profile) return Promise.resolve(null);
    var get = pendingFn;
    pushing = true;
    return pushNow(get()).then(function (r) {
      pendingFn = null;
      clearTimeout(retryTimer);
      return r;
    }).catch(function (e) {
      if (isNetwork(e)) setStatus('offline', '云端连不上，先存在本机（会自动重试）');
      else setStatus('error', '同步失败：' + errText(e));
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, RETRY_DELAY);
      return null;
    }).then(function (r) {
      pushing = false;
      return r;
    });
  }

  /* ---------------- 启动 ---------------- */

  /**
   * handlers:
   *   onReady(profile, cloudRec)  已登录且已激活 → 可以进应用了
   *   onNeedLogin(errorText?)     没登录，要出登录页
   *   onNeedInvite(profile)       登录了但还没激活，要出邀请码页
   *   onOffline(reason)           云端用不了（组件没加载出来 / 断网）
   */
  function boot(handlers) {
    var h = handlers || {};
    ready = initSdk();
    if (!ready) { h.onOffline && h.onOffline('云端组件没能加载（可能是没网或浏览器拦截）'); return; }

    setStatus('connecting', '正在连接云端…');
    dispatchCallback().then(function () {
      return readSession();
    }).then(function (session) {
      if (!session) { h.onNeedLogin && h.onNeedLogin(null); return; }
      profile = toProfile(session);
      return loadProfile().then(function (p) {
        if (!p) { h.onNeedInvite && h.onNeedInvite(profile); return; }
        setStatus('ok', '已连接云端');
        return pull().then(function (rec) {
          h.onReady && h.onReady(profile, rec);
        });
      });
    }).catch(function (e) {
      if (isNetwork(e)) { h.onOffline && h.onOffline(errText(e)); return; }
      /* 非网络错误（比如回调里的业务失败）走登录页，并带上原因 */
      h.onNeedLogin && h.onNeedLogin(errText(e));
    });
  }

  /* ---------------- 邀请码 / 登出 / 档案 ---------------- */

  function redeem(code) {
    if (!ready) return Promise.reject(new Error('云端组件没加载好'));
    return rpcJson('redeem_invite', { p_code: String(code || '').trim() }).then(function (r) {
      if (!r) throw new Error('激活失败，请重试');
      if (r.ok === false) {
        var map = {
          invalid: '这个邀请码不存在，请跟管理员核对一下。',
          used: '这个邀请码已经被用过了，请找管理员要一个新的。',
          disabled: '这个邀请码已被管理员停用。',
          not_signed_in: '登录状态已失效，请重新登录。'
        };
        throw new Error(map[r.error] || '激活失败：' + r.error);
      }
      return loadProfile();
    });
  }

  function signOut() {
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    pendingFn = null;
    return Promise.resolve(cloud.auth.signOut()).catch(function () { return null; })
      .then(function () { global.location.reload(); });
  }

  function updateProfile(name, realName) {
    return rpcJson('update_my_profile', {
      p_display_name: String(name || '').trim(),
      p_real_name: String(realName || '').trim()
    }).then(function () { return loadProfile(); });
  }

  /* ---------------- 管理员 ---------------- */

  var admin = {
    /** 生成 N 个一次性邀请码（码在浏览器本地随机生成，服务端只负责落库去重） */
    createInvites: function (count, note, role) {
      var n = Math.max(1, Math.min(50, parseInt(count, 10) || 1));
      var codes = [];
      for (var i = 0; i < n; i++) codes.push(genCode());
      return rpcJson('admin_create_invites', {
        p_codes: codes,
        p_note: String(note || '').trim() || null,
        p_role: role === 'admin' ? 'admin' : 'teacher'
      }).then(function (r) {
        if (!r || r.ok === false) throw new Error(r && r.error === 'forbidden' ? '只有管理员能做这件事。' : '生成失败');
        return { created: r.created, codes: codes };
      });
    },

    listInvites: function () { return rpcJson('admin_list_invites'); },
    listTeachers: function () { return rpcJson('admin_list_teachers'); },
    getState: function (uid) { return rpcJson('admin_get_state', { p_uid: uid }); }
  };

  /* ---------------- 对外接口 ---------------- */

  global.JFDT_CLOUD = {
    available: function () { return ready; },
    boot: boot,
    pull: pull,
    touch: touch,
    flush: flush,
    status: function () { return st; },
    onStatus: function (cb) { listeners.push(cb); cb(st); },
    profile: function () { return profile; },
    oauthLogin: oauthLogin,
    redeem: redeem,
    signOut: signOut,
    updateProfile: updateProfile,
    lastPushedAt: function () { return lastPushedAt; },
    admin: admin,
    /* 仅供测试注入假 SDK 用 */
    _initWith: function (client) { cloud = client; ready = !!client; },
    _payloadOf: payloadOf
  };

})(typeof window !== 'undefined' ? window : this);
