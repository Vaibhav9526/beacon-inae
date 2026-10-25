import radio from '../../modules/beacon-mesh';
import { fromBase64, toBase64 } from './bytes';
import type { Transport } from './transport';

/** Real transport: the Kotlin BLE module. */
export class BleTransport implements Transport {
  private packetCb: ((l: string, d: Uint8Array) => void) | null = null;
  private linkCb: ((l: string, up: boolean) => void) | null = null;
  private live = new Set<string>();
  private subs: { remove(): void }[] = [];

  static get available() {
    return radio != null;
  }

  onPacket(cb: (link: string, data: Uint8Array) => void) {
    this.packetCb = cb;
  }
  onLink(cb: (link: string, up: boolean) => void) {
    this.linkCb = cb;
  }
  send(link: string, data: Uint8Array) {
    radio?.send(link, toBase64(data)).catch(() => {});
  }
  broadcast(data: Uint8Array, exceptLink?: string) {
    radio?.broadcast(toBase64(data), exceptLink ?? null).catch(() => {});
  }
  links() {
    return [...this.live];
  }

  async start() {
    if (!radio) return;
    this.subs.push(
      radio.addListener('onPacket', (e) => this.packetCb?.(e.link, fromBase64(e.data))),
      radio.addListener('onLink', (e) => {
        if (e.up) this.live.add(e.link);
        else this.live.delete(e.link);
        this.linkCb?.(e.link, e.up);
      }),
    );
    await radio.start();
  }

  async stop() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.live.clear();
    await radio?.stop();
  }
}
