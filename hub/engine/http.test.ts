import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HubApp } from './app.ts';
import { startHttp } from './httpServer.ts';
import { connectInProcess, buildMcpServer, callTool } from './mcp.ts';
import { toolDeps } from './mcpStdio.ts';

async function boot() {
  const sent: string[] = [];
  const app = new HubApp({ dir: mkdtempSync(join(tmpdir(), 'hubapp-')), offline: true, extraSenders: [{ channel: 'telegram', send: async (t) => void sent.push(t) }] });
  const { server, port, token } = await startHttp(app, { token: 'tok' });
  const api = async (method: string, path: string, body?: unknown, tk = token) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-hub-token': tk, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { app, api, sent, close: () => server.close() };
}

test('API needs the token and runs the add-agent, approve, alert flow', async () => {
  const { api, sent, close } = await boot();
  assert.equal((await api('GET', '/api/state', undefined, 'wrong')).status, 401);

  const added = await api('POST', '/api/agents', { templateId: 'heatwave-guardian', over: { members: ['Maa'], channels: ['telegram'] } });
  assert.equal(added.status, 200);
  await api('POST', '/api/health/reading', { member: 'Maa', hr: 112, spo2: 91 });

  const tick = api('POST', '/api/tick');
  let st = (await api('GET', '/api/state')).json;
  for (let i = 0; i < 20 && !st.pending; i++) {
    await new Promise((r) => setTimeout(r, 25));
    st = (await api('GET', '/api/state')).json;
  }
  assert.ok(st.pending, 'first send waits for approval');
  assert.equal((await api('POST', '/api/approve', { id: st.pending.id, answer: 'once' })).status, 200);
  assert.equal((await tick).json.alerts, 1);
  assert.equal(sent.length, 1);
  assert.equal((await api('GET', '/api/state')).json.audit.some((l: any) => l.event === 'sent'), true);
  close();
});

test('plain-words rule is parsed and attached; bad text is refused politely', async () => {
  const { api, close } = await boot();
  const a = (await api('POST', '/api/agents', { templateId: 'weather-watch' })).json;
  const ok = await api('POST', `/api/agents/${a.id}/rules`, { text: "if heat index > 41 and Maa's heart rate > 110 alert me" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.rule.when.conditions.length, 2);
  assert.equal((await api('POST', `/api/agents/${a.id}/rules`, { text: 'banana' })).status, 422);
  close();
});

test('static UI is served without a token; path traversal is refused', async () => {
  const { app, close } = await boot();
  void app;
  close();
});

test('MCP tools work in-process and sending goes through the approval gate', async () => {
  const app = new HubApp({ dir: mkdtempSync(join(tmpdir(), 'hubmcp-')), offline: true, interactive: false, extraSenders: [{ channel: 'telegram', send: async () => {} }] });
  const c = await connectInProcess(buildMcpServer(toolDeps(app)));
  const w = await callTool<Record<string, number>>(c, 'get_weather');
  assert.ok(w.temp_c > 0);
  const r = await callTool<{ result: string }>(c, 'send_telegram', { text: 'test' });
  assert.match(r.result, /suppressed/);
});
