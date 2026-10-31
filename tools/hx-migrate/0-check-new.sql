-- 第 0 步：在【新项目 eiqgyrjrwdaunhxjmdyr】的 SQL Editor 里运行（只读）。
-- 看三件事：华夏工具的身份函数在不在、jf_ 表建了没有、auth.users 上有哪些触发器（导入账号时会触发它们）。
select 'hx_is_teacher 函数' as item, (to_regprocedure('public.hx_is_teacher(uuid)') is not null)::text as value
union all select 'jf_score_states 表', (to_regclass('public.jf_score_states') is not null)::text
union all select '新项目现有账号数', (select count(*)::text from auth.users)
union all select '已登记教师数', (select count(*)::text from public.hx_profiles where role = 'teacher')
union all select 'auth.users 触发器：' || t.tgname, p.proname
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
