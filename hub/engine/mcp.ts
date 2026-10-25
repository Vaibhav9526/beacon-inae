import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { Metrics, Place } from './types.ts';

/** What the tools need from the rest of the hub. Injected so the server is easy to test. */
export interface ToolDeps {
  weather(place: Place): Promise<Metrics>;
  aqi(place: Place): Promise<Metrics>;
  alerts(place: Place): Promise<Metrics>;
  /** Short per-member status, no raw history. */
  familyStatus(): Promise<Array<{ member: string; hr?: number; spo2?: number; status: 'ok' | 'attention' | 'urgent' }>>;
  /** Goes through the outbox: approval gate + audit log. */
  sendTelegram(text: string): Promise<string>;
  pushToBeacon(text: string, severity: string): Promise<string>;
  defaultPlace(): Place;
}

const placeShape = {
  lat: z.number().min(-90).max(90).optional().describe('Latitude; omit to use the hub home place'),
  lon: z.number().min(-180).max(180).optional(),
  name: z.string().optional(),
};

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

export function buildMcpServer(d: ToolDeps): McpServer {
  const s = new McpServer({ name: 'beacon-hub', version: '0.1.0' });
  const where = (a: { lat?: number; lon?: number; name?: string }): Place =>
    a.lat !== undefined && a.lon !== undefined ? { name: a.name ?? 'there', lat: a.lat, lon: a.lon } : d.defaultPlace();

  s.registerTool('get_weather', { description: 'Current weather, heat index, rain and UV for a place.', inputSchema: placeShape }, async (a) => json(await d.weather(where(a))));
  s.registerTool('get_aqi', { description: 'Current air quality (US AQI and PM2.5) for a place.', inputSchema: placeShape }, async (a) => json(await d.aqi(where(a))));
  s.registerTool('get_alerts', { description: 'Official NDMA / IMD alerts that apply to a place.', inputSchema: placeShape }, async (a) => json(await d.alerts(where(a))));
  s.registerTool('get_family_status', { description: 'Latest heart rate, oxygen and an ok/attention/urgent status for each family member. No history.', inputSchema: {} }, async () => json(await d.familyStatus()));
  s.registerTool(
    'send_telegram',
    { description: 'Send a short alert to the family Telegram group. The person approves the first send.', inputSchema: { text: z.string().min(1).max(500) } },
    async ({ text }) => json({ result: await d.sendTelegram(text) }),
  );
  s.registerTool(
    'push_to_beacon_app',
    { description: 'Send a short alert to the family phones running Beacon.', inputSchema: { text: z.string().min(1).max(300), severity: z.enum(['info', 'watch', 'warning', 'severe']).default('warning') } },
    async ({ text, severity }) => json({ result: await d.pushToBeacon(text, severity) }),
  );
  return s;
}

/** In-process client: the orchestrator and the Haiku helpers call tools exactly as an external CLI would over stdio. */
export async function connectInProcess(server: McpServer): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'beacon-hub-internal', version: '0.1.0' });
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

export async function callTool<T = unknown>(c: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await c.callTool({ name, arguments: args });
  const block = (r.content as Array<{ type: string; text?: string }>)[0];
  if (r.isError) throw new Error(block?.text ?? 'tool failed');
  return JSON.parse(block?.text ?? 'null') as T;
}
