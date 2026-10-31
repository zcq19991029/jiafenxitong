#!/usr/bin/env node
/*
 * 第 2 步：把旧项目导出的 bundle（1-export-old.sql 的结果，CSV 或 JSON 都行）变成新项目的导入 SQL。
 * 用法：node tools/hx-migrate/build-import.mjs 迁移记录/hx迁移/旧项目备份.csv
 * 输出：同目录下「…-导入新项目.sql」。只在本机生成，不联网；里面含密码散列，和备份一样不能进 Git。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OLD_PROJECT = 'hrzeciygelfwdmhftvew';
/* 并入开发者账号：旧项目里这些登录邮箱是开发者本人，不另建账号，数据挂到 GitHub 编号对应的那个账号上
   （GitHub 数字编号终身不变）。开发者账号的密码改成旧 11445 的密码（搬散列），GitHub 登录照旧。 */
export const MERGE_INTO_GITHUB = { '11445@jfdt.app': '280418913' };

export function parseBundle(text) {
  text = text.replace(/^﻿/, '').trim();
  let value;
  if (text.startsWith('{') || text.startsWith('[')) {
    value = JSON.parse(text);
    if (Array.isArray(value)) value = value[0] && value[0].bundle;
  } else {
    // Supabase「Download CSV」：第一行是列名 bundle，第二行是带引号的整段 JSON
    const body = text.slice(text.indexOf('\n') + 1).trim();
    value = body.startsWith('"') ? body.slice(1, body.lastIndexOf('"')).replace(/""/g, '"') : body;
  }
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || value.project !== OLD_PROJECT) throw new Error('这不是旧加分助手项目（' + OLD_PROJECT + '）导出的 bundle。');
  const c = value.checks || {};
  for (const k of ['users', 'profiles', 'score_states', 'invites']) {
    if (!Array.isArray(value[k]) || value[k].length !== Number(c[k])) {
      throw new Error('备份不完整：' + k + ' 应有 ' + c[k] + ' 行，实际 ' + (value[k] || []).length + ' 行。请重新导出。');
    }
  }
  return value;
}

export function importSql(bundle) {
  const json = JSON.stringify(bundle);
  /* 成绩里什么字符都可能有：两层 $标记$ 都用随机名，并确认数据里没有出现 */
  const tag = (name) => { for (;;) { const t = '$' + name + '_' + Math.random().toString(36).slice(2, 8) + '$'; if (!json.includes(t)) return t; } };
  const MIG = tag('mig'), BUNDLE = tag('bundle');
  return `-- 第 3 步：在【新项目 eiqgyrjrwdaunhxjmdyr】的 SQL Editor 里运行（先运行过 rank-schema.sql 和 supabase-hx-schema.sql）。
-- 由 tools/hx-migrate/build-import.mjs 生成，旧项目导出时间 ${bundle.exported_at}。
-- 作用：把旧加分助手的账号（原 id、原密码散列）、资料、成绩、邀请码搬进新项目，迁入的老师登记为华夏工具教师。
-- 整段是一个事务：中途任何一步出错（包括成绩核对不一致）都会全部撤销，什么都不留下。
-- 可以重复运行：已迁过的账号跳过；成绩只在备份的版本号比新项目里的大时才覆盖（用于停用旧站前再补一次最新数据）。
-- 含密码散列，用完不要外传。
do ${MIG}
declare
  b jsonb := ${BUNDLE}${json}${BUNDLE}::jsonb;
  u jsonb; ids jsonb; ouid uuid; nid uuid; anon boolean; how text; dev boolean;
  merge jsonb := '${JSON.stringify(MERGE_INTO_GITHUB)}'::jsonb;
  ucols text; icols text; bad int; n_skip int := 0;
begin
  if b->>'project' is distinct from '${OLD_PROJECT}' then raise exception '这不是旧加分助手项目的备份'; end if;
  if to_regprocedure('public.hx_is_teacher(uuid)') is null or to_regclass('public.jf_score_states') is null then
    raise exception '请先运行 rank-schema.sql 和 supabase-hx-schema.sql';
  end if;

  -- 两边 Supabase 版本可能差一点：只插两边都有、且不是自动生成的列
  select string_agg(quote_ident(attname), ', ' order by attnum) into ucols from pg_attribute
   where attrelid = 'auth.users'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity = ''
     and (b->'users'->0) ? attname::text;
  select string_agg(quote_ident(attname), ', ' order by attnum) into icols from pg_attribute
   where attrelid = 'auth.identities'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity = ''
     and (b->'identities'->0) ? attname::text;

  for u in select value from jsonb_array_elements(b->'users') loop
    ouid := (u->>'id')::uuid;
    anon := coalesce((u->>'is_anonymous')::boolean, false) or coalesce(u->>'email', '') = '';
    if anon and not exists (select 1 from jsonb_array_elements(b->'score_states') x
                            where x->>'owner_id' = ouid::text and jsonb_array_length(coalesce(x->'data'->'lessons', '[]')) > 0) then
      n_skip := n_skip + 1;  -- 没记过课的访客账号不搬
      continue;
    end if;
    nid := null; dev := false;
    if merge ? lower(coalesce(u->>'email', '')) then
      select user_id into nid from auth.identities where provider = 'github' and provider_id = merge->>lower(u->>'email');
      if nid is null then raise exception '新项目里找不到 GitHub 编号 % 的开发者账号，请先用 GitHub 登录一次排课或接线仿真', merge->>lower(u->>'email'); end if;
      dev := true;
      -- 用户要求统一用 11445 原来的密码：只搬密码散列，明文不出现在任何地方
      if coalesce(u->>'encrypted_password', '') <> '' then
        update auth.users set encrypted_password = u->>'encrypted_password', updated_at = now() where id = nid;
      end if;
      how := '并入开发者账号（GitHub 登录，或 11445 + 原来的加分助手密码）';
    else
    select id into nid from auth.users where id = ouid;
    if nid is not null then
      if (select lower(coalesce(email, '')) from auth.users where id = ouid) <> lower(coalesce(u->>'email', '')) then
        raise exception '新项目里已有 id 相同但邮箱不同的账号 %，请停下来核对', ouid;
      end if;
      how := '已迁过';
    else
      if not anon then select id into nid from auth.users where lower(email) = lower(u->>'email'); end if;
      if nid is not null then
        how := '同邮箱已在新项目注册，并入该账号（用新项目的密码或 GitHub 登录）';
      else
        execute format('insert into auth.users (%s) select %s from jsonb_populate_record(null::auth.users, $1)', ucols, ucols) using u;
        select coalesce(jsonb_agg(x), '[]'::jsonb) into ids from jsonb_array_elements(b->'identities') x where x->>'user_id' = ouid::text;
        if icols is not null and jsonb_array_length(ids) > 0 then
          execute format('insert into auth.identities (%s) select %s from jsonb_populate_recordset(null::auth.identities, $1) on conflict do nothing', icols, icols) using ids;
        end if;
        nid := ouid;
        how := case when anon then '访客账号（只保留成绩，不能登录）' else '新建（原 id、原密码）' end;
      end if;
    end if;
    end if;
    if dev then
      insert into public.hx_profiles (user_id, role, is_admin, is_dev) values (nid, 'teacher', true, true)
      on conflict (user_id) do update set role = 'teacher', is_admin = true, is_dev = true;
    elsif not anon then
      insert into public.hx_profiles (user_id, role) values (nid, 'teacher') on conflict (user_id) do nothing;
      if exists (select 1 from public.hx_profiles where user_id = nid and role <> 'teacher') then
        how := how || '；注意：这个账号在华夏工具里是学生，没有改成教师，暂时打不开加分助手';
      end if;
    end if;
    insert into public.jf_migration_log (old_id, new_id, email, how) values (ouid, nid, u->>'email', how)
    on conflict (old_id) do update set new_id = excluded.new_id, email = excluded.email, at = now(),
      how = case when excluded.how like '已迁过%' then public.jf_migration_log.how else excluded.how end;
  end loop;

  insert into public.jf_profiles (id, username, display_name, real_name, role, created_at, last_seen_at)
  select m.new_id, p.username, coalesce(p.display_name, ''), coalesce(p.real_name, ''), coalesce(p.role, 'teacher'), coalesce(p.created_at, now()), p.last_seen_at
  from jsonb_populate_recordset(null::public.jf_profiles, b->'profiles') p join public.jf_migration_log m on m.old_id = p.id
  on conflict do nothing;

  insert into public.jf_score_states (owner_id, data, revision, updated_at)
  select m.new_id, s.data, s.revision, s.updated_at
  from jsonb_populate_recordset(null::public.jf_score_states, b->'score_states') s join public.jf_migration_log m on m.old_id = s.owner_id
  on conflict (owner_id) do update set data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at
  where public.jf_score_states.revision < excluded.revision;

  insert into public.jf_invites (code_hash, code, role, note, created_by, created_at, used_by, used_at, disabled)
  select v.code_hash, v.code, v.role, v.note, mc.new_id, v.created_at, mu.new_id, v.used_at, v.disabled
  from jsonb_populate_recordset(null::public.jf_invites, b->'invites') v
  join public.jf_migration_log mc on mc.old_id = v.created_by
  left join public.jf_migration_log mu on mu.old_id = v.used_by
  on conflict do nothing;

  -- 核对：每份成绩要么和旧项目逐字一致（md5 相同），要么新项目里已经是更新的版本
  select count(*) into bad
  from jsonb_populate_recordset(null::public.jf_score_states, b->'score_states') o
  join public.jf_migration_log m on m.old_id = o.owner_id
  left join public.jf_score_states s on s.owner_id = m.new_id
  where s.owner_id is null or s.revision < o.revision
     or (s.revision = o.revision and md5(coalesce(s.data::text, '')) <> b->'checks'->'state_md5'->>(o.owner_id::text));
  if bad > 0 then raise exception '有 % 份成绩没有完整导入，已全部撤销，什么都没改', bad; end if;
  raise notice '完成：跳过没记过课的访客 % 个', n_skip;
end
${MIG};

-- 结果：每个迁入账号一行（看 how 列；“同邮箱…并入”的老师要用新项目原来的登录方式）
select m.email, m.how, p.display_name, p.role,
       jsonb_array_length(coalesce(s.data->'classes', '[]')) as classes,
       jsonb_array_length(coalesce(s.data->'lessons', '[]')) as lessons,
       s.revision, s.updated_at
from public.jf_migration_log m
left join public.jf_profiles p on p.id = m.new_id
left join public.jf_score_states s on s.owner_id = m.new_id
order by m.email;
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) { console.error('用法：node tools/hx-migrate/build-import.mjs <旧项目备份.csv|json>'); process.exit(1); }
  const bundle = parseBundle(fs.readFileSync(input, 'utf8'));
  const out = path.join(path.dirname(input), path.basename(input, path.extname(input)) + '-导入新项目.sql');
  fs.writeFileSync(out, importSql(bundle), 'utf8');
  const lessonsOf = (id) => { const s = bundle.score_states.find((x) => x.owner_id === id); return s && s.data ? (s.data.lessons || []).length : 0; };
  console.log('导出时间', bundle.exported_at);
  console.log('账号', bundle.users.length, '资料', bundle.profiles.length, '成绩', bundle.score_states.length, '邀请码', bundle.invites.length);
  for (const u of bundle.users) {
    const p = bundle.profiles.find((x) => x.id === u.id) || {};
    console.log(' -', u.email || '(访客)', p.display_name || '', p.role || '', '课次', lessonsOf(u.id));
  }
  console.log('已生成', out, Math.round(fs.statSync(out).size / 1024) + ' KB');
}
