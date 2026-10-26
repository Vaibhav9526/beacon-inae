import radio, { type RadioDiagnostics } from '../../modules/beacon-mesh';
import { fromBase64, toBase64 } from './bytes';
import type { Transport } from './transport';

export interface BleCounters {
  txPackets: number;
  txBytes: number;
  rxPackets: number;
  rxBytes: number;
  linksUp: number;
  linksDown: number;
}

/** Real transport: the Kotlin BLE module. */
export class BleTransport implements Transport {
  private packetCb: ((l: string, d: Uint8Array) => void) | null = null;
  private linkCb: ((l: string, up: boolean) => void) | null = null;
  private stateCbs = new Set<(state: string) => void>();
  private watchers = new Set<() => void>();
  private live = new Set<string>();
  private subs: { remove(): void }[] = [];
  readonly counters: BleCounters = { txPackets: 0, txBytes: 0, rxPackets: 0, rxBytes: 0, linksUp: 0, linksDown: 0 };
  /** last error seen on the JS side of the bridge (native errors arrive as 'error:' states) */
  lastError: string | null = null;

  static get available() {
    return radio != null;
  }

  onPacket(cb: (link: string, data: Uint8Array) => void) {
    this.packetCb = cb;
  }
  onLink(cb: (link: string, up: boolean) => void) {
    this.linkCb = cb;
  }
  /** native radio state strings: running, bluetooth-off, adv-failed:3, scan-failed:6, error:..., */
  onState(cb: (state: string) => void) {
    this.stateCbs.add(cb);
    return () => void this.stateCbs.delete(cb);
  }
  /** called when the link set changes: lets the store refresh its neighbour count at once */
  watch(cb: () => void) {
    this.watchers.add(cb);
    return () => void this.watchers.delete(cb);
  }

  private bridgeError(what: string, e: unknown) {
    this.lastError = `${what}: ${e instanceof Error ? e.message : String(e)}`;
    for (const cb of this.stateCbs) cb(`error:${this.lastError}`);
  }

  send(link: string, data: Uint8Array) {
    this.counters.txPackets++;
    this.counters.txBytes += data.length;
    radio?.send(link, toBase64(data)).catch((e) => this.bridgeError('send', e));
  }
  broadcast(data: Uint8Array, exceptLink?: string) {
    const targets = this.live.size - (exceptLink && this.live.has(exceptLink) ? 1 : 0);
    if (targets > 0) {
      this.counters.txPackets += targets;
      this.counters.txBytes += data.length * targets;
    }
    radio?.broadcast(toBase64(data), exceptLink ?? null).catch((e) => this.bridgeError('broadcast', e));
  }
  links() {
    return [...this.live];
  }

  /** Native view of the radio for the self-test screen; null without a native module. */
  async diagnostics(): Promise<RadioDiagnostics | null> {
    try {
      return radio ? await radio.getDiagnostics() : null;
    } catch (e) {
      this.bridgeError('diagnostics', e);
      return null;
    }
  }

  async start() {
    if (!radio) return;
    this.subs.forEach((s) => s.remove());
    this.subs = [
      radio.addListener('onPacket', (e) => {
        this.counters.rxPackets++;
        this.counters.rxBytes += e.data.length * 0.75;
        try {
          this.packetCb?.(e.link, fromBase64(e.data));
        } catch (err) {
          this.bridgeError('packet', err);
        }
      }),
      radio.addListener('onLink', (e) => {
        if (e.up) {
          this.live.add(e.link);
          this.counters.linksUp++;
        } else {
          this.live.delete(e.link);
          this.counters.linksDown++;
        }
        this.linkCb?.(e.link, e.up);
        for (const w of this.watchers) w();
      }),
      radio.addListener('onState', (e) => {
        if (e.state === 'bluetooth-off' || e.state === 'stopped') this.live.clear();
        for (const cb of this.stateCbs) cb(e.state);
        for (const w of this.watchers) w();
      }),
    ];
    try {
      await radio.start();
    } catch (e) {
      this.bridgeError('start', e);
      throw e;
    }
  }

  async stop() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.live.clear();
    try {
      await radio?.stop();
    } catch (e) {
      this.bridgeError('stop', e);
    }
  }
}
