/* One Worker serves the app, API and D1 binding. No Pages or secondary frontend. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
fs.mkdirSync(path.join(out, '.openai', 'drizzle', 'meta'), { recursive: true });
let commit = 'local-check', dirty = true;
const bundledGit = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe');
const git = process.env.GIT_EXE || (fs.existsSync(bundledGit) ? bundledGit : 'git');
try {
  commit = execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  dirty = !!execFileSync(git, ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
} catch { /* Local preview still works; publication checks require a clean real commit. */ }
const version = commit + (dirty ? '-dirty' : '');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const assets = {};
for (const name of ['index.html', 'styles.css', 'app.js', 'cloud.js', 'config.js', 'roster-import.js', 'password-ui.js',
  'assets/school-logo.png', 'assets/school-logo-mark.png']) {
  let bytes = fs.readFileSync(path.join(root, name));
  if (name === 'index.html') {
    let html = bytes.toString('utf8');
    for (const asset of ['styles.css', 'data.js', 'config.js', 'roster-import.js', 'cloud.js', 'app.js', 'password-ui.js']) {
      html = html.replace('"' + asset + '"', '"' + asset + '?v=' + version + '"');
    }
    html = html.replace('</head>', '<meta name="build-commit" content="' + version + '">\n</head>');
    bytes = Buffer.from(html);
  }
  assets['/' + name] = { type: types[path.extname(name)], data: bytes.toString('base64') };
}
const blank = {
  source: '新账号空白模板；教师自行导入班级与名单，保存在个人账号的 D1 记录中。',
  classes: [{ id: 'my-class', name: '我的班级', teacher: '', roster: [],
    groups: Array.from({ length: 13 }, (_, i) => ({ no: i + 1, members: [] })) }]
};
assets['/data.js'] = { type: types['.js'], data: Buffer.from('window.SEED_DATA = ' + JSON.stringify(blank) + ';\n').toString('base64') };
assets['/version.json'] = { type: types['.json'], data: Buffer.from(JSON.stringify({ commit, dirty, mode: 'worker-d1' })).toString('base64') };
let source = fs.readFileSync(path.join(root, 'backend/worker.mjs'), 'utf8');
if (!source.includes('export default {')) throw new Error('Worker export not found');
source = source.replace('export default {', 'const __SITE_API__ = {');
source += '\nconst __SITE_ASSETS__ = ' + JSON.stringify(assets) + ';\n';
source += `
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return __SITE_API__.fetch(request, env, ctx);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const asset = __SITE_ASSETS__[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!asset) return new Response('页面不存在', { status: 404 });
    const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      'Content-Type': asset.type,
      'Cache-Control': ${JSON.stringify(dirty)} ? 'no-store' : (url.searchParams.get('v') === ${JSON.stringify(version)} ? 'public, max-age=31536000, immutable' : 'no-cache'),
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    } });
  }
};
`;
fs.writeFileSync(path.join(out, 'server/index.js'), source);
fs.copyFileSync(path.join(root, '.openai/hosting.json'), path.join(out, '.openai/hosting.json'));
const migrations = fs.readdirSync(path.join(root, 'backend/migrations')).filter(name => name.endsWith('.sql')).sort();
for (const name of migrations) {
  const schema = fs.readFileSync(path.join(root, 'backend/migrations', name), 'utf8');
  fs.writeFileSync(path.join(out, '.openai/drizzle', name), schema.replace(/;\n(?=\S)/g, ';\n--> statement-breakpoint\n'));
}
fs.writeFileSync(path.join(out, '.openai/drizzle/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [
  ...migrations.map((name, idx) => ({idx, version:'6', when:1792195200000 + idx * 1000, tag:name.replace(/\.sql$/, ''), breakpoints:true}))
] }, null, 2));
console.log('Built one Worker + D1 application:', version);
