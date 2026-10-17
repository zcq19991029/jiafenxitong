/* Test-only D1 adapter backed by real SQLite, without network or production credentials. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from '../../backend/worker.mjs';
export const ORIGIN = 'https://class-score.example.test';
export const PASSWORD = 'Test-only-password-123';
export function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('backend/migrations/0001_initial.sql', 'utf8'));
  function statement(sql, values = []) {
    const execute = () => {
      const result = sqlite.prepare(sql).run(...values);
      return { success: true, meta: { changes: Number(result.changes) } };
    };
    return { bind: (...args) => statement(sql, args),
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => execute(), execute };
  }
  return { BOOTSTRAP_CODE: 'TEST-ONLY-BOOTSTRAP', ALLOWED_ORIGINS: ORIGIN, sqlite,
    DB: { prepare: statement, batch: async statements => {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    } } };
}
export async function api(env, path, method = 'GET', body, token, origin = ORIGIN) {
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.2' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await worker.fetch(new Request('https://api.example.test' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: response.status, headers: response.headers,
    data: response.status === 204 ? null : await response.json() };
}
export async function initialAdmin(env) {
  const result = await api(env, '/api/auth/register', 'POST', { username: 'admin-test', password: PASSWORD,
    displayName: '管理员示例', inviteCode: env.BOOTSTRAP_CODE });
  if (result.status !== 201) throw new Error('Fixture registration failed: ' + JSON.stringify(result.data));
  return result.data;
}
export { worker };
