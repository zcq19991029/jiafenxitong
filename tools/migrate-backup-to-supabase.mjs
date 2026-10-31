#!/usr/bin/env node
/*
 * 将旧 Worker/D1 导出的完整 JSON 迁移到 Supabase。
 * 运行前设置 SUPABASE_EMAIL、SUPABASE_PASSWORD；不会把密码写入文件。
 * 该脚本只通过用户自己的 Supabase Auth 会话写入 jf_score_states（华夏工具项目），受 RLS 保护。
 */
import fs from 'node:fs/promises';

const backupPath = process.argv[2];
if (!backupPath) throw new Error('用法：node tools/migrate-backup-to-supabase.mjs <备份.json>');
const url = process.env.SUPABASE_URL || 'https://eiqgyrjrwdaunhxjmdyr.supabase.co';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd';
const email = process.env.SUPABASE_EMAIL;
const password = process.env.SUPABASE_PASSWORD;
if (!email || !password) throw new Error('请先设置 SUPABASE_EMAIL 和 SUPABASE_PASSWORD（不要写入仓库）。');

const headers = { apikey: key, 'Content-Type': 'application/json' };
async function api(path, options = {}) {
  const res = await fetch(url + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.msg || body.message || body.error_description || text}`);
  return body;
}

const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
if (!Array.isArray(backup.classes) || !Array.isArray(backup.lessons)) throw new Error('备份结构不完整。');
const session = await api('/auth/v1/token?grant_type=password', {
  method: 'POST', body: JSON.stringify({ email, password })
});
const auth = { Authorization: `Bearer ${session.access_token}` };
const user = await api('/auth/v1/user', { headers: auth });
const payload = { version: 1, createdAt: backup.createdAt || null, updatedAt: backup.updatedAt || new Date().toISOString(), classes: backup.classes, lessons: backup.lessons, undo: backup.undo || [], redo: backup.redo || [], operationLog: backup.operationLog || [] };
const existing = await api(`/rest/v1/jf_score_states?owner_id=eq.${encodeURIComponent(user.id)}&select=revision`, { headers: auth });
const revision = existing[0]?.revision ?? 0;
await api('/rest/v1/jf_score_states', {
  method: existing.length ? 'PATCH' : 'POST',
  headers: { ...auth, Prefer: 'return=minimal' },
  body: JSON.stringify(existing.length ? { data: payload, revision: revision + 1, updated_at: new Date().toISOString() } : { owner_id: user.id, data: payload, revision: 1, updated_at: new Date().toISOString() })
});
console.log(JSON.stringify({ ok: true, userId: user.id, classes: payload.classes.length, lessons: payload.lessons.length, operationLog: payload.operationLog.length }, null, 2));
