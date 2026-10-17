const ITERATIONS = 100000;
const SESSION_SECONDS = 30 * 24 * 3600;
const MAX_BODY = 1500000;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const random = (size = 32) => hex(crypto.getRandomValues(new Uint8Array(size)));
const digest = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
function fail(status, message, code = 'request_failed') {
  throw Object.assign(new Error(message), { status, code });
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt),
    iterations: ITERATIONS, hash: 'SHA-256' }, key, 256));
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function publicUser(row) {
  return { uid: row.id, username: row.username, displayName: row.display_name,
    realName: row.real_name || '', isAdmin: row.role === 'admin', joinedAt: row.created_at };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
async function bodyOf(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) fail(413, '记录太大，请先备份并整理历史课次。');
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) fail(415, '请使用 JSON 格式。');
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_BODY) fail(413, '记录太大，请先备份并整理历史课次。');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON 须为对象。');
    return value;
  } catch { fail(400, 'JSON 格式不正确。'); }
}
function text(value, maximum = 80) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) fail(400, '密码长度需为 6–128 位。');
}
function validateState(data) {
  if (!data || !Array.isArray(data.classes) || !Array.isArray(data.lessons) || data.classes.length > 100 || data.lessons.length > 3000) {
    fail(400, '班级或课次数据格式不正确。');
  }
  const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x);
  const ids = new Set();
  for (const cls of data.classes) {
    if (!validId(cls.id) || ids.has(cls.id) || !text(cls.name) || !Array.isArray(cls.groups)
        || !Array.isArray(cls.roster) || cls.groups.length > 100 || cls.roster.length > 1000) fail(400, '班级数据格式不正确。');
    ids.add(cls.id);
    if (cls.assessmentSettings !== undefined) {
      const cfg=cls.assessmentSettings;
      if (!cfg || typeof cfg!=='object' || Array.isArray(cfg)) fail(400,'赋分考勤设置格式不正确。');
      for (const field of ['totalLessons','late','truant','leave','early','passScore']) {
        if (!Number.isInteger(cfg[field]) || cfg[field]<(field==='totalLessons'?1:0) || cfg[field]>(field==='totalLessons'?1000:100)) fail(400,'赋分考勤设置超出范围。');
      }
      if (cfg.taskTarget!==undefined && (!Number.isInteger(cfg.taskTarget)||cfg.taskTarget<0||cfg.taskTarget>100000)) fail(400,'任务满分基准须为0–100000整数。');
      if (cfg.bonusCap!==undefined && (!Number.isInteger(cfg.bonusCap)||cfg.bonusCap<0||cfg.bonusCap>5)) fail(400,'小组奖励上限须为0–5整数。');
      if (!Array.isArray(cfg.customRules) || cfg.customRules.length>20 || cfg.customRules.some(r=>!r || !/^custom_[a-z0-9_]{1,80}$/.test(r.id) || typeof r.name!=='string' || !r.name.trim() || r.name.length>40 || !Number.isInteger(r.loss) || r.loss<0 || r.loss>100)
        || new Set(cfg.customRules.map(r=>r.id)).size!==cfg.customRules.length || new Set(cfg.customRules.map(r=>r.name)).size!==cfg.customRules.length) fail(400,'自定义考勤规则不正确。');
    }
    if (cls.examScores !== undefined && (!cls.examScores || typeof cls.examScores!=='object' || Array.isArray(cls.examScores) || Object.keys(cls.examScores).length>1000 || Object.entries(cls.examScores).some(([k,v])=>k.length>200 || !Number.isFinite(v) || v<0 || v>100))) fail(400,'期末成绩须为0–100分。');
    if (cls.foundationChecks!==undefined && (!cls.foundationChecks || typeof cls.foundationChecks!=='object' || Array.isArray(cls.foundationChecks) || Object.keys(cls.foundationChecks).length>1000 || Object.entries(cls.foundationChecks).some(([k,v])=>k.length>200 || !['pending','met','makeup'].includes(v)))) fail(400,'基础要求确认状态不正确。');
    const numbers = new Set();
    for (const group of cls.groups) {
      if (!Number.isInteger(group.no) || group.no < 1 || numbers.has(group.no)
          || !Array.isArray(group.members) || group.members.length > 6) fail(400, '小组数据格式不正确。');
      numbers.add(group.no);
      for (const member of group.members) if (!member || typeof member.name !== 'string') fail(400, '成员数据格式不正确。');
    }
    for (const member of cls.roster) if (!member || typeof member.name !== 'string') fail(400, '名单数据格式不正确。');
  }
  const lessonIds = new Set();
  for (const lesson of data.lessons) {
    if (!validId(lesson.id) || lessonIds.has(lesson.id) || !ids.has(lesson.classId)
        || !Number.isInteger(lesson.seq) || lesson.seq < 1 || lesson.seq > 10000
        || typeof lesson.topic !== 'string' || typeof lesson.date !== 'string'
        || !lesson.scores || Array.isArray(lesson.scores) || typeof lesson.scores !== 'object') fail(400, '课次数据格式不正确。');
    lessonIds.add(lesson.id);
    if (lesson.attendance !== undefined) {
      if (!lesson.attendance || typeof lesson.attendance!=='object' || Array.isArray(lesson.attendance) || Object.keys(lesson.attendance).length>1000) fail(400,'考勤记录格式不正确。');
      for (const [key,record] of Object.entries(lesson.attendance)) {
        if (key.length>200 || !record || typeof record!=='object' || typeof record.status!=='string' || !/^(present|late|truant|leave|early|custom_[a-z0-9_]{1,80})$/.test(record.status) || typeof record.label!=='string' || record.label.length>60 || !Number.isInteger(record.loss) || record.loss<0 || record.loss>100 || typeof record.updatedAt!=='string' || !Number.isFinite(Date.parse(record.updatedAt))) fail(400,'考勤状态或扣单位不正确。');
      }
    }
    if (lesson.leaderScores !== undefined) {
      if (!lesson.leaderScores || typeof lesson.leaderScores !== 'object' || Array.isArray(lesson.leaderScores)
          || Object.keys(lesson.leaderScores).length > 100) fail(400, '组内个人评分格式不正确。');
      for (const [number, record] of Object.entries(lesson.leaderScores)) {
        if (!/^[1-9]\d{0,2}$/.test(number) || !record || typeof record !== 'object'
            || !Array.isArray(record.projects) || record.projects.length !== 10
            || record.projects.some(p => typeof p !== 'string' || p.length > 80)
            || !record.members || typeof record.members !== 'object' || Array.isArray(record.members)
            || Object.keys(record.members).length > 1000
            || typeof record.signedBy !== 'string' || record.signedBy.length > 100
            || typeof record.note !== 'string' || record.note.length > 500) fail(400, '组内个人评分格式不正确。');
        for (const [member, scores] of Object.entries(record.members)) {
          if (!/^[a-zA-Z0-9_:-]{1,128}$/.test(member) || !Array.isArray(scores) || scores.length !== 10
              || scores.some(n => n !== null && (!Number.isInteger(n) || n < 0 || n > 5))) fail(400, '个人评分每项须为0–5的整数或留空。');
        }
      }
    }
    for (const score of Object.values(lesson.scores)) {
      if (!score || typeof score !== 'object' || Array.isArray(score)) fail(400, '记分数据格式不正确。');
      for (const field of ['first', 'group', 'phone', 'duty']) {
        if (score[field] !== undefined && (!Number.isFinite(score[field]) || score[field] < 0 || score[field] > 1000000)) fail(400, '分数须为有效非负数。');
      }
      if (score.personal && (Array.isArray(score.personal) || typeof score.personal !== 'object'
          || Object.values(score.personal).some(v => !Number.isFinite(v) || v < 0 || v > 1000000))) fail(400, '个人扣分数据不正确。');
    }
  }
}
async function throttle(request, env, username, route) {
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  for (const scope of ['ip:' + ip, 'name:' + username]) {
    const bucket = await digest(route + ':' + scope);
    await env.DB.prepare(`INSERT INTO auth_attempts(bucket,window_start,attempts) VALUES(?,?,1)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window_start < ? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END`)
      .bind(bucket, now, now - 900, now - 900).run();
    const row = await env.DB.prepare('SELECT attempts FROM auth_attempts WHERE bucket=?').bind(bucket).first();
    if (row.attempts > (scope.startsWith('ip:') ? 40 : 10)) fail(429, '尝试过于频繁，请 15 分钟后重试。', 'rate_limited');
  }
}
async function createSession(user, env) {
  const token = random();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .bind(await digest(token), user.id, expiresAt, new Date().toISOString()).run();
  return { token, expiresAt, user: publicUser(user) };
}
async function authenticate(request, env) {
  const value = request.headers.get('Authorization') || '';
  const token = value.startsWith('Bearer ') ? value.slice(7) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, '请先登录。', 'unauthenticated');
  const hash = await digest(token);
  const row = await env.DB.prepare(`SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(hash, Math.floor(Date.now() / 1000)).first();
  if (!row) fail(401, '登录已过期，请重新登录。', 'unauthenticated');
  return row;
}
async function register(request, env, body) {
  const username = text(body.username, 32).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) fail(400, '账号需为 3–32 位字母、数字、下划线、点或短横线。');
  const password = body.password;
  validatePassword(password);
  const display = text(body.displayName);
  if (!display) fail(400, '请填写教师姓名或显示名。');
  await throttle(request, env, username, 'register');
  const code = text(body.inviteCode, 128).toUpperCase();
  if (!code) fail(400, '请填写邀请码。');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const first = count.n === 0;
  let invite;
  if (first) {
    if (!env.BOOTSTRAP_CODE) fail(503, '管理员尚未初始化，请联系维护者。');
    if (!equal(await digest(code), await digest(env.BOOTSTRAP_CODE.toUpperCase()))) fail(400, '邀请码无效。');
  } else {
    invite = await env.DB.prepare('SELECT * FROM invites WHERE code_hash=? AND used_by IS NULL AND disabled=0')
      .bind(await digest(code)).first();
    if (!invite) fail(400, '邀请码无效、已使用或已停用。');
  }
  const id = crypto.randomUUID();
  const salt = random(16);
  const hash = await passwordHash(password, salt);
  const at = new Date().toISOString();
  const role = first ? 'admin' : invite.role;
  const values = [id, username, hash, salt, display, role, at];
  const insert = `INSERT INTO users(id,username,password_hash,password_salt,display_name,role,created_at) SELECT ?,?,?,?,?,?,?`;
  const statements = first ? [env.DB.prepare('INSERT INTO setup_lock(id) VALUES(1)'), env.DB.prepare(insert).bind(...values)]
    : [env.DB.prepare(insert + ' WHERE EXISTS(SELECT 1 FROM invites WHERE code_hash=? AND used_by IS NULL AND disabled=0)')
      .bind(...values, invite.code_hash),
    env.DB.prepare('UPDATE invites SET used_by=?,used_at=? WHERE code_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)')
      .bind(id, at, invite.code_hash, id)];
  statements.push(env.DB.prepare('INSERT INTO score_states(owner_id,revision) SELECT id,0 FROM users WHERE id=?').bind(id));
  try {
    const result = await env.DB.batch(statements);
    if (!(result[first ? 1 : 0].meta.changes > 0)) fail(400, '邀请码已使用，请使用新的邀请码。');
  } catch (error) {
    if (error.status) throw error;
    if (/UNIQUE|constraint/i.test(error.message)) fail(409, '账号已存在或邀请码已使用，请核对后重试。');
    throw error;
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  return json(await createSession(user, env), 201);
}
async function route(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === '/api/health' && method === 'GET') return json({ ok: true, service: 'ye-ye-score-api', version: 2 });
  if (!env.DB) fail(503, '数据库尚未配置。');
  if (path === '/api/auth/register' && method === 'POST') return register(request, env, await bodyOf(request));
  if (path === '/api/auth/reset-password' && method === 'POST') {
    const body = await bodyOf(request);
    const username = text(body.username, 32).toLowerCase();
    validatePassword(body.password);
    await throttle(request, env, username, 'reset-password');
    const code = text(body.code, 128).toUpperCase();
    const codeHash = await digest(code);
    const target = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    if (!target || !code) fail(400, '账号或重置码无效、已使用或已过期。');
    const now = Math.floor(Date.now() / 1000);
    if (target.role === 'admin' && env.PASSWORD_RECOVERY_CODE && equal(codeHash, await digest(env.PASSWORD_RECOVERY_CODE.toUpperCase()))) {
      await env.DB.prepare('INSERT OR IGNORE INTO password_resets(token_hash,user_id,expires_at,created_by) VALUES(?,?,?,?)')
        .bind(codeHash, target.id, now + 1800, 'site-owner').run();
    }
    const salt = random(16), hash = await passwordHash(body.password, salt);
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND EXISTS
        (SELECT 1 FROM password_resets WHERE token_hash=? AND user_id=? AND used_at IS NULL AND expires_at>?)`)
        .bind(hash, salt, target.id, codeHash, target.id, now),
      env.DB.prepare(`UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL AND
        EXISTS(SELECT 1 FROM users WHERE id=? AND password_salt=?)`).bind(now, target.id, target.id, salt),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_salt=?)`)
        .bind(target.id, target.id, salt)
    ]);
    if (!result[0].meta.changes) fail(400, '账号或重置码无效、已使用或已过期。');
    return json({ ok: true });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await bodyOf(request);
    const username = text(body.username, 32).toLowerCase();
    await throttle(request, env, username, 'login');
    const user = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
    const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
    const hash = await passwordHash(password, user ? user.password_salt : 'invalid-user-constant-salt');
    if (!user || !equal(hash, user.password_hash)) fail(401, '账号或密码不正确。', 'invalid_credentials');
    await env.DB.prepare('UPDATE users SET last_seen_at=? WHERE id=?').bind(new Date().toISOString(), user.id).run();
    return json(await createSession(user, env));
  }
  const user = await authenticate(request, env);
  if (path === '/api/auth/change-password' && method === 'POST') {
    const body = await bodyOf(request);
    validatePassword(body.password);
    await throttle(request, env, user.username, 'change-password');
    if (typeof body.oldPassword !== 'string' || body.oldPassword.length > 128 ||
        !equal(await passwordHash(body.oldPassword, user.password_salt), user.password_hash)) fail(400, '原密码不正确。');
    const salt = random(16), hash = await passwordHash(body.password, salt);
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND password_hash=?')
        .bind(hash, salt, user.id, user.password_hash),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_salt=?)')
        .bind(user.id, user.id, salt),
      env.DB.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_salt=?)')
        .bind(Math.floor(Date.now()/1000), user.id, user.id, salt)
    ]);
    if (!result[0].meta.changes) fail(409, '密码已在其他地方修改，请重新登录。');
    return json({ ok: true });
  }
  if (path === '/api/auth/me' && method === 'GET') return json({ user: publicUser(user) });
  if (path === '/api/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run();
    return json({ ok: true });
  }
  if (path === '/api/profile' && method === 'PUT') {
    const body = await bodyOf(request);
    const name = text(body.displayName);
    if (!name) fail(400, '名字不能为空。');
    await env.DB.prepare('UPDATE users SET display_name=?,real_name=? WHERE id=?').bind(name, text(body.realName), user.id).run();
    return json({ user: publicUser(await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first()) });
  }
  if (path === '/api/state' && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM score_states WHERE owner_id=?').bind(user.id).first();
    return json({ data: row && row.data ? JSON.parse(row.data) : null, revision: row ? row.revision : 0, updated_at: row ? row.updated_at : null });
  }
  if (path === '/api/state' && method === 'PUT') {
    const body = await bodyOf(request);
    validateState(body.data);
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) fail(400, '同步版本不正确。');
    const at = new Date().toISOString();
    const result = await env.DB.prepare('UPDATE score_states SET data=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?')
      .bind(JSON.stringify(body.data), at, user.id, body.baseRevision).run();
    if (!result.meta.changes) fail(409, '另一台设备已更新记录。本机记录已保留，请先下载备份，再选择拉取云端或覆盖云端。', 'version_conflict');
    return json({ ok: true, revision: body.baseRevision + 1, updated_at: at });
  }
  if (!path.startsWith('/api/admin/')) fail(404, '接口不存在。');
  if (user.role !== 'admin') fail(403, '只有管理员能操作。', 'forbidden');
  if (path === '/api/admin/password-reset' && method === 'POST') {
    const body = await bodyOf(request);
    await throttle(request, env, user.username, 'issue-password-reset');
    const target = await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(text(body.username,32).toLowerCase()).first();
    if (!target) fail(404, '没有找到该教师账号。');
    const code = random(16).toUpperCase(), expiresAt = Math.floor(Date.now()/1000) + 1800;
    await env.DB.batch([
      env.DB.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').bind(Math.floor(Date.now()/1000), target.id),
      env.DB.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at,created_by) VALUES(?,?,?,?)')
        .bind(await digest(code), target.id, expiresAt, user.id)
    ]);
    return json({ code, expiresAt }, 201);
  }
  if (path === '/api/admin/invites' && method === 'POST') {
    const body = await bodyOf(request);
    const count = Math.min(50, Math.max(1, Math.trunc(Number(body.count) || 1)));
    const codes = Array.from({ length: count }, () => random(10).toUpperCase().match(/.{1,4}/g).join('-'));
    const at = new Date().toISOString();
    const statements = await Promise.all(codes.map(async code => env.DB.prepare(
      'INSERT INTO invites(code_hash,code,role,note,created_by,created_at) VALUES(?,?,?,?,?,?)')
      .bind(await digest(code), code, body.role === 'admin' ? 'admin' : 'teacher', text(body.note, 160), user.id, at)));
    await env.DB.batch(statements);
    return json({ created: codes.length, codes }, 201);
  }
  if (path === '/api/admin/invites' && method === 'GET') {
    const result = await env.DB.prepare(`SELECT i.code,i.note,i.role,i.created_at,i.disabled,
      CASE WHEN i.used_by IS NULL THEN 0 ELSE 1 END AS is_used,u.display_name AS used_by_name
      FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 500`).all();
    return json(result.results);
  }
  if (path === '/api/admin/teachers' && method === 'GET') {
    const result = await env.DB.prepare(`SELECT u.id AS uid,u.display_name,u.real_name,u.role,u.created_at,u.last_seen_at,
      s.updated_at AS synced_at,s.data FROM users u LEFT JOIN score_states s ON s.owner_id=u.id ORDER BY u.created_at`).all();
    return json(result.results.map(row => {
      const data = row.data ? JSON.parse(row.data) : {};
      return { uid: row.uid, display_name: row.display_name, real_name: row.real_name, is_admin: row.role === 'admin',
        joined_at: row.created_at, synced_at: row.synced_at, class_count: (data.classes || []).length, lesson_count: (data.lessons || []).length };
    }));
  }
  if (path.startsWith('/api/admin/teachers/') && method === 'GET') {
    const id = decodeURIComponent(path.slice('/api/admin/teachers/'.length));
    const row = await env.DB.prepare('SELECT data,updated_at FROM score_states WHERE owner_id=?').bind(id).first();
    return json({ ok: true, data: row && row.data ? JSON.parse(row.data) : null, updated_at: row ? row.updated_at : null });
  }
  fail(404, '接口不存在。');
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
    const accepted = !origin || origin === new URL(request.url).origin || allowed.includes(origin);
    let response;
    try {
      if (!accepted) fail(403, '当前站点未获准访问。', 'origin_denied');
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env);
    } catch (error) {
      response = json({ error: { code: error.code || 'server_error', message: error.status ? error.message : '服务暂时不可用，请稍后重试。' } }, error.status || 500);
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Vary', 'Origin');
    if (origin && accepted) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    }
    return new Response(response.body, { status: response.status, headers });
  }
};
