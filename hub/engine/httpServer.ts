import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HubApp } from './app.ts';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
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
      if (m === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        const off = app.on((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
        req.on('close', off);
        return;
      }
      if (m === 'POST' && p === '/api/agents') {
        const b = await body(req);
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
        const n = await app.runOne(r[1]);
        return n < 0 ? send(404, { error: 'no agent' }) : send(200, { signals: n });
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
        if (!opts.pairing) return send(501, { error: 'Phone pairing is not available yet' });
        return send(200, await opts.pairing(app));
      }
      if (m === 'POST' && p === '/api/brain') {
        const b = await body(req);
        app.setBrain(b.kind, b.apiKey);
        return send(200, app.brainInfo());
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      send(500, { error: e instanceof Error ? e.message : 'failed' });
    }
  });
  return new Promise((resolve, reject) => (server.once('error', reject), server.listen(opts.port ?? 0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, token }))));
}
