import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HubApp } from './app.ts';
import { toCap } from './cap.ts';
import { cleanRoutes } from './gateway.ts';

const UI = process.env.BEACON_HUB_UI_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

const body = (req: IncomingMessage) =>
  new Promise<Record<string, any>>((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 5_000_000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
  });

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The hub's local UI and API. Bound to 127.0.0.1 only; every /api call needs the random token printed at startup,
 * so a web page in another tab cannot drive it.
 */
export function startHttp(app: HubApp, opts: { port?: number; token?: string; pairing?: (a: HubApp) => Promise<{ qr: string; payload: string }> } = {}): Promise<{ server: Server; port: number; token: string }> {
  const token = opts.token ?? randomBytes(16).toString('hex');
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(v));
    };
    try {
      if (!url.pathname.startsWith('/api/')) {
        const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([/\\])+/, '');
        if (rel.includes('..')) return send(400, { error: 'bad path' });
        try {
          const data = readFileSync(join(UI, rel));
          res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
          return void res.end(data);
        } catch {
          return send(404, { error: 'not found' });
        }
      }
      const given = (req.headers['x-hub-token'] as string | undefined) ?? url.searchParams.get('t') ?? '';
      if (!same(given, token)) return send(401, { error: 'bad token' });
      const m = req.method ?? 'GET';
      const p = url.pathname;
      let r: RegExpMatchArray | null;

      if (m === 'GET' && p === '/api/state') return send(200, app.state());
      if (m === 'GET' && p === '/api/situation') return send(200, app.situation());
      if (m === 'GET' && (r = p.match(/^\/api\/cap\/([\w-]+)$/))) {
        const al = app.hub.alerts().find((x) => x.id === r![1]);
        if (!al) return send(404, { error: 'no alert' });
        const place = app.hub.agents().find((x) => x.id === al.signals[0]?.agentId)?.place?.name;
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' });
        return void res.end(toCap(al, { sender: 'beacon-hub', now: Date.now(), place }));
      }
      if (m === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        const off = app.on((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
        req.on('close', off);
        return;
      }
      if (m === 'POST' && p === '/api/agents') {
        const b = await body(req);
        if (b.personaId) {
          const a = app.enrol(b as Parameters<typeof app.enrol>[0]);
          return a ? send(200, a) : send(404, { error: 'unknown persona or template' });
        }
        if (b.templateId) {
          const a = app.addFromTemplate(String(b.templateId), b.over ?? {});
          return a ? send(200, a) : send(404, { error: 'unknown template' });
        }
        if (b.agent?.id) return app.hub.upsert(b.agent), send(200, b.agent);
        return send(400, { error: 'templateId or agent required' });
      }
      if ((r = p.match(/^\/api\/agents\/([\w-]+)$/))) {
        const id = r[1];
        if (m === 'DELETE') return app.hub.remove(id), send(200, { ok: true });
        if (m === 'PUT') {
          const cur = app.hub.agents().find((a) => a.id === id);
          if (!cur) return send(404, { error: 'no agent' });
          const b = await body(req);
          const next = { ...cur, ...b, id };
          app.hub.upsert(next);
          return send(200, next);
        }
      }
      if (m === 'POST' && (r = p.match(/^\/api\/agents\/([\w-]+)\/toggle$/))) {
        const a = app.hub.agents().find((x) => x.id === r![1]);
        if (!a) return send(404, { error: 'no agent' });
        app.hub.upsert({ ...a, enabled: !a.enabled });
        return send(200, { enabled: !a.enabled });
      }
      if (m === 'POST' && (r = p.match(/^\/api\/agents\/([\w-]+)\/run$/))) {
        const out = await app.runOne(r[1]);
        return out ? send(200, out) : send(404, { error: 'no agent' });
      }
      if (m === 'POST' && (r = p.match(/^\/api\/agents\/([\w-]+)\/rules$/))) {
        const out = await app.addRule(r[1], String((await body(req)).text ?? ''));
        return out ? send(200, { rule: out.rule, via: out.via }) : send(422, { error: 'I could not understand that rule. Try: if heat index > 41 alert me' });
      }
      if (m === 'DELETE' && (r = p.match(/^\/api\/agents\/([\w-]+)\/rules\/([\w-]+)$/))) return app.removeRule(r[1], r[2]), send(200, { ok: true });
      if (m === 'POST' && p === '/api/tick') return send(200, { alerts: (await app.tick()).length });
      if (m === 'POST' && p === '/api/approve') {
        const b = await body(req);
        return send(app.approve(String(b.id), b.answer) ? 200 : 409, { ok: true });
      }
      if (m === 'POST' && p === '/api/health/csv') {
        const b = await body(req);
        return send(200, app.importCsv(String(b.text ?? ''), String(b.member || 'Maa')));
      }
      if (m === 'POST' && p === '/api/health/reading') {
        const b = await body(req);
        if (!b.member) return send(400, { error: 'member required' });
        return app.addReading(b as never), send(200, { ok: true });
      }
      if (m === 'POST' && p === '/api/telegram/token') {
        const bot = await app.connectTelegram(String((await body(req)).token ?? '').trim());
        return send(200, { bot });
      }
      if (m === 'POST' && p === '/api/telegram/pair') {
        if (!app.telegram) return send(409, { error: 'Add the bot token first' });
        return send(200, { code: app.telegram.newPairingCode(), bot: '' });
      }
      if (m === 'POST' && p === '/api/beacon/pair') {
        const b = await body(req);
        if (b.memberId) return send(200, await app.invite(String(b.memberId)));
        return send(200, await (opts.pairing ? opts.pairing(app) : app.pairingQr()));
      }

      // ---- nodes -------------------------------------------------------------
      if (m === 'PUT' && (r = p.match(/^\/api\/agents\/([\w-]+)\/pipeline$/))) {
        const a = app.setPipeline(r[1], (await body(req)).nodes);
        return a ? send(200, a) : send(404, { error: 'no agent' });
      }
      if (m === 'POST' && (r = p.match(/^\/api\/agents\/([\w-]+)\/nodes\/test$/))) {
        const out = await app.testNode(r[1], (await body(req)).node);
        return out ? send(200, out) : send(404, { error: 'no agent' });
      }

      // ---- gateway -----------------------------------------------------------
      if (m === 'PUT' && p === '/api/gateway/routes') return send(200, { routes: app.setRoutes(cleanRoutes((await body(req)).routes)) });
      if (m === 'POST' && p === '/api/gateway/preview') return send(200, { matches: app.gateway.preview((await body(req)).item ?? {}) });
      if (m === 'POST' && p === '/api/gateway/send-test') {
        const b = await body(req);
        const item = { id: 'test-' + Date.now().toString(36), agentId: 'hub', agentName: 'Hub', kind: 'custom' as const, title: 'Test from the desktop', body: String(b.text ?? 'This is a test item from your Hub.').slice(0, 300), severity: 'info' as const, at: Date.now(), tags: [] as string[] };
        const out = await app.gateway.dispatch([item]);
        return send(200, { delivered: out.delivered });
      }
      if (m === 'GET' && p === '/api/feed') return send(200, { items: app.feed() });

      // ---- members, group chat, asks -----------------------------------------
      if (m === 'POST' && p === '/api/members') return send(200, app.addMember(await body(req) as never));
      if ((r = p.match(/^\/api\/members\/([\w-]+)$/))) {
        if (m === 'DELETE') return app.removeMember(r[1]), send(200, { ok: true });
        if (m === 'PUT') return send(200, app.updateMember(r[1], await body(req) as never));
      }
      if (m === 'POST' && (r = p.match(/^\/api\/members\/([\w-]+)\/invite$/))) return send(200, await app.invite(r[1]));
      if (m === 'POST' && (r = p.match(/^\/api\/joins\/([\w-]+)\/approve$/))) {
        const b = await body(req);
        return send(200, app.approveJoin(r[1], b.role, b.name));
      }
      if (m === 'DELETE' && (r = p.match(/^\/api\/joins\/([\w-]+)$/))) return app.declineJoin(r[1]), send(200, { ok: true });
      if (m === 'POST' && p === '/api/chat') return send(200, app.sendChat(String((await body(req)).text ?? '')));
      if (m === 'POST' && (r = p.match(/^\/api\/asks\/([\w-]+)$/))) {
        const b = await body(req);
        return send((await app.decideAsk(r[1], b.answer === 'approve' ? 'approve' : 'deny')) ? 200 : 409, { ok: true });
      }
      if (m === 'PUT' && p === '/api/settings') {
        const b = await body(req);
        if (typeof b.allowAdultAsks === 'boolean') app.setAllowAdultAsks(b.allowAdultAsks);
        if (b.relayUrl !== undefined) {
          try {
            app.setRelayUrl(String(b.relayUrl));
          } catch (e) {
            return send(400, { error: (e as Error).message });
          }
        }
        return send(200, { allowAdultAsks: app.state().group.allowAdultAsks, relayUrl: app.relayUrl });
      }
      if (m === 'POST' && p === '/api/relay/check') {
        const b = await body(req);
        try {
          return send(200, await app.checkRelay(b.relayUrl === undefined ? undefined : String(b.relayUrl)));
        } catch (e) {
          return send(400, { error: (e as Error).message });
        }
      }

      // ---- MCP servers -------------------------------------------------------
      if (m === 'POST' && p === '/api/mcp') return send(200, app.addMcp(await body(req) as never));
      if (m === 'POST' && p === '/api/mcp/test') return send(200, await app.mcp.test((await body(req)).spec));
      if ((r = p.match(/^\/api\/mcp\/([\w-]+)$/))) {
        if (m === 'DELETE') return await app.removeMcp(r[1]), send(200, { ok: true });
        if (m === 'PUT') return send(200, await app.updateMcp(r[1], await body(req) as never));
      }
      if (m === 'POST' && (r = p.match(/^\/api\/mcp\/([\w-]+)\/connect$/))) return send(200, await app.connectMcp(r[1]));
      if (m === 'POST' && (r = p.match(/^\/api\/mcp\/([\w-]+)\/call$/))) {
        const b = await body(req);
        return send(200, { result: await app.mcp.callTool(r[1], String(b.tool), b.args ?? {}) });
      }
      if (m === 'POST' && p === '/api/brain') {
        const b = await body(req);
        app.setBrain(b.kind, b.apiKey);
        return send(200, app.brainInfo());
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      // errors here come from bad input far more often than from bugs; the message says what to fix
      send(400, { error: e instanceof Error ? e.message : 'failed' });
    }
  });
  return new Promise((resolve, reject) => (server.once('error', reject), server.listen(opts.port ?? 0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, token }))));
}
