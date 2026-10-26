import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { BeaconLink } from './beaconLink.ts';
import { HubApp } from './app.ts';
import { startHttp } from './httpServer.ts';
import { decodeWire } from './wire.ts';
import type { WireMessage } from './types.ts';

/** Same fake relay as hubv2.test.ts: records what the hub sends each phone. */
function fakeLink() {
  const sent: Array<{ deviceId: string; msg: WireMessage }> = [];
  const keyRef: { gk: () => Uint8Array } = { gk: () => new Uint8Array(32) };
  const link = {
    channel: 'beacon',
    register() {},
    phones: () => [],
    send() {},
    inbox: async () => [],
    sendToPhone: async (deviceId: string, blob: string) => {
      const msg = decodeWire(blob, keyRef.gk());
      if (msg) sent.push({ deviceId, msg });
    },
    pairingQr: async () => ({ qr: 'data:image/png;base64,AA', payload: '{}' }),
  } as unknown as BeaconLink;
  return { link, sent, keyRef };
}

async function boot() {
  const fake = fakeLink();
  const app = new HubApp({ dir: mkdtempSync(join(tmpdir(), 'hubv2http-')), offline: true, link: fake.link });
  fake.keyRef.gk = () => app.groupKey();
  const adult = app.addMember({ name: 'Vaibhav', role: 'adult' });
  const { server, port, token } = await startHttp(app, { token: 'tok' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, path: string, body?: unknown, tk = token) => {
    const r = await fetch(base + path, { method, headers: { 'x-hub-token': tk, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  };
  /** A request with a body that is not JSON at all. */
  const rawPost = async (path: string, raw: string) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'x-hub-token': token, 'content-type': 'application/json' }, body: raw });
    return { status: r.status, json: (await r.json()) as any };
  };
  const close = () => {
    server.closeAllConnections?.();
    server.close();
  };
  return { app, api, rawPost, adult, sent: fake.sent, close };
}

test('GET /api/state needs the token and carries group, feed, gateway, mcp and node kinds', async () => {
  const { api, adult, close } = await boot();
  try {
    assert.equal((await api('GET', '/api/state', undefined, 'wrong')).status, 401);
    const st = (await api('GET', '/api/state')).json;
    assert.equal(st.group.members[0].id, adult.id);
    assert.ok(Array.isArray(st.group.pendingJoins) && Array.isArray(st.group.asks));
    assert.ok(Array.isArray(st.feed));
    assert.deepEqual(st.gateway.routes.map((r: { id: string }) => r.id), ['health-adults', 'urgent', 'news']);
    assert.ok(Array.isArray(st.mcp.servers) && Array.isArray(st.mcp.status) && Array.isArray(st.mcp.tools));
    // the node catalogue lists every kind the hub can run: rss, http-json, weather, aqi, quake, cap, mcp-tool,
    // keyword-filter, threshold, dedupe, summarize (11; the brief said 10)
    assert.equal(st.nodeKinds.length, 15); // plus the four OpenWeather nodes
    assert.ok(st.nodeKinds.some((k: { kind: string }) => k.kind === 'rss'));
  } finally {
    close();
  }
});

test('members, invites and group chat over HTTP', async () => {
  const { app, api, sent, adult, close } = await boot();
  try {
    const elder = await api('POST', '/api/members', { name: 'Nani', role: 'elder' });
    assert.equal(elder.status, 200);
    assert.equal(elder.json.role, 'elder');

    const inv = await api('POST', `/api/members/${elder.json.id}/invite`);
    assert.equal(inv.status, 200);
    assert.match(inv.json.code, /^[A-Z2-9]{8}$/);
    assert.equal(inv.json.qr, 'data:image/png;base64,AA');

    const sentChat = await api('POST', '/api/chat', { text: 'Dinner at 8' });
    assert.equal(sentChat.status, 200);
    assert.equal(sentChat.json.text, 'Dinner at 8');
    assert.equal(sentChat.json.fromName, adult.name);

    // the elder's phone pairs with the invite (the phone sends hello over the relay), then desktop chat reaches it
    await app.onWire('dev-nani', { t: 'hello', name: 'Nani phone', invite: inv.json.code });
    sent.length = 0;
    const later = await api('POST', '/api/chat', { text: 'See you soon' });
    assert.equal(later.status, 200);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(sent.map((s) => s.deviceId), ['dev-nani']);
    assert.ok(sent.every((s) => s.msg.t === 'chat'));

    const renamed = await api('PUT', `/api/members/${elder.json.id}`, { name: 'Nani ji' });
    assert.equal(renamed.json.name, 'Nani ji');
  } finally {
    close();
  }
});

test('gateway routes can be disabled and the preview follows them', async () => {
  const { api, close } = await boot();
  try {
    const st = (await api('GET', '/api/state')).json;
    const routes = st.gateway.routes as Array<{ id: string; enabled: boolean }>;
    const alert = { item: { kind: 'alert', severity: 'severe' } };

    const before = await api('POST', '/api/gateway/preview', alert);
    assert.equal(before.status, 200);
    assert.ok(before.json.matches.some((m: { routeId: string }) => m.routeId === 'urgent'));

    const disabled = routes.map((r) => (r.id === 'urgent' ? { ...r, enabled: false } : r));
    const put = await api('PUT', '/api/gateway/routes', { routes: disabled });
    assert.equal(put.status, 200);
    assert.equal(put.json.routes.find((r: { id: string }) => r.id === 'urgent').enabled, false);

    const after = await api('POST', '/api/gateway/preview', alert);
    assert.equal(after.status, 200);
    assert.ok(!after.json.matches.some((m: { routeId: string }) => m.routeId === 'urgent'), 'a disabled route does not match');
  } finally {
    close();
  }
});

test('agent pipelines and node tests over HTTP', async () => {
  const { app, api, close } = await boot();
  try {
    const a = app.enrol({ personaId: 'firefighter', name: 'Flint Watch' });
    assert.ok(a);

    const put = await api('PUT', `/api/agents/${a!.id}/pipeline`, { nodes: [{ kind: 'dedupe', label: '', config: {} }, { kind: 'summarize', config: {} }] });
    assert.equal(put.status, 200);
    assert.equal(put.json.pipeline.length, 2);
    assert.equal(put.json.pipeline[0].label, 'Remove repeats');

    const test1 = await api('POST', `/api/agents/${a!.id}/nodes/test`, { node: { id: 'd', kind: 'dedupe', label: 'd', config: {} } });
    assert.equal(test1.status, 200);
    assert.equal(test1.json.result.ok, true);
    assert.deepEqual(test1.json.items, []);
    assert.equal(app.feed().length, 0, 'a node test stores nothing');

    assert.equal((await api('PUT', '/api/agents/no-such/pipeline', { nodes: [] })).status, 404);
  } finally {
    close();
  }
});

test('bad input comes back as 400 with a message that says what to fix', async () => {
  const { app, api, rawPost, close } = await boot();
  try {
    const a = app.enrol({ personaId: 'firefighter' });
    assert.ok(a);

    const noName = await api('POST', '/api/members', { role: 'elder' });
    assert.equal(noName.status, 400);
    assert.equal(noName.json.error, 'A member needs a name');

    const empty = await api('POST', '/api/chat', { text: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, 'Message is empty');

    const badKind = await api('PUT', `/api/agents/${a!.id}/pipeline`, { nodes: [{ kind: 'telepathy' }] });
    assert.equal(badKind.status, 400);
    assert.match(badKind.json.error, /Unknown node kind at position 1/);

    const notList = await api('PUT', `/api/agents/${a!.id}/pipeline`, { nodes: 'rss' });
    assert.equal(notList.status, 400);
    assert.equal(notList.json.error, 'nodes must be a list');

    const notJson = await rawPost('/api/chat', '{not json');
    assert.equal(notJson.status, 400);
    assert.equal(notJson.json.error, 'bad json');

  } finally {
    close();
  }
});
