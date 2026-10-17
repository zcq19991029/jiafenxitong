import assert from 'node:assert/strict';
import fs from 'node:fs';
import { api, environment, initialAdmin, PASSWORD, ORIGIN } from './lib/test-d1.mjs';
let passed = 0;
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS', name); }
const env = environment();
check('configured browser CORS preflight is allowed', (await api(env, '/api/state', 'OPTIONS')).status === 204);
check('unapproved origins are rejected', (await api(env, '/api/health', 'GET', undefined, undefined, 'https://bad.example')).status === 403);
check('anonymous state access is rejected', (await api(env, '/api/state')).status === 401);
check('missing bootstrap configuration cannot create an administrator', (await api({ ...env, BOOTSTRAP_CODE: '' }, '/api/auth/register', 'POST',
  { username: 'no-admin', password: PASSWORD, displayName: '测试', inviteCode: 'x' })).status === 503);
check('wrong bootstrap code is rejected', (await api(env, '/api/auth/register', 'POST',
  { username: 'wrong-admin', password: PASSWORD, displayName: '测试', inviteCode: 'wrong-code' })).status === 400);
const admin = await initialAdmin(env);
check('first valid registration becomes administrator', admin.user.isAdmin === true);
check('bootstrap code cannot be reused', (await api(env, '/api/auth/register', 'POST',
  { username: 'second-admin', password: PASSWORD, displayName: '测试', inviteCode: env.BOOTSTRAP_CODE })).status === 400);
const stored = env.sqlite.prepare('SELECT * FROM users WHERE id=?').get(admin.user.uid);
check('passwords are salted and hashed', stored.password_hash.length === 64 && stored.password_hash !== PASSWORD && stored.password_salt.length >= 32);
check('session tokens are stored as digests only', !env.sqlite.prepare('SELECT token_hash FROM sessions').all().some(x => x.token_hash === admin.token));
check('wrong passwords do not sign in', (await api(env, '/api/auth/login', 'POST', { username: 'admin-test', password: 'invalid-password' })).status === 401);
check('correct credentials sign in', (await api(env, '/api/auth/login', 'POST', { username: 'ADMIN-TEST', password: PASSWORD })).status === 200);
check('null JSON is rejected cleanly', (await api(env, '/api/auth/login', 'POST', null)).status === 400);
const created = await api(env, '/api/admin/invites', 'POST', { count: 3, note: 'synthetic fixture', role: 'teacher' }, admin.token);
check('administrator can generate multiple invites', created.status === 201 && created.data.codes.length === 3);
const teacher = await api(env, '/api/auth/register', 'POST', { username: 'teacher-a', password: PASSWORD,
  displayName: '教师甲示例', inviteCode: created.data.codes[0] });
check('teacher registration is scoped to invite role', teacher.status === 201 && teacher.data.user.isAdmin === false);
check('one-time invites cannot be replayed', (await api(env, '/api/auth/register', 'POST', { username: 'teacher-replay', password: PASSWORD,
  displayName: '教师示例', inviteCode: created.data.codes[0] })).status === 400);
check('teachers cannot list other teachers', (await api(env, '/api/admin/teachers', 'GET', undefined, teacher.data.token)).status === 403);
check('teachers cannot create admin invites', (await api(env, '/api/admin/invites', 'POST', { role: 'admin' }, teacher.data.token)).status === 403);
const template = JSON.parse(fs.readFileSync('data.example.js', 'utf8').split('window.SEED_DATA =')[1].trim().replace(/;$/, ''));
const state = { version: 1, classes: template.classes.slice(0, 2), lessons: [], undo: [], updatedAt: new Date().toISOString() };
const saved = await api(env, '/api/state', 'PUT', { data: state, baseRevision: 0, owner_id: admin.user.uid }, teacher.data.token);
check('first state save increments its revision', saved.status === 200 && saved.data.revision === 1);
check('request owner spoofing cannot overwrite another account', (await api(env, '/api/state', 'GET', undefined, admin.token)).data.data === null);
check('teacher can recover own state from another session', (await api(env, '/api/state', 'GET', undefined, teacher.data.token)).data.data.classes.length === 2);
check('stale concurrent writes are rejected', (await api(env, '/api/state', 'PUT', { data: state, baseRevision: 0 }, teacher.data.token)).status === 409);
const invalid = structuredClone(state);
invalid.classes[0].id = '<script>';
check('unsafe identifiers are rejected before storage', (await api(env, '/api/state', 'PUT', { data: invalid, baseRevision: 1 }, teacher.data.token)).status === 400);
check('profile updates cannot escalate teacher role', (await api(env, '/api/profile', 'PUT', { displayName: '教师示例', role: 'admin' }, teacher.data.token)).data.user.isAdmin === false);
check('administrator sees teacher summary without passwords', !(JSON.stringify((await api(env, '/api/admin/teachers', 'GET', undefined, admin.token)).data).includes('password_hash')));
check('administrator can inspect a teacher record', (await api(env, '/api/admin/teachers/' + teacher.data.user.uid, 'GET', undefined, admin.token)).data.data.classes.length === 2);
check('no authentication responses are cached', saved.headers.get('cache-control') === 'no-store' && saved.headers.get('access-control-allow-origin') === ORIGIN);
await api(env, '/api/auth/logout', 'POST', {}, teacher.data.token);
check('logout invalidates server session', (await api(env, '/api/auth/me', 'GET', undefined, teacher.data.token)).status === 401);
const limited = environment();
let last;
for (let i = 0; i < 11; i++) last = await api(limited, '/api/auth/login', 'POST', { username: 'rate-test', password: 'wrong-password' });
check('repeated credential attempts are rate limited', last.status === 429);
limited.sqlite.close();
const race = environment();
const registration = name => api(race, '/api/auth/register', 'POST', { username: name, password: PASSWORD, displayName: '测试管理员', inviteCode: race.BOOTSTRAP_CODE });
const winners = await Promise.all([registration('race-admin-a'), registration('race-admin-b')]);
check('concurrent bootstrap can create only one administrator', winners.filter(x => x.status === 201).length === 1
  && race.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n === 1);
race.sqlite.close(); env.sqlite.close();
console.log(`Backend regression: ${passed} passed, 0 failed`);
