import { HubApp } from './app.ts';
import { startHttp } from './httpServer.ts';

/** `npm start`: the hub engine plus its local web UI. The Electron shell loads the same URL. */
export async function main() {
  const app = new HubApp();
  // if the usual port is taken (another hub already running) take any free one
  const { port, token } = await startHttp(app, { port: Number(process.env.PORT ?? 4747) }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    return startHttp(app, { port: 0 });
  });
  app.hub.start();
  void app.startRelay();
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  console.log(`Beacon Hub is running.\nOpen: ${url}`);
  return { app, url };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) void main();
