/* GitHub Pages 只托管前端文件；登录与成绩实时保存到 Supabase。
   2026-10-30 起并入「华夏工具」项目（和排课、接线仿真共用账号），旧项目 hrzeciygelfwdmhftvew 停用。 */
window.JFDT_CONFIG = {
  apiBase: '',
  supabaseUrl: 'https://eiqgyrjrwdaunhxjmdyr.supabase.co',
  // publishable key 只用于浏览器端匿名/登录请求，不具备绕过 RLS 的权限。
  supabasePublishableKey: 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd',

  /* 华夏工具共用项目：加分助手的表名带 jf_ 前缀；只有华夏工具教师能登录（学生账号会被拒）。 */
  tablePrefix: 'jf_',
  hxTeacherGate: true,

  /* 账号可以是邮箱，也可以是纯数字/短账号：没有 @ 的会自动补成「账号@jfdt.app」。
     这个域名只是 Supabase Auth 的登录身份，不会真的发信，所以必须关掉 Confirm email。 */
  accountDomain: 'jfdt.app',

  /* 旧的前端口令已停用：hxTeacherGate 打开时，注册必须填管理员发的华夏工具教师邀请码（数据库核对，一码一用）。 */
  registerCode: ''
};

