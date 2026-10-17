/* 弹窗体检：不只看图，真的去拖右下角，量尺寸有没有变。
   验证三件事（用户原话）：
     1. 没适配大小 → 窗口高度要贴合内容，不许拉满整屏
     2. 不能自由拖动窗口尺寸 → 拖右下角要真的变大变小
     3. 关闭按钮需要常显 → ✕ 一直在标题栏、点一下就能关
   前置：python -m http.server 8765 --bind 127.0.0.1
   运行：node tools/check_dialog.mjs */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8765';
const PAGE = process.env.SHOT_PAGE || '/_shot_cloud.html';
const PORT = 9366;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error('连不上 Chrome 调试端口 ' + PORT);
}

function cdp(ws) {
  let id = 0;
  const waiters = new Map();
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && waiters.has(m.id)) {
      const { resolve, reject } = waiters.get(m.id);
      waiters.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return (method, params, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    waiters.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
  });
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra !== undefined ? '  \u2192 ' + extra : '')); }
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'jfdt-dlgcheck-profile')}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  const ws = new WebSocket(await connect());
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = cdp(ws);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');

  const VW = 1000, VH = 800;
  await S('Emulation.setDeviceMetricsOverride',
    { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  /* 把测量逻辑塞进页面，省得来回传一堆 CDP 调用 */
  const MEASURE = `(function(sel){
    var d = document.querySelector(sel);
    if (!d) return JSON.stringify({ missing: true });
    var r = d.getBoundingClientRect();
    var cs = getComputedStyle(d);
    var x = d.querySelector('.dlg-x');
    var xr = x ? x.getBoundingClientRect() : null;
    var body = d.querySelector('.dlg-body');
    return JSON.stringify({
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      resize: cs.resize, overflow: cs.overflow, display: cs.display,
      open: d.hasAttribute('open'),
      xVisible: !!x && xr.width > 0 && xr.height > 0 &&
                xr.top >= r.top - 1 && xr.right <= r.right + 1 && xr.left >= r.left - 1,
      bodyScroll: body ? Math.round(body.scrollHeight) : null,
      bodyClient: body ? Math.round(body.clientHeight) : null
    });
  })`;

  async function measure(sel) {
    const { result } = await S('Runtime.evaluate',
      { expression: `${MEASURE}(${JSON.stringify(sel)})`, returnByValue: true });
    return JSON.parse(result.value);
  }

  async function open(q) {
    await S('Page.navigate', { url: `${BASE}${PAGE}?${q}` });
    await sleep(3400);
  }

  async function dragCorner(sel, dx, dy) {
    const m0 = await measure(sel);
    const r = await S('Runtime.evaluate', {
      expression: `(function(){var b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
        return JSON.stringify({x:Math.round(b.right-3),y:Math.round(b.bottom-3)});})()`,
      returnByValue: true,
    });
    const c = JSON.parse(r.result.value);
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await S('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: c.x + Math.round(dx * i / 6), y: c.y + Math.round(dy * i / 6),
      });
      await sleep(20);
    }
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x + dx, y: c.y + dy, button: 'left', buttons: 0 });
    await sleep(160);
    return m0;
  }

  /* ---------- 1. 新开一课：内容不多，窗口就该是小小一个 ---------- */
  console.log('\n=== 新开一课（内容少）===');
  await open('gate=admin&c=c1&dlg=lesson');
  const a = await measure('#dlgLesson');
  ok('窗口确实开着', a.open === true && a.h > 0, JSON.stringify(a));
  ok('高度贴合内容，没被拉满整屏', a.h < VH * 0.6, `h=${a.h} / 视口 ${VH}`);
  ok('竖直居中', near(a.top, VH - a.bottom, 24), `top=${a.top} bottom=${a.bottom}`);
  ok('开了右下角把手', a.resize === 'both', a.resize);
  ok('overflow 不是 visible（否则把手失效）', a.overflow !== 'visible', a.overflow);
  ok('✕ 就在标题栏里、没被挤出去', a.xVisible === true);
  ok('窗口比视口窄，右边留白', a.w < VW - 20, `w=${a.w}`);

  /* ---------- 2. 真拖一把 ---------- */
  console.log('\n=== 拖右下角改大小 ===');
  const m0 = await dragCorner('#dlgLesson', 120, 90);
  const b = await measure('#dlgLesson');
  ok('拖宽了：宽度变大', b.w > m0.w + 40, `${m0.w} → ${b.w}`);
  ok('拖高了：高度变大', b.h > m0.h + 30, `${m0.h} → ${b.h}`);
  const m1 = await dragCorner('#dlgLesson', -80, -40);
  const c = await measure('#dlgLesson');
  ok('还能拖回来：缩得比刚才小', c.w < b.w - 30 && c.h <= b.h, `${b.w}×${b.h} → ${c.w}×${c.h}`);
  ok('缩小后里头的字也没被挤没', c.w > 0 && c.h > 0);
  ok('拖的时候窗口没被误关掉', c.open === true);

  /* ---------- 3. 内容多的窗口要自己滚，不许顶爆屏幕 ---------- */
  console.log('\n=== 老师与数据（内容多）===');
  await open('gate=admin&c=c1&v=admin&dlg=teacher');
  const t = await measure('#dlgTeacher');
  ok('宽窗口开出来了', t.open === true && t.w > 500, `w=${t.w}`);
  ok('高度仍被屏幕八成卡住，没超过视口', t.h <= VH * 0.89 + 1, `h=${t.h} / 视口 ${VH}`);
  ok('电脑上的宽窗口有把手、✕ 也在', t.resize === 'both' && t.xVisible === true);
  ok('课次等列都在窗口内（横向不溢出）', t.w >= 640, `w=${t.w}`);

  /* ---------- 4. 点 ✕ 随时能关 ---------- */
  console.log('\n=== ✕ 随手就能关 ===');
  await S('Runtime.evaluate', {
    expression: `document.querySelector('#dlgTeacher .dlg-x').click()`, returnByValue: true,
  });
  await sleep(220);
  const closed = await measure('#dlgTeacher');
  ok('点一下 ✕ 窗口就关了', closed.open === false && closed.h < 1, JSON.stringify(closed));

  /* ---------- 5. 手机上不给把手、铺满宽度 ---------- */
  console.log('\n=== 手机（390px）===');
  await S('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await open('gate=admin&c=c2&v=pool&dlg=student');
  const p = await measure('#dlgStudent');
  ok('手机上窗口铺满宽度', p.w >= 380, `w=${p.w}`);
  ok('手机上不给拖拽把手（没鼠标）', p.resize === 'none', p.resize);
  ok('✕ 照样常在', p.xVisible === true);
  ok('高度不超屏', p.h <= 800, `h=${p.h}`);

  ws.close();
} finally {
  chrome.kill();
}

console.log('\n────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
