import { HubApp } from './app.ts';
import { BeaconLink } from './beaconLink.ts';
import { startHttp } from './httpServer.ts';

/** `npm start`: the hub engine plus its local web UI. The Electron shell loads the same URL. */
export async function main() {
  const app = new HubApp();
  const link = new BeaconLink(app.dir, app.relayUrl);
  app.addSender(link);
  const { port, token } = await startHttp(app, { port: Number(process.env.PORT ?? 4747), pairing: () => link.pairingQr() });
  app.hub.start();
  const refreshPhones = () =>
    void link
      .phones()
      .then((p) => (app.phonesPaired = p.length))
      .catch(() => {}); // server not reachable: keep the last count
  refreshPhones();
  setInterval(refreshPhones, 30_000).unref();
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  console.log(`Beacon Hub is running.\nOpen: ${url}`);
  return { app, url };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) void main();
