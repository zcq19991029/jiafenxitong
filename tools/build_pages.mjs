/* 生成 GitHub Pages 用的静态站点到 pages-dist/。
 *
 * 和 Worker 版 build_site.mjs 的区别：这里没有后端，登录与数据全部走 Supabase，
 * 所以只做三件事：
 *   1. 复制前端文件并给脚本加 ?v=<commit> 指纹（Pages 的 CDN 缓存很难穿）
 *   2. 生成中性 data.js（空班级 + 13 个空组），真实名单只存在老师自己的账号里
 *   3. 生成 version.json，让顶栏的「版本发布于 …」和自动更新检测有东西可读
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'pages-dist');

const FILES = [
  'index.html', 'styles.css', 'app.js', 'assessment.js', 'cloud.js', 'supabase-cloud.js',
  'config.js', 'password-ui.js', 'roster-import.js', 'leader-scoring.js', 'ui-feedback.js',
  'print-excel.js', 'assets/school-logo.png', 'assets/school-logo-mark.png',
  'vendor/jspdf.umd.min.js', 'vendor/xlsx.full.min.js'
];

/* 新账号的中性初始状态：一个空班级，13 个空组，没有任何学生 */
export const BLANK_SEED = {
  source: '新账号空白模板；教师自行导入班级与名单，保存在个人账号的 Supabase 记录中。',
  classes: [{
    id: 'my-class', name: '我的班级', teacher: '', roster: [],
    groups: Array.from({ length: 13 }, (_, i) => ({ no: i + 1, members: [] }))
  }]
};

let commit = 'local-check';
try {
  const bundledGit = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe');
  const git = process.env.GIT_EXE || (fs.existsSync(bundledGit) ? bundledGit : 'git');
  commit = execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (execFileSync(git, ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) commit += '-dirty';
} catch { /* 本地预览用 local-check 即可 */ }

const builtAt = new Date().toISOString();
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const versioned = ['styles.css', 'data.js', 'config.js', 'cloud.js', 'supabase-cloud.js', 'roster-import.js',
  'leader-scoring.js', 'assessment.js', 'ui-feedback.js', 'print-excel.js', 'app.js', 'password-ui.js',
  'vendor/jspdf.umd.min.js', 'vendor/xlsx.full.min.js'];

for (const name of FILES) {
  const dest = path.join(out, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let bytes = fs.readFileSync(path.join(root, name));
  if (name === 'index.html') {
    let html = bytes.toString('utf8');
    for (const asset of versioned) {
      html = html.split('"' + asset + '"').join('"' + asset + '?v=' + commit + '"');
    }
    html = html.replace('</head>',
      '<meta name="build-commit" content="' + commit + '">\n' +
      '<meta name="build-published-at" content="' + builtAt + '">\n</head>');
    bytes = Buffer.from(html);
  }
  fs.writeFileSync(dest, bytes);
}

fs.writeFileSync(path.join(out, 'data.js'), 'window.SEED_DATA = ' + JSON.stringify(BLANK_SEED) + ';\n');
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ commit, mode: 'pages-supabase', builtAt }, null, 2));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

/* 兜底：Pages 没有服务端路由，深链接一律回到首页 */
fs.writeFileSync(path.join(out, '404.html'),
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta http-equiv="refresh" content="0;url=/jiafenxitong/"><title>正在返回首页</title></head>' +
  '<body><p>页面不存在，正在返回 <a href="/jiafenxitong/">加分助手首页</a>。</p></body></html>');

console.log('Built GitHub Pages site:', commit, '→', path.relative(root, out));
