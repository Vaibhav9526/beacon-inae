import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { McpClients, slugify } from './mcpClients.ts';

const FIXTURE = resolve('engine/fixtures/echoMcpServer.ts');
const dir = mkdtempSync(join(tmpdir(), 'mcpc-'));
const pidFile = join(dir, 'echo.pid');
const created: McpClients[] = [];

function make(file = 'servers.json', timeout = 20_000) {
  const c = new McpClients(join(dir, file), { connectTimeoutMs: timeout });
  created.push(c);
  return c;
}

const echoSpec = (extra: Record<string, unknown> = {}) => ({
  name: 'Echo Fixture',
  transport: 'stdio' as const,
  command: process.execPath,
  args: ['--import', 'tsx', FIXTURE],
  env: { ECHO_PID_FILE: pidFile },
  enabled: true,
  ...extra,
});

async function waitGone(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

after(async () => {
  for (const c of created) await c.disconnectAll();
});

test('slugify makes url-safe ids', () => {
  assert.equal(slugify('My Maps (Local)'), 'my-maps-local');
  assert.equal(slugify('  !!  '), 'server');
});

test('add, update and remove persist to the file with mode 600', async () => {
  const file = join(dir, 'persist.json');
  const c = new McpClients(file);
  const a = c.add({ name: 'Maps Tools', transport: 'stdio', command: 'node', args: ['x.js'], env: { TOKEN: 'secret' }, enabled: true });
  const b = c.add({ name: 'Maps Tools', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer t' }, enabled: false });
  assert.equal(a.id, 'maps-tools');
  assert.equal(b.id, 'maps-tools-2');

  const reloaded = new McpClients(file);
  assert.deepEqual(reloaded.list().map((s) => s.id), ['maps-tools', 'maps-tools-2']);
  assert.equal(reloaded.list()[0].env?.TOKEN, 'secret');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);

  const updated = await c.update('maps-tools-2', { enabled: true, name: 'Remote Maps' });
  assert.equal(updated.enabled, true);
  assert.equal(new McpClients(file).list().find((s) => s.id === 'maps-tools-2')?.name, 'Remote Maps');

  await c.remove('maps-tools');
  assert.deepEqual(new McpClients(file).list().map((s) => s.id), ['maps-tools-2']);
  await assert.rejects(c.update('nope', { enabled: false }), /no MCP server/);
});

test('validation rejects bad stdio and http specs', () => {
  const c = make('validate.json');
  assert.throws(() => c.add({ name: 'x', transport: 'stdio', command: 'node; rm -rf', enabled: true }), /shell characters/);
  assert.throws(() => c.add({ name: 'x', transport: 'stdio', command: '  ', enabled: true }), /needs a command/);
  assert.throws(() => c.add({ name: 'x', transport: 'stdio', command: 'node', args: ['a', 2 as unknown as string], enabled: true }), /args/);
  assert.throws(() => c.add({ name: 'x', transport: 'http', url: 'ftp://example.com', enabled: true }), /http or https/);
  assert.throws(() => c.add({ name: 'x', transport: 'http', url: 'not a url', enabled: true }), /valid url/);
  assert.equal(c.list().length, 0);
});

test('connect lists tools; echo and headlines return values', async () => {
  const c = make('echo.json');
  const spec = c.add(echoSpec({ name: 'Echo' }));
  const r = await c.connect(spec.id);
  assert.equal(r.ok, true, r.error ?? "connect failed");
  assert.deepEqual(r.tools.map((t) => t.name).sort(), ['echo', 'headlines']);
  assert.equal(c.tools().length, 2);
  assert.deepEqual(c.status(), [{ id: 'echo', connected: true, toolCount: 2 }]);

  assert.equal(await c.callTool(spec.id, 'echo', { text: 'hello hub' }), 'hello hub');
  const heads = await c.callTool(spec.id, 'headlines', {});
  assert.ok(Array.isArray(heads));
  assert.equal((heads as unknown[]).length, 2);
});

test('connect reuses a live connection', async () => {
  const c = make('reuse.json');
  const spec = c.add(echoSpec({ name: 'Reuse' }));
  const [a, b] = await Promise.all([c.connect(spec.id), c.connect(spec.id)]);
  assert.equal(a.ok && b.ok, true);
  const again = await c.connect(spec.id);
  assert.equal(again.ok, true);
  await c.disconnectAll();
});

test('test() connects once without saving', async () => {
  const c = make('probe.json');
  const r = await c.test(echoSpec({ name: 'Probe' }));
  assert.equal(r.ok, true, r.error ?? "connect failed");
  assert.equal(r.tools.length, 2);
  assert.equal(c.list().length, 0);
  assert.equal(c.tools().length, 0);
});

test('error paths: bad command, unknown tool, not connected, disabled', async () => {
  const c = make('errors.json');
  const bad = c.add({ name: 'Nothing Here', transport: 'stdio', command: 'definitely-not-a-real-binary-xyz', enabled: true });
  const badRes = await c.connect(bad.id);
  assert.equal(badRes.ok, false);
  assert.ok(badRes.error);
  assert.equal(c.status().find((s) => s.id === bad.id)?.connected, false);

  const offPid = join(dir, 'off.pid');
  const off = c.add(echoSpec({ name: 'Off', enabled: false, env: { ECHO_PID_FILE: offPid } }));
  const offRes = await c.connect(off.id);
  assert.equal(offRes.ok, false);
  assert.match(offRes.error ?? '', /disabled/);
  const offTest = await c.test({ ...echoSpec({ env: { ECHO_PID_FILE: offPid } }), enabled: false });
  assert.equal(offTest.ok, false);
  assert.equal(existsSync(offPid), false, 'a disabled server must never be started');

  const on = c.add(echoSpec({ name: 'Echo Errors' }));
  assert.equal((await c.connect(on.id)).ok, true);
  await assert.rejects(c.callTool(on.id, 'missing-tool', {}), /no tool "missing-tool"/);
  await assert.rejects(c.callTool('not-connected', 'echo', {}), /not connected/);
  await c.disconnectAll();

  const slow = new McpClients(join(dir, 'slow.json'), { connectTimeoutMs: 1000 });
  created.push(slow);
  const hang = slow.add({ name: 'Hangs', transport: 'stdio', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], enabled: true });
  const hangRes = await slow.connect(hang.id);
  assert.equal(hangRes.ok, false);
  assert.match(hangRes.error ?? '', /timed out/);
});

test('disconnectAll and remove stop the child process', async () => {
  const c = make('kill.json');
  const spec = c.add(echoSpec({ name: 'Killable' }));
  assert.equal((await c.connect(spec.id)).ok, true);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  await c.disconnectAll();
  assert.equal(await waitGone(pid), true, 'child process still running after disconnectAll');
  assert.equal(c.status()[0].connected, false);

  const again = await c.connect(spec.id);
  assert.equal(again.ok, true);
  await c.remove(spec.id);
  assert.equal(c.list().length, 0);
  assert.equal(c.tools().length, 0);
});
