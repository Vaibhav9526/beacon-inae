import { mkdirSync, readFileSync, renameSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerSpec, McpToolInfo } from './types.ts';

/**
 * External MCP servers the person connects to the hub (desktop UI only). Specs persist to a JSON file, mode 600.
 * Connections are made on demand: a server whose `enabled` is false is never started.
 */

type Transport = StdioClientTransport | StreamableHTTPClientTransport;

interface Live {
  client: Client;
  transport: Transport;
  tools: McpToolInfo[];
}

export interface ConnectResult {
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}

export type McpSpecInput = Omit<McpServerSpec, 'id'> & { id?: string };

const SHELL_META = /[;&|`$><]/;
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const CLIENT_INFO = { name: 'beacon-hub-client', version: '0.1.0' };

/** Turns a display name into a url-safe id: "My Maps (Local)" -> "my-maps-local". */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || 'server';
}

function stringRecord(v: unknown, label: string): Record<string, string> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label} must be an object of strings`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string') throw new Error(`${label}.${k} must be a string`);
    out[k] = val;
  }
  return out;
}

/** Checks a spec and returns a clean copy. Fields that do not belong to the transport are dropped. */
export function validateSpec(input: McpSpecInput): McpServerSpec {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('name is required');
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const base = { id: input.id ?? slugify(input.name), name: input.name.trim(), enabled };
  if (input.transport === 'stdio') {
    const command = input.command;
    if (typeof command !== 'string' || !command.trim()) throw new Error('stdio server needs a command');
    if (SHELL_META.test(command)) throw new Error('command must not contain shell characters (; & | ` $ > <)');
    if (input.args !== undefined && (!Array.isArray(input.args) || !input.args.every((a) => typeof a === 'string'))) {
      throw new Error('args must be an array of strings');
    }
    const env = stringRecord(input.env, 'env');
    return { ...base, transport: 'stdio', command: command.trim(), args: [...(input.args ?? [])], ...(env ? { env } : {}) };
  }
  if (input.transport === 'http') {
    let url: URL;
    try {
      url = new URL(String(input.url ?? ''));
    } catch {
      throw new Error('http server needs a valid url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must be http or https');
    const headers = stringRecord(input.headers, 'headers');
    return { ...base, transport: 'http', url: url.toString(), ...(headers ? { headers } : {}) };
  }
  throw new Error('transport must be "stdio" or "http"');
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class McpClients {
  readonly #file: string;
  readonly #connectTimeoutMs: number;
  #specs: McpServerSpec[] = [];
  readonly #live = new Map<string, Live>();
  readonly #pending = new Map<string, Promise<ConnectResult>>();
  readonly #errors = new Map<string, string>();

  constructor(file: string, opts: { connectTimeoutMs?: number } = {}) {
    this.#file = file;
    this.#connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.#load();
  }

  list(): McpServerSpec[] {
    return this.#specs.map((s) => ({ ...s }));
  }

  add(spec: McpSpecInput): McpServerSpec {
    const clean = validateSpec(spec);
    const id = this.#uniqueId(clean.id);
    const saved = { ...clean, id };
    this.#specs = [...this.#specs, saved];
    this.#save();
    return { ...saved };
  }

  async remove(id: string): Promise<void> {
    await this.#drop(id);
    this.#specs = this.#specs.filter((s) => s.id !== id);
    this.#errors.delete(id);
    this.#save();
  }

  async update(id: string, patch: Partial<Omit<McpServerSpec, 'id'>>): Promise<McpServerSpec> {
    const current = this.#specs.find((s) => s.id === id);
    if (!current) throw new Error(`no MCP server "${id}"`);
    const next = validateSpec({ ...current, ...patch, id });
    // a changed definition must not keep running the old process
    await this.#drop(id);
    this.#errors.delete(id);
    this.#specs = this.#specs.map((s) => (s.id === id ? next : s));
    this.#save();
    return { ...next };
  }

  connect(id: string): Promise<ConnectResult> {
    const live = this.#live.get(id);
    if (live) return Promise.resolve({ ok: true, tools: [...live.tools] });
    const running = this.#pending.get(id);
    if (running) return running;
    const spec = this.#specs.find((s) => s.id === id);
    if (!spec) return Promise.resolve({ ok: false, tools: [], error: `no MCP server "${id}"` });
    const job = this.#start(spec)
      .then((conn) => {
        this.#live.set(id, conn);
        this.#errors.delete(id);
        conn.transport.onclose = () => {
          if (this.#live.get(id) === conn) this.#live.delete(id);
        };
        return { ok: true, tools: [...conn.tools] };
      })
      .catch((e: unknown) => {
        const error = errorText(e);
        this.#errors.set(id, error);
        return { ok: false, tools: [], error };
      })
      .finally(() => this.#pending.delete(id));
    this.#pending.set(id, job);
    return job;
  }

  /** Connects once to a spec without saving it, then closes. Never starts a disabled server. */
  async test(spec: McpSpecInput): Promise<ConnectResult> {
    let clean: McpServerSpec;
    try {
      clean = validateSpec(spec);
    } catch (e) {
      return { ok: false, tools: [], error: errorText(e) };
    }
    if (!clean.enabled) return { ok: false, tools: [], error: 'server is disabled' };
    try {
      const conn = await this.#start({ ...clean, id: clean.id });
      const tools = [...conn.tools];
      await conn.client.close().catch(() => undefined);
      return { ok: true, tools };
    } catch (e) {
      return { ok: false, tools: [], error: errorText(e) };
    }
  }

  tools(): McpToolInfo[] {
    return [...this.#live.values()].flatMap((c) => c.tools.map((t) => ({ ...t })));
  }

  async callTool(server: string, tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const conn = this.#live.get(server);
    if (!conn) throw new Error(`MCP server "${server}" is not connected`);
    if (!conn.tools.some((t) => t.name === tool)) throw new Error(`MCP server "${server}" has no tool "${tool}"`);
    const r = (await conn.client.callTool({ name: tool, arguments: args })) as { content?: unknown; isError?: boolean };
    const content = Array.isArray(r.content) ? (r.content as Array<{ type?: string; text?: string }>) : [];
    if (r.isError) {
      const msg = content.find((b) => b.type === 'text')?.text ?? 'tool reported an error';
      throw new Error(`${server}.${tool} failed: ${msg}`);
    }
    const text = content.find((b) => b.type === 'text' && typeof b.text === 'string')?.text;
    if (text === undefined) return r.content;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.#live.keys()];
    await Promise.all(ids.map((id) => this.#drop(id)));
  }

  status(): Array<{ id: string; connected: boolean; toolCount: number; error?: string }> {
    return this.#specs.map((s) => {
      const live = this.#live.get(s.id);
      const error = this.#errors.get(s.id);
      return { id: s.id, connected: Boolean(live), toolCount: live?.tools.length ?? 0, ...(error ? { error } : {}) };
    });
  }

  // ---- internals ----

  async #drop(id: string): Promise<void> {
    const live = this.#live.get(id);
    if (!live) return;
    this.#live.delete(id);
    await live.client.close().catch(() => undefined);
  }

  #uniqueId(base: string): string {
    const taken = new Set(this.#specs.map((s) => s.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  /** Starts the transport, initializes the client and lists tools. Closes everything on any failure. */
  async #start(spec: McpServerSpec): Promise<Live> {
    if (!spec.enabled) throw new Error('server is disabled');
    const transport: Transport =
      spec.transport === 'stdio'
        ? new StdioClientTransport({
            command: spec.command ?? '',
            args: spec.args ?? [],
            // the SDK's safe inherited set, plus the person's own env for this server
            env: { ...getDefaultEnvironment(), ...(spec.env ?? {}) },
            stderr: 'ignore',
          })
        : new StreamableHTTPClientTransport(new URL(spec.url ?? ''), { requestInit: { headers: spec.headers ?? {} } });
    const client = new Client(CLIENT_INFO);
    const ms = this.#connectTimeoutMs;
    try {
      await withTimeout(client.connect(transport), ms, 'connect');
      const listed = await withTimeout(client.listTools(), ms, 'tools/list');
      const tools: McpToolInfo[] = listed.tools.map((t) => ({
        server: spec.id,
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }));
      return { client, transport, tools };
    } catch (e) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      throw new Error(`${spec.name}: ${errorText(e)}`);
    }
  }

  #load(): void {
    if (!existsSync(this.#file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.#file, 'utf8')) as unknown;
      const list = Array.isArray(raw) ? raw : [];
      this.#specs = list.flatMap((item) => {
        try {
          const s = validateSpec(item as McpSpecInput);
          return [{ ...s, id: s.id || slugify(s.name) }];
        } catch {
          return [];
        }
      });
    } catch {
      // keep the unreadable file aside rather than overwrite it on the next save
      renameSync(this.#file, `${this.#file}.corrupt`);
      this.#specs = [];
    }
  }

  #save(): void {
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(this.#specs, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(this.#file, 0o600);
    } catch {
      // Windows keeps only the read-only bit; the file lives in the person's own data folder
    }
  }
}
