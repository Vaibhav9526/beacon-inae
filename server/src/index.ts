import { createServer } from 'node:http';
import { join } from 'node:path';
import { AlertService } from './alerts.ts';
import { createApp, pushNewAlerts } from './app.ts';
import { openDb } from './db.ts';
import { DryRunPusher, FcmPusher, type Pusher } from './fcm.ts';
import { loadServerKey } from './keys.ts';
import { ClaudeScreener, heuristic, type Screener } from './moderation.ts';
import { ReportService } from './reports.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.BEACON_DATA ?? join(process.cwd(), 'data');

const db = openDb(join(DATA, 'beacon.db'));
const key = loadServerKey(join(DATA, 'server-key.json'));
const alerts = new AlertService(key);

// AI pre-screening needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Without it every report goes to human moderators.
const screener: Screener = process.env.ANTHROPIC_API_KEY
  ? new ClaudeScreener()
  : { screen: async (i) => heuristic(i, 'AI screening is not configured') };
const reports = new ReportService(db, DATA, screener);

// Push needs a Firebase service-account key (free FCM). Without it pushes are logged only.
const pusher: Pusher = process.env.FIREBASE_SERVICE_ACCOUNT ? new FcmPusher(process.env.FIREBASE_SERVICE_ACCOUNT) : new DryRunPusher();

const app = createApp({ db, key, alerts, reports, pusher, modToken: process.env.MOD_TOKEN, dataDir: DATA });

createServer((req, res) => void app.handle(req, res, 40 * 1024 * 1024)).listen(PORT, () => {
  console.log(`Beacon server on :${PORT}`);
  console.log(`server public key (pin this in the app): ${key.publicKeyB64}`);
  console.log(`AI screening: ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off (all reports go to moderators)'}`);
  console.log(`push: ${process.env.FIREBASE_SERVICE_ACCOUNT ? 'FCM' : 'dry-run'}`);
  if (!process.env.MOD_TOKEN) console.log('MOD_TOKEN not set: moderator endpoints are disabled');
});

setInterval(() => void pushNewAlerts({ db, alerts, pusher }).catch((e) => console.error('push loop', e)), 5 * 60_000);
