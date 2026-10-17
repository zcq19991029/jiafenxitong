/* Public regression tests: synthetic data only; never call the real cloud. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('./test-runtime/', import.meta.url));
const { JSDOM } = require('jsdom');
const seed = JSON.parse(fs.readFileSync('data.example.js', 'utf8').split('window.SEED_DATA =')[1].trim().replace(/;$/, ''));
const clone = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setTimeout(r, 25));
let passed = 0;
function check(name, value) { assert.ok(value, name); passed++; console.log('PASS', name); }

function client(options = {}) {
  const calls = { writes: [], oauth: [] };
  const sdk = {
    auth: {
      getSession: async () => ({ data: { user: { id: options.userId || 'test-teacher' } } }),
      signInWithOAuth: async p => { calls.oauth.push(p); return { error: new Error('navigation stopped in test') }; },
      signOut: async () => ({ data: null })
    },
    database: { rpc: async (name, params) => {
      if (name === 'my_profile') return { data: { display_name: '示例教师' } };
      if (name === 'my_state') return { data: options.record || null };
      if (name === 'save_my_state') {
        calls.writes.push(clone(params.p_data));
        if (options.write) return options.write(params);
        return { data: { ok: true } };
      }
      return { data: null };
    } }
  };
  return { sdk, calls };
}

async function cloudOnly(fake) {
  const dom = new JSDOM('', { url: 'https://example.github.io/ye-ye-score-helper/', runScripts: 'outside-only' });
  dom.window.WorkBuddyCloud = { createWorkBuddyCloud: () => fake.sdk };
  dom.window.eval(fs.readFileSync('cloud.js', 'utf8'));
  const api = dom.window.JFDT_CLOUD;
  await new Promise((resolve, reject) => api.boot({ onReady: resolve, onNeedLogin: reject, onOffline: reject }));
  return { dom, api };
}

{
  let release;
  const fake = client({ write: () => fake.calls.writes.length === 1
    ? new Promise(r => { release = r; }) : Promise.resolve({ data: { ok: true } }) });
  const { dom, api } = await cloudOnly(fake);
  const state = { classes: [], lessons: [], updatedAt: '2026-01-01T00:00:00Z', value: 1 };
  api.touch(() => state);
  const pending = api.flush();
  await tick();
  state.lessons.push({ id: 'second-edit' });
  api.touch(() => state);
  check('concurrent flush waits for the same in-flight work', api.flush() === pending);
  check('pull cannot cancel an upload already in flight', api.cancelPending() === false);
  release({ data: { ok: true } });
  await pending;
  check('edits during upload are sent in a second request', fake.calls.writes.length === 2);
  check('first request is an immutable snapshot', fake.calls.writes[0].lessons.length === 0);
  check('second request includes the latest edit', fake.calls.writes[1].lessons[0].id === 'second-edit');
  api.touch(() => state);
  check('queued upload can be cancelled before a deliberate cloud restore', api.cancelPending() === true);
  dom.window.close();
}
{
  const fake = client({ write: async () => ({ error: { message: 'Failed to fetch', kind: 'network' } }) });
  const { dom, api } = await cloudOnly(fake);
  api.touch(() => ({ classes: [], lessons: [] }));
  await assert.rejects(api.flush());
  check('upload failure is surfaced to the caller', api.status().mode === 'offline');
  dom.window.close();
}
{
  const fake = client();
  const { dom, api } = await cloudOnly(fake);
  await assert.rejects(api.oauthLogin('wechat'));
  check('OAuth preserves the Pages project subdirectory',
    fake.calls.oauth[0].redirectTo === 'https://example.github.io/ye-ye-score-helper/');
  dom.window.close();
}
{
  const data = { version: 1, classes: clone(seed.classes).slice(0, 1), lessons: [], undo: [],
    updatedAt: '2025-01-01T00:00:00Z', ui: {} };
  data.classes[0].name = '云端测试班';
  const fake = client({ record: { data, updated_at: data.updatedAt } });
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''),
    { url: 'https://example.github.io/ye-ye-score-helper/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.alert = () => {};
  dom.window.WorkBuddyCloud = { createWorkBuddyCloud: () => fake.sdk };
  dom.window.SEED_DATA = clone(seed);
  dom.window.eval(fs.readFileSync('cloud.js', 'utf8'));
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  await tick();
  check('a fresh device loads older cloud records instead of new seed timestamps',
    dom.window.document.querySelector('#classSel').textContent.includes('云端测试班'));
  const saved = JSON.parse(dom.window.localStorage.getItem('jfdt.v1'));
  check('cloud records are persisted locally on first login', saved.classes[0].name === '云端测试班');
  check('fresh seed is never scheduled to overwrite existing cloud records',
    dom.window.JFDT_CLOUD.status().mode !== 'saving' && fake.calls.writes.length === 0);
  dom.window.document.querySelector('#btnWxLogin').disabled = true;
  dom.window.dispatchEvent(new dom.window.Event('pageshow'));
  check('returning from OAuth restores the login controls', !dom.window.document.querySelector('#btnWxLogin').disabled);
  check('Pages warns users that real account integration is not yet accepted',
    !dom.window.document.querySelector('#pagesCloudNotice').hidden);
  dom.window.close();
}
{
  const previous = { version: 1, classes: clone(seed.classes).slice(0, 1), lessons: [], ui: {}, undo: [],
    updatedAt: '2099-01-01T00:00:00Z' };
  previous.classes[0].name = '账号甲的私有测试班';
  const fake = client({ userId: 'test-teacher-b' });
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''),
    { url: 'https://example.github.io/ye-ye-score-helper/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('jfdt.v1', JSON.stringify(previous));
  dom.window.localStorage.setItem('jfdt.owner.v1', 'test-teacher-a');
  dom.window.WorkBuddyCloud = { createWorkBuddyCloud: () => fake.sdk };
  dom.window.SEED_DATA = clone(seed);
  dom.window.eval(fs.readFileSync('cloud.js', 'utf8'));
  dom.window.eval(fs.readFileSync('app.js', 'utf8'));
  await tick();
  check('switching teachers does not render the previous teacher records',
    !dom.window.document.querySelector('#classSel').textContent.includes('账号甲的私有测试班'));
  check('previous teacher records are archived without deletion',
    JSON.parse(dom.window.localStorage.getItem('jfdt.account.test-teacher-a')).classes[0].name === '账号甲的私有测试班');
  check('active local storage owner matches the signed-in teacher',
    dom.window.localStorage.getItem('jfdt.owner.v1') === 'test-teacher-b');
  await dom.window.JFDT_CLOUD.flush();
  check('previous teacher records are never uploaded to the new teacher account',
    !fake.calls.writes.some(d => d.classes.some(c => c.name === '账号甲的私有测试班')));
  dom.window.close();
}
console.log(`Online regression: ${passed} passed, 0 failed`);
