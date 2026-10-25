import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  /** Raw body bytes (already read, size-limited). */
  raw: Buffer;
  json<T = any>(): T;
  /** Set by the auth guard on signed routes. */
  device?: string;
}

export interface Res {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: Req) => Promise<Res | unknown> | Res | unknown;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export const reply = (body: unknown, status = 200, headers?: Record<string, string>): Res => ({ status, body, headers });

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method, re, keys, handler });
  }
  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);

  async handle(req: IncomingMessage, res: ServerResponse, maxBody: number) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    try {
      const route = this.routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, 'not found');
      const m = url.pathname.match(route.re)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const raw = await readBody(req, maxBody);
      const r: Req = {
        method: req.method!,
        path: url.pathname,
        query: url.searchParams,
        params,
        headers: req.headers,
        raw,
        json: () => {
          try {
            return JSON.parse(raw.toString('utf8'));
          } catch {
            throw new HttpError(400, 'invalid JSON');
          }
        },
      };
      const out = (await route.handler(r)) as Res | unknown;
      const resp = isRes(out) ? out : reply(out);
      send(res, resp, cors);
    } catch (e) {
      if (e instanceof HttpError) send(res, reply({ error: e.message }, e.status), cors);
      else {
        console.error('unhandled', e);
        send(res, reply({ error: 'internal error' }, 500), cors);
      }
    }
  }
}

const isRes = (o: unknown): o is Res => !!o && typeof o === 'object' && 'status' in o && 'body' in o;

/** Headers on every response: stop browsers sniffing types. JSON answers are never cached (they hold personal data). */
const COMMON = { 'x-content-type-options': 'nosniff' };

function send(res: ServerResponse, r: Res, base: Record<string, string>) {
  if (Buffer.isBuffer(r.body)) {
    res.writeHead(r.status, { ...base, ...COMMON, ...r.headers });
    res.end(r.body);
  } else if (typeof r.body === 'string' && r.headers?.['content-type']) {
    res.writeHead(r.status, { ...base, ...COMMON, ...r.headers });
    res.end(r.body);
  } else {
    res.writeHead(r.status, { ...base, ...COMMON, 'content-type': 'application/json', 'cache-control': 'no-store', ...r.headers });
    res.end(JSON.stringify(r.body));
  }
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > max) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
