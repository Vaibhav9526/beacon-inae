import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { AlertService } from './alerts.ts';
import { createApp, pushNewAlerts } from './app.ts';
import { resolveDataDir, startupWarnings, readVersion } from './config.ts';
import { openDb } from './db.ts';
import { DryRunPusher, FcmPusher, loadServiceAccount, type Pusher } from './fcm.ts';
import { loadServerKey } from './keys.ts';
import { ClaudeScreener, heuristic, type Screener } from './moderation.ts';
import { ReportService } from './reports.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = '0.0.0.0'; // all interfaces: Railway and other hosts route public traffic to this address
const DATA = resolveDataDir(process.env, process.cwd());
mkdirSync(join(DATA, 'media'), { recursive: true });

for (const w of startupWarnings(process.env)) console.warn(`WARNING: ${w}`);

const db = openDb(join(DATA, 'beacon.db'));
const key = loadServerKey(join(DATA, 'server-key.json'));
const alerts = new AlertService(key);

// AI pre-screening needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Without it every report goes to human moderators.
const screener: Screener = process.env.ANTHROPIC_API_KEY
  ? new ClaudeScreener()
  : { screen: async (i) => heuristic(i, 'AI screening is not configured') };
const reports = new ReportService(db, DATA, screener);

// Push needs a Firebase service-account key (free FCM). Without it pushes are logged only.
const serviceAccount = loadServiceAccount(process.env); // throws a readable error if the key is malformed
const pusher: Pusher = serviceAccount ? new FcmPusher(serviceAccount) : new DryRunPusher();

const app = createApp({
  db,
  key,
  alerts,
  reports,
  pusher,
  modToken: process.env.MOD_TOKEN,
  dataDir: DATA,
  version: readVersion(new URL('../package.json', import.meta.url)),
});

createServer((req, res) => void app.handle(req, res, 40 * 1024 * 1024)).listen(PORT, HOST, () => {
  console.log(`Beacon server listening on http://${HOST}:${PORT} (public URL: your host's domain, e.g. https://<domain>)`);
  console.log(`data directory: ${DATA}`);
  console.log(`server public key (pin this in the app): ${key.publicKeyB64}`);
  console.log(`AI screening: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off (all reports go to moderators)'}`);
  console.log(`push: ${serviceAccount ? 'FCM' : 'dry-run'}`);
});

setInterval(() => void pushNewAlerts({ db, alerts, pusher }).catch((e) => console.error('push loop', e)), 5 * 60_000);
