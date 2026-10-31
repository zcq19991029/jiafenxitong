/* GitHub Pages + Supabase 版本的端到端校验。
 *
 * 不起服务器、不联网：用 jsdom 跑真实的 index.html 与全部前端脚本，
 * 只在 window.fetch 上挂一个内存版 Supabase（Auth + REST），
 * 因此验证的是「老师真的能注册 / 登录 / 同步」这条链路，而不是 mock 组件。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(new URL('./test-runtime/', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.cwd();
const SITE = 'https://zcq19991029.github.io/jiafenxitong';
const SUPABASE = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co'; // 华夏工具共用项目（2026-10-30 起）

/* 先构建真实产物，后面所有断言都跑在 pages-dist 上而不是源码上 */
execFileSync(process.execPath, [path.join(ROOT, 'tools/build_pages.mjs')], { cwd: ROOT, stdio: 'inherit' });
const OUT = path.join(ROOT, 'pages-dist');

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log('PASS', name);
}
const read = (file) => fs.readFileSync(path.join(OUT, file), 'utf8');
const readSrc = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ---------------- 内存版 Supabase ---------------- */

function createCloud(options = {}) {
  const db = {
    settings: {
      external: { email: true, github: false, google: false, anonymous_users: false, ...(options.external || {}) },
      disable_signup: !!options.disableSignup,
      mailer_autoconfirm: !options.confirmEmail
    },
    users: new Map(),      // id -> { id, email, password, user_metadata }
    byEmail: new Map(),    // email -> id
    profiles: new Map(),   // id -> row
    states: new Map(),     // owner_id -> { data, revision, updated_at }
    sessions: new Map(),   // token -> uid
    teachers: new Set(),   // hx_profiles.role='teacher'
    students: new Set(),   // hx_profiles.role='student'
    codes: new Map([['TEACHER01', { role: 'teacher', used: 0 }]]), // 华夏工具教师邀请码（一码一用）
    mail: [],
    requests: []
  };
  let seq = 0;
  const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  });
  const fail = (status, error_code, msg) => json({ code: status, error_code, msg }, status);

  function newUser(email, password, meta = {}) {
    const id = '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
    const user = { id, email, password, user_metadata: meta };
    db.users.set(id, user);
    db.byEmail.set(email.toLowerCase(), id);
    /* 新项目没有注册触发器：资料行、成绩行都不自动建 */
    return user;
  }
  /* 从旧项目迁过来的老师：原账号原密码，已登记教师，带资料和成绩 */
  db.seedTeacher = (email, password, profile, state) => {
    const user = newUser(email, password, {});
    db.teachers.add(user.id);
    db.profiles.set(user.id, { id: user.id, username: email.split('@')[0], display_name: '', real_name: '', role: 'teacher', ...profile });
    db.states.set(user.id, { data: state, revision: 7, updated_at: new Date().toISOString() });
    return user;
  };
  function issue(user) {
    const token = 'token-' + user.id + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    db.sessions.set(token, user.id);
    return {
      access_token: token,
      refresh_token: 'refresh-' + token,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: user.id, email: user.email, user_metadata: user.user_metadata }
    };
  }
  function currentUser(headers) {
    const auth = headers && (headers.Authorization || headers.authorization);
    if (!auth) return null;
    const id = db.sessions.get(String(auth).replace(/^Bearer\s+/i, ''));
    return id ? db.users.get(id) : null;
  }
  function query(url, name) {
    return new URL(url).searchParams.get(name);
  }

  async function handle(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const body = init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {};
    const target = new URL(url);
    db.requests.push({ method, path: target.pathname, search: target.search, body });

    if (target.pathname === '/auth/v1/settings') return json(db.settings);

    if (target.pathname === '/auth/v1/signup' && method === 'POST') {
      if (!body.email) {
        if (!db.settings.external.anonymous_users) return fail(422, 'anonymous_provider_disabled', 'Anonymous sign-ins are disabled');
        const user = newUser('guest-' + Math.random().toString(16).slice(2) + '@guest.local', null, { display_name: '访客老师' });
        user.is_anonymous = true;
        return json(issue(user));
      }
      if (db.settings.disable_signup) return fail(422, 'signup_disabled', 'Signups not allowed');
      const email = String(body.email).toLowerCase();
      if (db.byEmail.has(email)) return fail(422, 'user_already_exists', 'User already registered');
      const user = newUser(body.email, body.password, body.data || {});
      if (!db.settings.mailer_autoconfirm) {
        db.mail.push({ type: 'signup', email: body.email });
        return json({ id: user.id, email: user.email, confirmation_sent_at: new Date().toISOString() });
      }
      return json(issue(user));
    }

    if (target.pathname === '/auth/v1/token') {
      const grant = query(url, 'grant_type');
      if (grant === 'password') {
        const id = db.byEmail.get(String(body.email || '').toLowerCase());
        const user = id && db.users.get(id);
        if (!user || user.password !== body.password) return fail(400, 'invalid_credentials', 'Invalid login credentials');
        return json(issue(user));
      }
      if (grant === 'refresh_token') {
        const token = db.sessions.get(String(body.refresh_token || '').replace(/^refresh-/, ''));
        if (!token) return fail(400, 'invalid_grant', 'Invalid Refresh Token');
        return json(issue(db.users.get(token)));
      }
    }

    if (target.pathname === '/auth/v1/recover' && method === 'POST') {
      if (!db.byEmail.has(String(body.email || '').toLowerCase())) return fail(400, 'user_not_found', 'User not found');
      db.mail.push({ type: 'recovery', email: body.email });
      return json({});
    }

    if (target.pathname === '/auth/v1/logout') return json({});

    if (target.pathname === '/auth/v1/user') {
      const user = currentUser(headers);
      if (!user) return fail(401, 'session_not_found', 'Session not found');
      if (method === 'PUT') {
        if (body.password && String(body.password).length < 6) return fail(422, 'weak_password', 'Password should be at least 6 characters');
        user.password = body.password;
        return json({ id: user.id, email: user.email, user_metadata: user.user_metadata });
      }
      return json({ id: user.id, email: user.email, user_metadata: user.user_metadata, is_anonymous: !!user.is_anonymous });
    }

    if (target.pathname === '/rest/v1/rpc/paike_login_email') {
      const id = (db.usernames || {})[String(body.p_name || '').toLowerCase()];
      return json(id ? db.users.get(id).email : null);
    }
    if (target.pathname === '/rest/v1/rpc/hx_me') {
      const user = currentUser(headers);
      return json({ teacher: !!user && db.teachers.has(user.id), admin: false, dev: false, student: user && db.students.has(user.id) ? { id: 1, name: '学生', class: '26工器1班' } : null });
    }
    if (target.pathname === '/rest/v1/rpc/hx_redeem') {
      const user = currentUser(headers);
      if (!user) return json({ code: 'P0001', message: '请先登录' }, 400);
      if (db.teachers.has(user.id) || db.students.has(user.id)) return json({ code: 'P0001', message: '这个账号已经开通过了' }, 400);
      const code = db.codes.get(String(body.p_code || '').trim().toUpperCase());
      if (!code || code.used >= 1) return json({ code: 'P0001', message: '邀请码无效、已撤销或已用完' }, 400);
      code.used++;
      (code.role === 'teacher' ? db.teachers : db.students).add(user.id);
      return json(code.role);
    }

    /* RLS：jf_ 表只有华夏工具教师能读写 */
    const rlsDenied = () => json({ code: '42501', message: 'new row violates row-level security policy' }, 403);
    if (target.pathname.startsWith('/rest/v1/jf_profiles')) {
      const user = currentUser(headers);
      if (!user || !db.teachers.has(user.id)) return method === 'GET' ? json([]) : rlsDenied();
      if (method === 'POST') {
        if (body.id !== user.id || body.role) return rlsDenied();
        if (!db.profiles.has(body.id)) db.profiles.set(body.id, { role: 'teacher', ...body });
        return json([db.profiles.get(body.id)]);
      }
      if (method === 'PATCH') {
        const row = db.profiles.get(user.id);
        Object.assign(row, body);
        return json([row]);
      }
      const id = query(url, 'id');
      if (id) {
        const row = db.profiles.get(String(id).replace('eq.', ''));
        return json(row ? [row] : []);
      }
      return json([...db.profiles.values()]);
    }

    if (target.pathname.startsWith('/rest/v1/jf_score_states')) {
      const user = currentUser(headers);
      if (!user || !db.teachers.has(user.id)) return method === 'GET' ? json([]) : rlsDenied();
      const owner = String(query(url, 'owner_id') || '').replace('eq.', '');
      if (method === 'POST') {
        if (body.owner_id !== user.id || db.states.has(body.owner_id)) return rlsDenied();
        db.states.set(body.owner_id, { data: body.data, revision: body.revision, updated_at: body.updated_at });
        return json([{ owner_id: body.owner_id, ...db.states.get(body.owner_id) }]);
      }
      if (method === 'PATCH') {
        if (owner !== user.id) return fail(403, 'insufficient_privilege', 'denied');
        const row = db.states.get(owner);
        if (!row) return json([]);
        row.data = body.data; row.revision = body.revision; row.updated_at = body.updated_at;
        return json([{ owner_id: owner, ...row }]);
      }
      if (owner) {
        const row = db.states.get(owner);
        return json(row && row.revision ? [{ owner_id: owner, ...row }] : []);
      }
      return json([...db.states.entries()].filter(([, r]) => r.revision).map(([owner_id, r]) => ({ owner_id, ...r })));
    }

    return json({ message: 'not found' }, 404);
  }

  db.fetch = (url, init) => {
    const target = String(url);
    if (!target.startsWith(SUPABASE)) return json({ message: 'not found' }, 404);
    return handle(target, init);
  };
  return db;
}

/* ---------------- 载入真实前端 ---------------- */

const HTML = read('index.html');
const SCRIPTS = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

function openSite({ cloud, hash = '' } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (!/Not implemented.*(navigation|HTMLDialogElement|window.*focus|window.*print|window.*scroll)/i.test(e.message)) errors.push(e.message);
  });
  const dom = new JSDOM(HTML.replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''), {
    url: SITE + '/' + hash,
    runScripts: 'outside-only',
    virtualConsole: vc,
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function (value) {
    if (value !== undefined) this.returnValue = value;
    this.removeAttribute('open');
    this.dispatchEvent(new w.Event('close'));
  };
  w.confirm = () => true;
  w.alert = () => {};
  w.print = () => {};
  w.scrollTo = () => {};
  w.fetch = (url, init) => {
    const target = String(url);
    if (target.includes('/version.json')) return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
    return cloud.fetch(target, init);
  };
  const get = (file) => read(file.replace(/[?#].*$/, ''));
  for (const src of SCRIPTS) w.eval(get(src));
  return { dom, w, errors, q: (sel) => w.document.querySelector(sel) };
}

const HX_GATE = /hxTeacherGate:\s*true/.test(read('config.js'));
const REGISTER_CODE = HX_GATE ? 'TEACHER01' : read('config.js').split("registerCode: '")[1].split("'")[0] || '';
const ACCOUNT_DOMAIN = read('config.js').split("accountDomain: '")[1].split("'")[0] || 'jfdt.app';

/* 注册面板：账号 / 姓名 / 密码 / 邀请码 */
function register(site, { account, name, password, code = REGISTER_CODE }) {
  site.q('#btnShowRegister').click();
  site.q('#regEmail').value = account;
  site.q('#regName').value = name || '';
  site.q('#regPassword').value = password;
  site.q('#regConfirm').value = password;
  if (site.q('#regInvite')) site.q('#regInvite').value = code;
  site.q('#btnRegisterNow').click();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 300; i++) {
    const value = await fn();
    if (value) return value;
    await wait(10);
  }
  throw new Error('等待超时：' + (label || '条件未满足'));
}

/* ---------------- 静态产物检查（部署前提） ---------------- */

check('index.html 引用的脚本都存在', SCRIPTS.every((src) => fs.existsSync(path.join(OUT, src.replace(/[?#].*$/, '')))));
check('所有脚本都是同源引用', !/<script[^>]+src="https?:/i.test(HTML));
check('脚本都带版本指纹（Pages CDN 不会拿旧文件）', SCRIPTS.filter((src) => /\.js$/.test(src)).every((src) => /\?v=/.test(src)));
check('产物带发布元信息与 version.json', (() => {
  const html = read('index.html');
  const version = JSON.parse(read('version.json'));
  return html.includes('name="build-commit"') && html.includes('name="build-published-at"') &&
    typeof version.commit === 'string' && Number.isFinite(new Date(version.builtAt).getTime());
})());
check('前端只带 Supabase 公开 key（没有 service_role）', (() => {
  const cfg = readSrc('config.js');
  return /supabaseUrl/.test(cfg) && /sb_publishable_/.test(cfg) && !/service_role|sb_secret_/.test(cfg);
})());
check('仓库里不存在可绕过 RLS 的密钥', (() => {
  const source = readSrc('supabase-cloud.js') + readSrc('cloud.js') + readSrc('app.js') + readSrc('config.js');
  /* 只查真正的密钥字面量：sb_secret_* 前缀，或 JWT（eyJ...）里写着 service_role */
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(source)) return false;
  const jwts = source.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) || [];
  return jwts.every((token) => {
    try {
      const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return body.role !== 'service_role';
    } catch (e) { return true; }
  });
})());

check('公开 data.js 不含任何学生名单', (() => {
  const seed = read('data.js').split('window.SEED_DATA =')[1].trim().replace(/;$/, '');
  const data = JSON.parse(seed);
  return data.classes.every((c) => (c.roster || []).length === 0 && (c.groups || []).every((g) => !(g.members || []).length));
})());
check('旧版「教师账号+一次性重置码」表单没有残留', !/一次性重置码/.test(HTML) && !/id="loginUsername"/.test(HTML) && !/id="resetCode"/.test(HTML));
check('注册要填华夏工具教师邀请码（数据库核对）', /id="regInvite"/.test(HTML) && HX_GATE && /tablePrefix:\s*'jf_'/.test(read('config.js')));
check('前端已指向华夏工具项目', read('config.js').includes(SUPABASE) && !/hrzeciygelfwdmhftvew\.supabase/.test(read('config.js')));
check('私有材料没有进产物', !fs.existsSync(path.join(OUT, '教学材料')) && !fs.existsSync(path.join(OUT, 'data.example.js')) && !fs.existsSync(path.join(OUT, 'backend')));

/* ---------------- 场景一：登录页结构 + 第三方登录开关 ---------------- */

{
  const cloud = createCloud({ external: { github: true, google: false, anonymous_users: false } });
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');

  check('未登录时停在登录页并锁定编辑', site.w.document.body.classList.contains('gated'));
  check('登录页是单个「教师账号」输入框（可数字可邮箱）', !!site.q('#loginEmail') && site.q('#loginEmail').type === 'text' && /教师账号/.test(site.q('#loginEmail').closest('label').textContent));
  check('注册与忘记密码入口都在', !!site.q('#btnShowRegister') && !!site.q('#btnForgotPassword'));
  await until(() => !site.q('#gateProviders').hidden, '读取登录方式开关');
  check('后台开了 GitHub 就显示 GitHub 登录', !site.q('#btnOAuthGithub').hidden);
  check('后台没开 Google 就不显示', site.q('#btnOAuthGoogle').hidden);
  check('后台没开匿名登录就不显示访客入口', site.q('#btnGuest').hidden);

  const before = cloud.requests.length;
  site.q('#loginEmail').value = 'nobody@example.com';
  site.q('#loginPassword').value = 'wrong-password';
  site.q('#btnAccountLogin').click();
  await until(() => /邮箱或密码/.test(site.q('#gateMsg').textContent), '错误密码提示');
  check('密码错误给出中文提示且不放进应用', /邮箱或密码不对/.test(site.q('#gateMsg').textContent) && site.w.document.body.classList.contains('gated'));
  check('密码错误确实打到了 Supabase 登录接口', cloud.requests.slice(before).some((r) => r.path === '/auth/v1/token'));

  site.q('#btnForgotPassword').click();
  check('忘记密码切到发邮件面板', !site.q('#gateReset').hidden && site.q('#gateLogin').hidden);
  site.q('#resetEmail').value = 'nobody@example.com';
  site.q('#btnSendReset').click();
  await until(() => /重置邮件已发送/.test(site.q('#gateMsg').textContent), '发送重置邮件');
  check('重置邮件请求带上回跳地址', cloud.requests.some((r) => r.path === '/auth/v1/recover' && r.body && r.body.email === 'nobody@example.com'));
  check('运行期没有前端异常', site.errors.length === 0);
  site.w.close();
}

/* ---------------- 场景二：注册 → 上课 → 同步 ---------------- */

{
  const cloud = createCloud({ confirmEmail: false });
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');

  site.q('#btnShowRegister').click();
  check('注册面板接受任意教师账号', !site.q('#gateRegister').hidden && site.q('#regEmail').type === 'text');
  check('开启邀请制时出现邀请码输入框', REGISTER_CODE ? !site.q('#regInviteWrap').hidden : site.q('#regInviteWrap').hidden);

  const beforeNoCode = cloud.requests.length;
  register(site, { account: '11445', name: '夜夜', password: 'secret123', code: '' });
  await wait(60);
  check('没填教师邀请码时本地拦下、不发注册请求', /教师邀请码/.test(site.q('#gateMsg').textContent) && cloud.requests.length === beforeNoCode);

  /* 邀请码由数据库核对：填错时账号建了但开不了教师，留在登录页 */
  register(site, { account: '11445', name: '夜夜', password: 'secret123', code: 'WRONG-CODE' });
  await until(() => /邀请码无效/.test(site.q('#gateMsg').textContent), '错误邀请码提示');
  check('邀请码错误时提示且不放进应用', site.w.document.body.classList.contains('gated') && !site.w.localStorage.getItem('jfdt.supabase.session.v1'));
  check('邀请码错误时不留资料行', cloud.profiles.size === 0);

  /* 改对邀请码再点注册：账号已存在 → 用这组密码登录并兑换 */
  register(site, { account: '11445', name: '夜夜', password: 'secret123', code: 'teacher01' });
  await until(() => site.q('#gate').hidden, '注册后进入应用');
  check('改对邀请码后直接进入应用（同一账号，不重复注册）', !site.w.document.body.classList.contains('gated') && cloud.users.size === 1);
  check('教师邀请码已兑换、一码一用', cloud.codes.get('TEACHER01').used === 1 && cloud.teachers.size === 1);
  check('数字账号被补成 账号@域名 去注册', cloud.requests.some((r) => r.path === '/auth/v1/signup' && r.body && r.body.email === '11445@' + ACCOUNT_DOMAIN));
  check('首次登录补建了 jf_profiles 资料行', cloud.profiles.size === 1 && cloud.profiles.values().next().value.display_name === '夜夜' &&
    cloud.requests.some((r) => r.method === 'POST' && r.path === '/rest/v1/jf_profiles'));
  check('新账号看到名单导入入口', !site.q('#rosterSetupHint').hidden);
  check('顶栏显示老师姓名', /夜夜/.test(site.q('#userName').textContent));

  site.w.JFDT_CLOUD.touch(() => JSON.parse(site.w.localStorage.getItem('jfdt.v1')));
  await until(() => [...cloud.states.values()].some((r) => r.revision >= 1), '上传到云端');
  const row = [...cloud.states.values()].find((r) => r.revision >= 1);
  check('成绩状态写进了 jf_score_states', cloud.requests.some((r) => r.path === '/rest/v1/jf_score_states') && !!row && Array.isArray(row.data.classes) && row.data.classes.length > 0);
  check('同步后顶栏不再是未连接状态', site.w.JFDT_CLOUD.status().mode === 'ok');

  const revisionBefore = row.revision;
  await site.w.JFDT_CLOUD.checkLatest(() => null, null);
  check('再次核对云端不会重复升版本', [...cloud.states.values()].every((r) => r.revision === revisionBefore));

  site.w.JFDT_CLOUD.signOut();
  await wait(50);
  check('退出后清掉了本机会话', !site.w.localStorage.getItem('jfdt.supabase.session.v1'));
  check('运行期没有前端异常', site.errors.length === 0);
  site.w.close();
}

/* ---------------- 场景三：需要邮箱确认时不放行 ---------------- */

{
  const cloud = createCloud({ confirmEmail: true });
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');
  register(site, { account: 'pending-teacher', name: '王老师', password: 'secret123' });
  await until(() => /确认链接|确认邮件/.test(site.q('#gateMsg').textContent), '邮箱确认提示');
  check('要邮箱确认时停在注册页并说明下一步', !site.q('#gateRegister').hidden && site.w.document.body.classList.contains('gated'));
  check('数字账号收不到确认信时提示改用真实邮箱', /真实邮箱/.test(site.q('#gateMsg').textContent));
  check('邀请码先存本机，确认后第一次登录再兑换', site.w.localStorage.getItem('jfdt.hx.invite.v1') === 'TEACHER01');
  check('提示里带上了刚注册的账号', site.q('#loginEmail').value === 'pending-teacher');
  site.w.close();
}

/* ---------------- 场景四：重置邮件回到站点 → 设新密码 ---------------- */

{
  const cloud = createCloud({ confirmEmail: false });
  const seedUser = { email: 'back@example.com', password: 'old-pass-1' };
  // 先用真实注册流程建号
  const boot = openSite({ cloud });
  await until(() => boot.q('#gate') && !boot.q('#gate').hidden, '登录闸门出现');
  register(boot, { account: seedUser.email, name: '返场老师', password: seedUser.password });
  await until(() => boot.q('#gate').hidden, '注册后进入应用');
  boot.w.close();

  // 带 recovery 的 access_token 回到站点
  const anyToken = [...cloud.sessions.keys()][0];
  const site = openSite({ cloud, hash: `#access_token=${anyToken}&refresh_token=refresh-${anyToken}&type=recovery&expires_in=3600` });
  await until(() => site.q('#gateNewPassword') && !site.q('#gateNewPassword').hidden, '显示设新密码面板');
  check('重置链接回到站点时显示设新密码面板', !site.q('#gateNewPassword').hidden && site.w.document.body.classList.contains('gated'));
  check('地址栏里的 token 用后即抹掉', !/access_token/.test(site.w.location.hash));

  site.q('#recoverPassword').value = 'new-pass-2';
  site.q('#recoverConfirm').value = 'new-pass-2';
  site.q('#btnSaveRecovered').click();
  await until(() => cloud.users && [...cloud.users.values()].some((u) => u.password === 'new-pass-2'), '新密码写入');
  check('新密码已写入账号', [...cloud.users.values()].some((u) => u.password === 'new-pass-2'));
  site.w.close();
}

/* ---------------- 场景五：后台开启匿名登录后出现访客入口 ---------------- */

{
  const cloud = createCloud({ external: { anonymous_users: true, google: true } });
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');
  await until(() => !site.q('#gateProviders').hidden, '读取登录方式开关');
  check('开了匿名登录就出现访客入口', !site.q('#btnGuest').hidden);
  check('开了 Google 就出现 Google 登录', !site.q('#btnOAuthGoogle').hidden);
  site.q('#btnGuest').click();
  await until(() => /教师身份/.test(site.q('#gateMsg').textContent), '访客被拒');
  check('访客不是华夏工具教师，进不了加分助手', site.w.document.body.classList.contains('gated') && !site.w.localStorage.getItem('jfdt.supabase.session.v1'));
  site.w.close();
}

/* ---------------- 场景六：旧项目迁来的老师用原账号原密码登录，看到原数据 ---------------- */

{
  const cloud = createCloud({ confirmEmail: true });
  const state = { version: 1, classes: [{ id: 'c-mig', name: '迁移测试班', roster: [{ id: 's1', name: '测试学生甲' }], groups: [] }], lessons: [{ id: 'l1', classId: 'c-mig' }], undo: [], redo: [], operationLog: [] };
  cloud.seedTeacher('20260001@' + ACCOUNT_DOMAIN, 'old-pass-9', { display_name: '迁移老师' }, state);
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');
  site.q('#loginEmail').value = '20260001';
  site.q('#loginPassword').value = 'old-pass-9';
  site.q('#btnAccountLogin').click();
  await until(() => site.q('#gate').hidden, '迁移老师登录');
  check('迁移老师用原数字账号、原密码直接登录', !site.w.document.body.classList.contains('gated') && /迁移老师/.test(site.q('#userName').textContent));
  check('登录后拿到原来的成绩（云端 v7）', site.w.JFDT_CLOUD.status().cloudVersion === 7 && cloud.users.size === 1);
  check('不需要再兑换邀请码', !cloud.requests.some((r) => r.path === '/rest/v1/rpc/hx_redeem'));
  site.w.close();
}

/* ---------------- 场景六 b：11445 已并入开发者账号（GitHub 账号，排课里账号名 11445） ---------------- */

{
  const cloud = createCloud({ confirmEmail: true });
  const dev = cloud.seedTeacher('zcq@privaterelay.appleid.com', 'dev-pass-1', { display_name: '夜夜', role: 'admin' }, { version: 1, classes: [], lessons: [], undo: [], redo: [], operationLog: [] });
  cloud.usernames = { '11445': dev.id };
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');
  site.q('#loginEmail').value = '11445';
  site.q('#loginPassword').value = 'dev-pass-1';
  site.q('#btnAccountLogin').click();
  await until(() => site.q('#gate').hidden, '11445 登录');
  check('输入 11445 先查排课账号名，登进开发者账号', cloud.requests.some((r) => r.path === '/auth/v1/token' && r.body.email === 'zcq@privaterelay.appleid.com'));
  check('同一个号：没有另建 11445@jfdt.app', cloud.users.size === 1);
  site.w.close();
}

/* ---------------- 场景七：学生账号、未开通的账号被拦 ---------------- */

{
  const cloud = createCloud({ confirmEmail: false });
  const stu = { email: 'stu@example.com', password: 'stu-pass-1' };
  await cloud.fetch(SUPABASE + '/auth/v1/signup', { method: 'POST', body: JSON.stringify(stu) });
  cloud.students.add(cloud.byEmail.get(stu.email));
  await cloud.fetch(SUPABASE + '/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'paike-new@example.com', password: 'new-pass-1' }) });
  const site = openSite({ cloud });
  await until(() => site.q('#gate') && !site.q('#gate').hidden, '登录闸门出现');
  site.q('#loginEmail').value = stu.email;
  site.q('#loginPassword').value = stu.password;
  site.q('#btnAccountLogin').click();
  await until(() => /学生账号/.test(site.q('#gateMsg').textContent), '学生被拒');
  check('学生账号登录被拒并说明原因', site.w.document.body.classList.contains('gated') && !site.w.localStorage.getItem('jfdt.supabase.session.v1'));
  site.q('#loginEmail').value = 'paike-new@example.com';
  site.q('#loginPassword').value = 'new-pass-1';
  site.q('#btnAccountLogin').click();
  await until(() => /教师身份/.test(site.q('#gateMsg').textContent), '未开通被拒');
  check('没开通教师身份的账号被拒', site.w.document.body.classList.contains('gated'));
  check('被拒的账号没有碰到 jf_ 表', !cloud.requests.some((r) => r.path.startsWith('/rest/v1/jf_')));
  check('运行期没有前端异常', site.errors.length === 0);
  site.w.close();
}

console.log(`\n登录与同步链路：${passed} 项通过`);
process.exit(0);
