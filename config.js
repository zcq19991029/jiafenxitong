/* GitHub Pages 只托管前端文件；登录与成绩实时保存到 Supabase。 */
window.JFDT_CONFIG = {
  apiBase: '',
  supabaseUrl: 'https://hrzeciygelfwdmhftvew.supabase.co',
  // publishable key 只用于浏览器端匿名/登录请求，不具备绕过 RLS 的权限。
  supabasePublishableKey: 'sb_publishable_WJ9xyIAPK1aCKShr-lm7sg_R0EwWRYm',

  /* 账号可以是邮箱，也可以是纯数字/短账号：没有 @ 的会自动补成「账号@jfdt.app」。
     这个域名只是 Supabase Auth 的登录身份，不会真的发信，所以必须关掉 Confirm email。 */
  accountDomain: 'jfdt.app',

  /* 邀请制：注册时必须填对这个口令。留空字符串 = 开放注册。
     注意这是前端校验，能挡住随手注册，挡不住有心人（源码公开可读）。 */
  registerCode: 'JFDT-2026'
};

