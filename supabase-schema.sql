-- 夜夜小组制加分助手：Supabase 初始结构
-- 仅保存账号资料、邀请码和每个教师自己的成绩状态；登录密码由 Supabase Auth 管理。

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default '',
  real_name text not null default '',
  role text not null default 'teacher' check (role in ('admin','teacher')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.score_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb,
  revision bigint not null default 0,
  updated_at timestamptz
);

create table if not exists public.invites (
  code_hash text primary key,
  code text not null,
  role text not null default 'teacher' check (role in ('admin','teacher')),
  note text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  disabled boolean not null default false
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.score_states enable row level security;
alter table public.invites enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists score_states_self_read on public.score_states;
create policy score_states_self_read on public.score_states for select using (owner_id = auth.uid() or public.is_admin());
drop policy if exists score_states_self_insert on public.score_states;
create policy score_states_self_insert on public.score_states for insert with check (owner_id = auth.uid());
drop policy if exists score_states_self_update on public.score_states;
create policy score_states_self_update on public.score_states for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists invites_admin_all on public.invites;
create policy invites_admin_all on public.invites for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, real_name)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    coalesce(new.raw_user_meta_data->>'real_name', '')
  ) on conflict (id) do nothing;
  insert into public.score_states (owner_id, data, revision)
  values (new.id, jsonb_build_object('classes', jsonb_build_array(), 'lessons', jsonb_build_array(), 'operationLog', jsonb_build_array(), 'undo', jsonb_build_array(), 'redo', jsonb_build_array()), 0)
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 验证结构：应返回 profiles、score_states、invites 三行。
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('profiles','score_states','invites')
order by table_name;
