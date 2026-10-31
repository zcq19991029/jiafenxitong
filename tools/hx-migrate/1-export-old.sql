-- 第 1 步：在【旧项目 hrzeciygelfwdmhftvew】的 SQL Editor 里运行（只读，不改任何数据）。
-- 结果只有一行一列 bundle：账号（含密码散列）、资料、成绩、邀请码的完整备份。
-- 用结果区右上角的 Export → Download CSV 下载，放到本机 迁移记录/ 目录（该目录不进 Git）。
-- 里面有密码散列和学生成绩，不要发给别人、不要传到网上。
select jsonb_build_object(
  'project', 'hrzeciygelfwdmhftvew',
  'exported_at', now(),
  'users',        (select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at), '[]'::jsonb) from auth.users u),
  'identities',   (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb) from auth.identities i),
  'profiles',     (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb) from public.profiles p),
  'score_states', (select coalesce(jsonb_agg(to_jsonb(s) order by s.owner_id), '[]'::jsonb) from public.score_states s),
  'invites',      (select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at), '[]'::jsonb) from public.invites v),
  -- 导入时用来核对：每份成绩的 md5，和各表行数
  'checks', jsonb_build_object(
    'users', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'score_states', (select count(*) from public.score_states),
    'invites', (select count(*) from public.invites),
    'state_md5', (select coalesce(jsonb_object_agg(owner_id, md5(coalesce(data::text, ''))), '{}'::jsonb) from public.score_states))
) as bundle;
