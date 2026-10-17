/**
 * 用 CDP 截真实视口的图。
 *
 * 为什么不用 --screenshot + --window-size：
 * Windows 上 Chrome 的窗口有最小宽度（约 497px），传 --window-size=390 拿不到 390 的布局视口，
 * 截出来的图会"看起来被裁掉"，其实是假的。这里用 Emulation.setDeviceMetricsOverride
 * 强制指定视口，才是真实的手机宽度。
 *
 * 用法：
 *   node tools/shots.mjs                    # 默认先出到 _shots/（临时目录，gitignore 掉了）
 *   node tools/shots.mjs --dir=效果预览      # 直接刷成正式的效果预览图
 *   node tools/shots.mjs --only=电脑端        # 只重出名字以「电脑端」开头的那几张
 *   node tools/shots.mjs --viewport         # 只截首屏，不按内容拉长（看顶栏/控件细节用）
 *
 * 每张图都会顺手量一遍横向溢出，溢出了会点名是哪几个元素，别只看图。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8765';
const PAGE = process.env.SHOT_PAGE || '/_shot_cloud.html';
const ROOT = path.resolve(import.meta.dirname, '..');
let OUT = process.env.SHOT_OUT || path.join(ROOT, '_shots');

/* 【宽, 高, 是否整页】—— 整页就按内容高度截，不然只截首屏 */
const PLAN = [
  // ---------- 电脑端 ----------
  { name: '电脑端·上课记分', q: 'gate=admin&c=c1&v=score&lay=card', w: 1440, h: 1500, full: true },
  { name: '电脑端·上课记分(表格式)', q: 'gate=admin&c=c1&v=score&lay=table', w: 1440, h: 1500, full: true },
  { name: '电脑端·排行总览', q: 'gate=admin&c=c1&v=rank', w: 1440, h: 1600, full: true },
  { name: '电脑端·待分配名单', q: 'gate=admin&c=c2&v=pool', w: 1440, h: 1150, full: true },
  { name: '电脑端·数据与备份', q: 'gate=admin&c=c1&v=data', w: 1440, h: 1600, full: true },
  { name: '电脑端·管理页', q: 'gate=admin&c=c1&v=admin', w: 1440, h: 1250, full: true },
  { name: '电脑端·个人信息', q: 'gate=admin&c=c1&me=1', w: 1000, h: 800 },
  { name: '电脑端·弹窗-新开一课', q: 'gate=admin&c=c1&dlg=lesson', w: 1000, h: 800 },
  { name: '电脑端·弹窗-老师与数据', q: 'gate=admin&c=c1&v=admin&dlg=teacher', w: 1100, h: 820 },
  { name: '电脑端·弹窗-添加学生', q: 'gate=admin&c=c2&v=pool&dlg=student', w: 1000, h: 760 },
  { name: '电脑端·弹窗-个人信息', q: 'gate=admin&c=c1&dlg=me', w: 1000, h: 700 },
  { name: '电脑端·保存成功动效', q: 'gate=admin&c=c2&v=pool&toast=1', w: 1200, h: 780 },
  // ---------- 线上（登录 / 邀请码）----------
  { name: '线上·登录页', q: 'gate=login', w: 1000, h: 700 },
  { name: '线上·邀请码页', q: 'gate=invite', w: 1000, h: 740 },
  // ---------- 手机端 ----------
  { name: '手机端·上课记分(卡片式)', q: 'gate=admin&c=c1&v=score&lay=card', w: 390, h: 1000, full: true },
  { name: '手机端·上课记分(表格式)', q: 'gate=admin&c=c1&v=score&lay=table', w: 390, h: 1000, full: true },
  { name: '手机端·排行总览', q: 'gate=admin&c=c1&v=rank', w: 390, h: 1000, full: true },
  { name: '手机端·待分配名单', q: 'gate=admin&c=c2&v=pool', w: 390, h: 1000, full: true },
  { name: '手机端·管理页', q: 'gate=admin&c=c1&v=admin', w: 390, h: 1000, full: true },
  { name: '手机端·登录页', q: 'gate=login', w: 390, h: 800 },
  { name: '手机端·弹窗-添加学生', q: 'gate=admin&c=c2&v=pool&dlg=student', w: 390, h: 800 },
  { name: '手机端·弹窗-老师与数据', q: 'gate=admin&c=c1&v=admin&dlg=teacher', w: 390, h: 800 },
  { name: '手机端·保存成功动效', q: 'gate=admin&c=c2&v=pool&toast=1', w: 390, h: 800 },
];

const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
/* --viewport：只截首屏（便于放大看顶栏 / 控件的细节） */
const viewportOnly = process.argv.includes('--viewport');
/* --dir=xxx：换个输出目录，免得把效果预览里的正式图覆盖掉 */
const dirArg = (process.argv.find(a => a.startsWith('--dir=')) || '').split('=')[1];

/* ---------- CDP 小客户端 ---------- */
function cdp(ws) {
  let id = 0;
  const waiters = new Map();
  const listeners = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) {
      const { resolve, reject } = waiters.get(m.id);
      waiters.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) {
      listeners.forEach(fn => fn(m));
    }
  });
  return {
    send(method, params, sessionId) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        waiters.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
      });
    },
    on(fn) { listeners.push(fn); }
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('连不上 Chrome 的调试端口 ' + PORT);
}

async function main() {
  if (dirArg) OUT = path.resolve(ROOT, dirArg);
  fs.mkdirSync(OUT, { recursive: true });

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'jfdt-shot-profile')}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await connect();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const C = cdp(ws);

    const { targetId } = await C.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await C.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => C.send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');

    let done = 0, fail = 0;
    for (const item of PLAN) {
      if (only && !item.name.startsWith(only) && !item.name.slice(0, 2).includes(only)) continue;

      await S('Emulation.setDeviceMetricsOverride', {
        width: item.w, height: item.h, deviceScaleFactor: 1, mobile: item.w < 700,
      });

      const url = `${BASE}${PAGE}?${item.q}`;
      await S('Page.navigate', { url });
      // 等页面自己 boot 完（?c= / ?v= 的点击在 1.2s / 1.9s 之后）
      await sleep(3200);

      const shot = await S("Page.captureScreenshot", (item.full && !viewportOnly)
        ? { format: 'png', captureBeyondViewport: true, optimizeForSpeed: false }
        : { format: 'png' });

      const file = path.join(OUT, `${item.name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      // 顺手量一下有没有横向溢出，别只看图；溢出了就点名是谁
      const { result } = await S('Runtime.evaluate', {
        expression: `(function(){
          var vw = document.documentElement.clientWidth;
          var out = {
            vw: vw,
            sw: document.documentElement.scrollWidth,
            who: []
          };
          if (out.sw <= vw + 1) return JSON.stringify(out);
          var all = document.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            var e = all[i];
            var r = e.getBoundingClientRect();
            if (r.width === 0) continue;
            var cs = getComputedStyle(e);
            if (/auto|scroll/.test(cs.overflowX)) continue;   // 自己滚的不算
            if (r.right > vw + 1) {
              out.who.push(e.tagName.toLowerCase() +
                (e.id ? '#' + e.id : '') +
                (typeof e.className === 'string' && e.className.trim()
                  ? '.' + e.className.trim().split(/\\s+/).join('.') : '') +
                '  right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
            }
          }
          out.who = out.who.slice(0, 6);
          return JSON.stringify(out);
        })()`,
        returnByValue: true,
      });
      const m = JSON.parse(result.value);
      const bad = m.sw > m.vw + 1;
      if (bad) fail++; else done++;
      console.log(`${bad ? '溢出!' : '  ok '} ${String(item.w).padStart(4)}px  ${item.name}` +
                  (bad ? `   scrollWidth=${m.sw} > ${m.vw}` : ''));
      m.who.forEach(s => console.log('        ↳ ' + s));
    }
    console.log(`\n共 ${done + fail} 张：正常 ${done}，横向溢出 ${fail}`);
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(e => { console.error('出图失败：', e.message); process.exit(1); });
