import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HubApp } from './app.ts';
import { BeaconLink } from './beaconLink.ts';
import { healthMetrics } from './healthMetrics.ts';
import { buildMcpServer } from './mcp.ts';
import type { ToolDeps } from './mcp.ts';
import { getAlerts, getAqi, getWeather } from './sources.ts';
import type { Alert, Place } from './types.ts';

const HOME: Place = { name: 'Delhi', lat: 28.61, lon: 77.21, state: 'delhi' };

export function toolDeps(app: HubApp): ToolDeps {
  const src = { offline: app.offline };
  const alertFor = (text: string, severity: Alert['severity'], channel: 'telegram' | 'beacon'): Alert => ({ id: `mcp-${Date.now().toString(36)}`, severity, title: 'Message', body: text, channels: [channel], signals: [], at: Date.now(), status: 'pending-approval' });
  const deliver = async (text: string, severity: Alert['severity'], channel: 'telegram' | 'beacon') => {
    // external CLIs go through the same approval gate and audit log as the agents do
    const done = await app.outbox.deliver(alertFor(text, severity, channel), text);
    return done.status + (done.note ? `: ${done.note}` : '');
  };
  return {
    weather: (p) => getWeather(p, src),
    aqi: (p) => getAqi(p, src),
    alerts: (p) => getAlerts(p, src),
    familyStatus: async () =>
      app.health.members().map((member) => {
        const m = healthMetrics(app.health, [member]);
        const s = m[`health_status:${member}`] ?? 0;
        return { member, hr: m[`hr:${member}`], spo2: m[`spo2:${member}`], status: s >= 2 ? 'urgent' : s === 1 ? 'attention' : 'ok' };
      }),
    sendTelegram: (t) => deliver(t, 'warning', 'telegram'),
    pushToBeacon: (t, sev) => deliver(t, sev as Alert['severity'], 'beacon'),
    defaultPlace: () => app.hub.agents().find((a) => a.place)?.place ?? HOME,
  };
}

/** `npm run mcp`: lets Claude Code, Codex or Gemini CLI use the hub's tools over stdio. */
export async function runStdio() {
  const app = new HubApp({ interactive: false });
  app.addSender(new BeaconLink(app.dir, app.relayUrl));
  const server = buildMcpServer(toolDeps(app));
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('mcpStdio.ts')) void runStdio();
