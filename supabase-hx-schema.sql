-- 夜夜加分助手并入「华夏工具」Supabase 项目（eiqgyrjrwdaunhxjmdyr）后的表结构
-- 前提：这个项目已经运行过华夏工具的 rank-schema.sql（有 hx_profiles、hx_is_teacher()、hx_is_admin()）。
-- 在新项目 SQL Editor 里运行；重复运行不会出错，也不会动已有数据。
-- 和旧项目（supabase-schema.sql）的区别：
--   1. 表名加 jf_ 前缀，避免和排课、接线仿真的表重名；
--   2. 只有华夏工具教师（hx_is_teacher()）能读写，学生账号读不到、写不进；
--   3. 不装 auth.users 上的注册触发器（会给排课、接线仿真的新用户也建加分资料）。资料行和成绩行由网页在第一次登录时补建；
--   4. 老师只能改自己的显示名、真实姓名、最近登录时间，改不了 role（旧结构允许自己把 role 改成 admin）。

create table if not exists public.jf_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  real_name text not null default '',
  role text not null default 'teacher' check (role in ('admin','teacher')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.jf_score_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb,
  revision bigint not null default 0,
  updated_at timestamptz
);

-- 旧项目的邀请码表，网页已不再使用（新老师改用华夏工具的教师邀请码），只为完整保留旧数据
create table if not exists public.jf_invites (
  code_hash text primary key,
  code text not null,
  role text not null default 'teacher' check (role in ('admin','teacher')),
  note text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  disabled boolean not null default false
);

-- 迁移记录：旧账号 id → 新账号 id（同邮箱已在新项目注册过的会映射到已有账号）。只有后台能看
create table if not exists public.jf_migration_log (
  old_id uuid primary key,
  new_id uuid not null,
  email text,
  how text not null,
  at timestamptz not null default now()
);

-- 加分助手管理员：华夏工具管理员/开发者，或旧项目里 role='admin' 的老师（仍须是教师）
create or replace function public.jf_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.hx_is_teacher() and (public.hx_is_admin()
    or exists (select 1 from public.jf_profiles where id = auth.uid() and role = 'admin'));
$$;
revoke all on function public.jf_is_admin() from public, anon, authenticated;
grant execute on function public.jf_is_admin() to authenticated;

alter table public.jf_profiles enable row level security;
alter table public.jf_score_states enable row level security;
alter table public.jf_invites enable row level security;
alter table public.jf_migration_log enable row level security;

drop policy if exists jf_profiles_read on public.jf_profiles;
drop policy if exists jf_profiles_insert on public.jf_profiles;
drop policy if exists jf_profiles_update on public.jf_profiles;
create policy jf_profiles_read on public.jf_profiles for select to authenticated
  using ((id = (select auth.uid()) and public.hx_is_teacher()) or public.jf_is_admin());
create policy jf_profiles_insert on public.jf_profiles for insert to authenticated
  with check (id = (select auth.uid()) and role = 'teacher' and public.hx_is_teacher());
create policy jf_profiles_update on public.jf_profiles for update to authenticated
  using (id = (select auth.uid()) and public.hx_is_teacher()) with check (id = (select auth.uid()) and public.hx_is_teacher());

drop policy if exists jf_states_read on public.jf_score_states;
drop policy if exists jf_states_insert on public.jf_score_states;
drop policy if exists jf_states_update on public.jf_score_states;
create policy jf_states_read on public.jf_score_states for select to authenticated
  using ((owner_id = (select auth.uid()) and public.hx_is_teacher()) or public.jf_is_admin());
create policy jf_states_insert on public.jf_score_states for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.hx_is_teacher());
create policy jf_states_update on public.jf_score_states for update to authenticated
  using (owner_id = (select auth.uid()) and public.hx_is_teacher()) with check (owner_id = (select auth.uid()) and public.hx_is_teacher());

drop policy if exists jf_invites_admin on public.jf_invites;
create policy jf_invites_admin on public.jf_invites for all to authenticated
  using (public.jf_is_admin()) with check (public.jf_is_admin());

revoke all on public.jf_profiles, public.jf_score_states, public.jf_invites, public.jf_migration_log from anon, authenticated;
grant select on public.jf_profiles to authenticated;
grant insert (id, username, display_name, real_name, last_seen_at) on public.jf_profiles to authenticated;
grant update (display_name, real_name, last_seen_at) on public.jf_profiles to authenticated;
grant select, insert, update on public.jf_score_states to authenticated;
grant select, insert, update, delete on public.jf_invites to authenticated;

-- 验证：应返回 jf_invites、jf_migration_log、jf_profiles、jf_score_states 四行
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'jf\_%'
order by table_name;
