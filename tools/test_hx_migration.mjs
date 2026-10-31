/* 并入华夏工具项目的迁移 SQL 本机测试（不联网）。
 *
 * 用 pglite（WASM 版 Postgres）开两个库，模拟旧项目和新项目：
 *   旧库：auth.users / auth.identities（仿 Supabase，带自动生成列）+ supabase-schema.sql（旧结构和注册触发器），塞测试账号和成绩；
 *   新库：排课 schema.sql + 华夏工具 rank-schema.sql + supabase-hx-schema.sql，已有 zcq（GitHub）和一个学生。
 * 然后走真实流程：旧库跑 1-export-old.sql → 结果按 Supabase「Download CSV」的格式落盘 → build-import.mjs 生成导入 SQL → 新库运行（两遍）。
 * 最后按各种身份查表，核对：原 id、原密码散列、成绩逐字一致、同邮箱映射、学生被拦、不装触发器、补数据只覆盖更新的版本。
 *
 * 依赖排课、接线仿真两个项目里的 SQL（路径可用 PAIKE_SCHEMA、RANK_SCHEMA 改），所以不放进 CI。
 * 运行：node tools/test_hx_migration.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBundle, importSql } from './hx-migrate/build-import.mjs';

const require = createRequire(new URL('./test-runtime/', import.meta.url));
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE = 'C:/Users/25466/Desktop/claude项目';
const PAIKE_SCHEMA = process.env.PAIKE_SCHEMA || CLAUDE + '/排课系统/晚修排课/supabase/schema.sql';
const RANK_SCHEMA = process.env.RANK_SCHEMA || CLAUDE + '/视频/电气控制教学动画/supabase/rank-schema.sql';
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0;
function check(name, ok) { assert.ok(ok, name); passed++; console.log('PASS', name); }

/* 仿 Supabase 的 auth 表：confirmed_at、identities.email 是自动生成列，导入时必须跳过 */
const AUTH = (extra) => `
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255) unique,
  encrypted_password varchar(255), email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token varchar(255) default '', is_anonymous boolean not null default false,
  confirmed_at timestamptz generated always as (email_confirmed_at) stored ${extra}
);
create table auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null,
  provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data->>'email')) stored, id uuid primary key default gen_random_uuid(),
  unique (provider_id, provider)
);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('my.uid', true), '')::uuid $f$;
grant execute on function auth.uid() to anon, authenticated;
`;

const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const T1 = U(1), T2 = U(2), ANON0 = U(3), ANON1 = U(4), STU_OLD = U(5);
const ZCQ = U(91), STU_NEW = U(92);
const HASH1 = '$2a$10$abcdefghijklmnopqrstuuOldHashForTeacherOne.........';
const STATE1 = {
  version: 1, classes: [{ id: 'c1', name: '26工器1班', roster: [{ id: 's1', name: '测试学生甲' }, { id: 's2', name: '测试"乙"\\丙' }] }],
  lessons: [{ id: 'l1', classId: 'c1', title: '第一课 $mig$ $bundle 单引号\' 换行\n' }], undo: [], redo: [], operationLog: [{ t: 1, v: 5 }]
};

/* ---------------- 旧项目 ---------------- */
const old = new PGlite();
await old.exec(AUTH(', legacy_col text'));
await old.exec(src('supabase-schema.sql'));
const addUser = (db, id, email, hash, extra = {}) => db.query(
  `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous)
   values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), '{"provider":"email","providers":["email"]}', $4, now(), now(), $5)`,
  [id, email, hash, JSON.stringify(extra.meta || {}), !!extra.anon]);
await addUser(old, T1, '20260001@jfdt.app', HASH1, { meta: { username: '20260001', display_name: '数字账号老师' } });
await addUser(old, T2, '11445@JFDT.app', '$2a$10$teacher2hash', { meta: { display_name: '夜夜' } });
await addUser(old, ANON0, null, null, { anon: true });
await addUser(old, ANON1, null, null, { anon: true });
await addUser(old, STU_OLD, 'stu@example.com', '$2a$10$stuhash', {});
for (const [id, email] of [[T1, '20260001@jfdt.app'], [T2, '11445@jfdt.app'], [STU_OLD, 'stu@example.com']]) {
  await old.query(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2::uuid, $3, 'email', now(), now())`,
    [id, id, JSON.stringify({ sub: id, email })]);
}
await old.query(`update public.profiles set role = 'admin', real_name = '数字' where id = $1`, [T1]);
await old.query(`update public.score_states set data = $2, revision = 12, updated_at = now() where owner_id = $1`, [T1, JSON.stringify(STATE1)]);
await old.query(`update public.score_states set data = $2, revision = 3, updated_at = now() where owner_id = $1`, [T2, JSON.stringify({ ...STATE1, classes: [] })]);
await old.query(`update public.score_states set data = $2, revision = 2 where owner_id = $1`, [ANON1, JSON.stringify({ ...STATE1, classes: [] })]);
await old.query(`insert into public.invites (code_hash, code, created_by, used_by, used_at) values ('h1', 'OLDCODE', $1, $2, now())`, [T1, T2]);
const oldMd5 = (await old.query(`select md5(data::text) m from public.score_states where owner_id = $1`, [T1])).rows[0].m;

const bundle = (await old.query(src('tools/hx-migrate/1-export-old.sql'))).rows[0].bundle;
check('旧库导出：5 个账号、5 份资料和成绩、1 个邀请码', bundle.users.length === 5 && bundle.profiles.length === 5 && bundle.score_states.length === 5 && bundle.invites.length === 1);
check('导出带密码散列（迁移要靠它）', bundle.users.find((u) => u.id === T1).encrypted_password === HASH1);

/* 按 Supabase「Download CSV」的样子落盘，再走 build-import.mjs */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-hx-'));
const csvPath = path.join(dir, '旧项目备份.csv');
fs.writeFileSync(csvPath, 'bundle\n"' + JSON.stringify(bundle).replace(/"/g, '""') + '"\n', 'utf8');
const parsed = parseBundle(fs.readFileSync(csvPath, 'utf8'));
check('CSV 读回来和导出一致', JSON.stringify(parsed) === JSON.stringify(bundle));
assert.throws(() => parseBundle(JSON.stringify({ ...bundle, users: bundle.users.slice(1) })), /备份不完整/);
check('行数对不上（复制被截断）时拒绝生成', true);
const IMPORT = importSql(parsed);

/* ---------------- 新项目 ---------------- */
const neu = new PGlite();
await neu.exec(AUTH(', is_sso_user boolean not null default false'));
await addUser(neu, ZCQ, 'zcq@privaterelay.appleid.com', '$2a$10$zcqNewProjectHash', {});
await neu.query(`insert into auth.identities (provider_id, user_id, identity_data, provider) values ('280418913', $1, '{"user_name":"zcq19991029"}', 'github')`, [ZCQ]);
await addUser(neu, STU_NEW, 'STU@example.com', '$2a$10$x', {});
await neu.exec(fs.readFileSync(PAIKE_SCHEMA, 'utf8'));
await neu.exec(fs.readFileSync(RANK_SCHEMA, 'utf8'));
await neu.query(`insert into public.hx_profiles (user_id, role) values ($1, 'student')`, [STU_NEW]);
await neu.exec(src('supabase-hx-schema.sql'));
await neu.exec(src('supabase-hx-schema.sql')); // 可重复运行
const pre = (await neu.query(src('tools/hx-migrate/0-check-new.sql'))).rows;
check('第 0 步检查：身份函数和 jf_ 表都在', pre.find((r) => r.item === 'hx_is_teacher 函数').value === 'true' && pre.find((r) => r.item === 'jf_score_states 表').value === 'true');

await neu.exec(IMPORT);
const one = async (sql, p) => (await neu.query(sql, p)).rows[0];
const all = async (sql, p) => (await neu.query(sql, p)).rows;

const u1 = await one(`select id, encrypted_password, email, confirmed_at is not null c, is_sso_user from auth.users where id = $1`, [T1]);
check('数字账号老师按原 id 迁入，密码散列原样', u1 && u1.encrypted_password === HASH1 && u1.email === '20260001@jfdt.app');
check('自动生成列由新库自己算（confirmed_at 有值），新库多出来的列取默认值', u1.c === true && u1.is_sso_user === false);
check('登录身份 identities 一起迁入', (await one(`select count(*)::int n from auth.identities where user_id = $1 and provider = 'email' and email = '20260001@jfdt.app'`, [T1])).n === 1);
check('11445 不新建账号，按 GitHub 编号并入开发者账号', !(await one(`select 1 x from auth.users where id = $1`, [T2])) && !(await one(`select 1 x from auth.users where lower(email) = '11445@jfdt.app'`)) && (await one(`select new_id from jf_migration_log where old_id = $1`, [T2])).new_id === ZCQ);
check('开发者账号邮箱不动，密码换成旧 11445 的散列', (await (async () => { const r = await one(`select email, encrypted_password from auth.users where id = $1`, [ZCQ]); return r.email === 'zcq@privaterelay.appleid.com' && r.encrypted_password === '$2a$10$teacher2hash'; })()));
check('zcq 的成绩挂到新项目账号上', (await one(`select revision from jf_score_states where owner_id = $1`, [ZCQ])).revision === '3' || (await one(`select revision from jf_score_states where owner_id = $1`, [ZCQ])).revision == 3);
check('开发者账号是教师 + 管理员 + 开发者', (await (async () => { const r = await one(`select role, is_admin, is_dev from hx_profiles where user_id = $1`, [ZCQ]); return r.role === 'teacher' && r.is_admin && r.is_dev; })()));
check('开发者账号带上 11445 的加分资料（夜夜，admin）', (await one(`select display_name, role from jf_profiles where id = $1`, [ZCQ])).display_name === '夜夜');
check('没记过课的访客不搬', !(await one(`select 1 x from auth.users where id = $1`, [ANON0])));
check('记过课的访客只保留成绩，不登记教师', !!(await one(`select 1 x from jf_score_states where owner_id = $1`, [ANON1])) && !(await one(`select 1 x from hx_profiles where user_id = $1`, [ANON1])));
check('迁入的老师登记为华夏工具教师', (await one(`select role from hx_profiles where user_id = $1`, [T1])).role === 'teacher');
const stuLog = await one(`select new_id, how from jf_migration_log where old_id = $1`, [STU_OLD]);
check('新项目里是学生的同邮箱账号：不改成教师，并在结果里提醒', stuLog.new_id === STU_NEW && /学生/.test(stuLog.how) && (await one(`select role from hx_profiles where user_id = $1`, [STU_NEW])).role === 'student');
check('成绩逐字一致（md5 和旧库相同）', (await one(`select md5(data::text) m, revision from jf_score_states where owner_id = $1`, [T1])).m === oldMd5);
check('资料原样（role=admin、姓名）', (await one(`select role, real_name, username from jf_profiles where id = $1`, [T1])).role === 'admin');
check('邀请码迁入并映射到新 id', (await one(`select created_by, used_by from jf_invites where code = 'OLDCODE'`)).used_by === ZCQ);
const result = (await neu.query(IMPORT.slice(IMPORT.lastIndexOf('select m.email')))).rows;
check('最后的结果表每个迁入账号一行', result.length === 4);

/* 重复运行：不报错、不重复 */
const before = await one(`select (select count(*) from auth.users)::int u, (select count(*) from jf_score_states)::int s`);
await neu.exec(IMPORT);
const after = await one(`select (select count(*) from auth.users)::int u, (select count(*) from jf_score_states)::int s`);
check('导入 SQL 重复运行不出错、不重复建', before.u === after.u && before.s === after.s);
check('重复运行后迁移记录的说明不变', /新建/.test((await one(`select how from jf_migration_log where old_id = $1`, [T1])).how));

/* ---------------- 按身份查表（RLS） ---------------- */
const as = async (uid, sql, p) => {
  await neu.exec(`reset role; select set_config('my.uid', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await neu.query(sql, p)).rows; } catch (e) { return 'ERR ' + e.message; } finally { await neu.exec('reset role'); }
};
check('迁入老师读得到自己的成绩', (await as(T1, `select data->'classes'->0->>'name' n from jf_score_states where owner_id = '${T1}'`))[0].n === '26工器1班');
check('迁入老师能保存（升版本）', Array.isArray(await as(T1, `update jf_score_states set revision = revision + 1 where owner_id = '${T1}'`)));
check('旧管理员（role=admin）能看到所有老师', (await as(T1, `select count(*)::int n from jf_score_states`))[0].n >= 3);
check('华夏工具开发者 zcq 能看到所有老师', (await as(ZCQ, `select count(*)::int n from jf_profiles`))[0].n >= 3);
check('老师不能把自己改成管理员', /permission denied/.test(await as(ZCQ, `update jf_profiles set role = 'admin' where id = '${ZCQ}'`)));
check('老师能改自己的显示名', Array.isArray(await as(ZCQ, `update jf_profiles set display_name = '赵' where id = '${ZCQ}'`)));
check('学生读不到任何成绩', (await as(STU_NEW, `select count(*)::int n from jf_score_states`))[0].n === 0);
check('学生建不了成绩行', /row-level security/.test(await as(STU_NEW, `insert into jf_score_states (owner_id, data) values ('${STU_NEW}', '{}')`)));
check('学生建不了资料行', /row-level security/.test(await as(STU_NEW, `insert into jf_profiles (id) values ('${STU_NEW}')`)));
check('未登录什么都读不到', /permission denied/.test(await as(null, `select * from jf_score_states`)));
check('迁移记录只有后台能看', /permission denied/.test(await as(T1, `select * from jf_migration_log`)));

/* 新教师（华夏工具邀请码开通）：网页第一次登录补建资料行，不能自封管理员 */
const NEWT = U(93);
await addUser(neu, NEWT, 'new@example.com', '$2a$10$n', {});
check('新项目没有注册触发器：新账号不会自动有加分资料', !(await one(`select 1 x from jf_profiles where id = $1`, [NEWT])));
await neu.query(`insert into hx_profiles (user_id, role) values ($1, 'teacher')`, [NEWT]);
check('新教师能补建自己的资料行', Array.isArray(await as(NEWT, `insert into jf_profiles (id, display_name) values ('${NEWT}', '新老师')`)));
check('补建时不能写 role', /permission denied/.test(await as(NEWT, `insert into jf_profiles (id, role) values ('${NEWT}', 'admin') on conflict do nothing`)));
check('新教师只看到自己', (await as(NEWT, `select count(*)::int n from jf_profiles`))[0].n === 1);

/* 停用旧站前再补一次：备份里版本更新的覆盖，更旧的不动 */
const later = JSON.parse(JSON.stringify(parsed));
const s1 = later.score_states.find((s) => s.owner_id === T1);
s1.revision = 99; s1.data.lessons.push({ id: 'l2', classId: 'c1' });
later.checks.state_md5[T1] = (await one(`select md5($1::jsonb::text) m`, [JSON.stringify(s1.data)])).m;
const s2 = later.score_states.find((s) => s.owner_id === T2);
s2.revision = 1; s2.data.lessons = [];
later.checks.state_md5[T2] = (await one(`select md5($1::jsonb::text) m`, [JSON.stringify(s2.data)])).m;
await neu.exec(importSql(later));
check('补数据：旧站更新的版本覆盖过来', (await one(`select jsonb_array_length(data->'lessons') n, revision from jf_score_states where owner_id = $1`, [T1])).n === 2);
check('补数据：新站已更新的不被旧版本覆盖', Number((await one(`select revision from jf_score_states where owner_id = $1`, [ZCQ])).revision) === 3);

/* 核对失败要整段撤销 */
const broken = JSON.parse(JSON.stringify(later));
broken.score_states.find((s) => s.owner_id === T1).revision = 100;
broken.checks.state_md5[T1] = 'not-the-same';
const usersBefore = (await one(`select count(*)::int n from auth.users`)).n;
let failed = '';
try { await neu.exec(importSql(broken)); } catch (e) { failed = e.message; }
check('成绩核对不一致时报错并整段撤销', /没有完整导入/.test(failed) && Number((await one(`select revision from jf_score_states where owner_id = $1`, [T1])).revision) === 99 && (await one(`select count(*)::int n from auth.users`)).n === usersBefore);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n迁移 SQL：${passed} 项通过`);
