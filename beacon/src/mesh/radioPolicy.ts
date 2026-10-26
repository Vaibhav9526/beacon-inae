// Pure rules of the BLE radio. The Kotlin module (modules/beacon-mesh) implements the same rules; they are
// mirrored here so they can be unit tested without a phone. Keep both sides in sync.

export const FALLBACK_INITIATE_MS = 25_000;
export const MAX_FRAME = 65_535;
export const RX_IDLE_RESET_MS = 8_000;

/** Wire framing on a link: [len:u16 big-endian][payload]. */
export function frame(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length > MAX_FRAME) throw new RangeError('frame size');
  const out = new Uint8Array(data.length + 2);
  out[0] = data.length >> 8;
  out[1] = data.length & 0xff;
  out.set(data, 2);
  return out;
}

/** Split a framed packet into GATT chunks for an MTU (3 bytes of ATT header, never below 20). */
export function chunksFor(framed: Uint8Array, mtu: number): Uint8Array[] {
  const size = Math.max(20, mtu - 3);
  const out: Uint8Array[] = [];
  for (let o = 0; o < framed.length; o += size) out.push(framed.slice(o, o + size));
  return out;
}

/** Reassembles frames from arbitrary chunk boundaries; a stalled half frame is discarded. */
export class Deframer {
  private buf: number[] = [];
  private need = -1;
  private last = 0;

  push(chunk: Uint8Array, now = 0): Uint8Array[] {
    const out: Uint8Array[] = [];
    if ((this.need >= 0 || this.buf.length > 0) && now - this.last > RX_IDLE_RESET_MS) {
      this.buf = [];
      this.need = -1;
    }
    this.last = now;
    let i = 0;
    while (i < chunk.length) {
      if (this.need < 0) {
        this.buf.push(chunk[i++]);
        if (this.buf.length === 2) {
          this.need = (this.buf[0] << 8) | this.buf[1];
          this.buf = [];
          if (this.need === 0) this.need = -1;
        }
      } else {
        const take = Math.min(this.need - this.buf.length, chunk.length - i);
        for (let k = 0; k < take; k++) this.buf.push(chunk[i + k]);
        i += take;
        if (this.buf.length === this.need) {
          out.push(Uint8Array.from(this.buf));
          this.buf = [];
          this.need = -1;
        }
      }
    }
    return out;
  }
}

/** Reconnect delay after `failures` failed attempts: 2, 4, 8, 16, 32, then 60 seconds. */
export function reconnectDelayMs(failures: number): number {
  return Math.min(2_000 * 2 ** Math.min(failures, 5), 60_000);
}

/**
 * Only one phone of a pair opens the connection: the one with the lower token (advertised in the scan response).
 * A peer without a token (older build) is always connected to. If the lower-token phone never connects to us
 * the higher one steps in after FALLBACK_INITIATE_MS, unless someone is already connected to our server.
 */
export function shouldInitiate(myToken: number, peerToken: number | null, firstSeenMs: number, nowMs: number, hasServerLinks: boolean): boolean {
  if (peerToken == null) return true;
  if (myToken < peerToken) return true;
  return nowMs - firstSeenMs >= FALLBACK_INITIATE_MS && !hasServerLinks;
}

/** ScanCallback error codes: milliseconds to wait before starting the scan again, or null for no retry. */
export function scanRetryMs(code: number): number | null {
  switch (code) {
    case 1: // already started
    case 4: // feature unsupported
      return null;
    case 3:
      return 10_000;
    case 5:
      return 15_000;
    case 2: // registration failed
    case 6: // scanning too frequently
      return 35_000;
    default:
      return 15_000;
  }
}

export function advRetryMs(code: number): number | null {
  return code === 2 || code === 4 ? 10_000 : null;
}

export const SCAN_ERRORS: Record<number, [string, string]> = {
  1: ['Scan already started', 'स्कैन पहले से चालू है'],
  2: ['Bluetooth scan could not register: restart Bluetooth', 'स्कैन पंजीकृत नहीं हुआ: Bluetooth बंद करके चालू करें'],
  3: ['Bluetooth scan internal error', 'स्कैन में आंतरिक त्रुटि'],
  4: ['This phone cannot scan for Bluetooth LE devices', 'यह फ़ोन BLE स्कैन नहीं कर सकता'],
  5: ['Bluetooth chip is out of scan resources: close other Bluetooth apps', 'Bluetooth के संसाधन खत्म: दूसरे Bluetooth ऐप बंद करें'],
  6: ['Scanning started too often: Android is pausing it, wait 30 seconds', 'स्कैन बहुत बार शुरू हुआ: 30 सेकंड रुकें'],
};

export const ADV_ERRORS: Record<number, [string, string]> = {
  1: ['Advertisement too large', 'विज्ञापन डेटा बहुत बड़ा'],
  2: ['Too many Bluetooth advertisers on this phone: close other Bluetooth apps', 'बहुत सारे Bluetooth विज्ञापनकर्ता: दूसरे ऐप बंद करें'],
  3: ['Already advertising', 'पहले से प्रसारण चालू है'],
  4: ['Bluetooth advertising internal error', 'प्रसारण में आंतरिक त्रुटि'],
  5: ['This phone cannot advertise over Bluetooth LE, so others cannot find it (it can still find them)', 'यह फ़ोन BLE प्रसारण नहीं कर सकता, इसलिए दूसरे इसे नहीं ढूँढ सकते'],
};

export type MeshStatus = 'idle' | 'starting' | 'running' | 'no-permission' | 'bluetooth-off' | 'unsupported' | 'error';

export interface RadioView {
  status: MeshStatus;
  /** reason string the UI can show; null when everything is fine */
  error: string | null;
}

const pair = (p: [string, string]) => `${p[0]} · ${p[1]}`;

/**
 * Folds one native onState string into the store view. Fatal problems become status 'error'; problems the
 * native side is retrying only set the reason. Unknown strings are ignored.
 */
export function reduceRadioState(prev: RadioView, s: string): RadioView {
  if (s === 'running' || s === 'bluetooth-on') return { status: 'running', error: prev.status === 'running' ? prev.error : null };
  if (s === 'adv-ok') return prev.error?.startsWith('Bluetooth advertising') || prev.error?.startsWith('Too many') || prev.error?.startsWith('This phone cannot advertise') ? { ...prev, error: null } : prev;
  if (s === 'stopped') return { status: 'idle', error: null };
  if (s === 'bluetooth-off') return { status: 'bluetooth-off', error: 'Bluetooth is off · Bluetooth बंद है' };
  if (s === 'unsupported') return { status: 'unsupported', error: 'No Bluetooth LE on this phone · इस फ़ोन में BLE नहीं है' };
  if (s.startsWith('permission-denied')) {
    const which = s.split(':')[1] ?? '';
    return { status: 'no-permission', error: `Permission needed: ${which} · अनुमति चाहिए` };
  }
  if (s.startsWith('adv-failed:')) {
    const code = Number(s.split(':')[1]);
    const e = pair(ADV_ERRORS[code] ?? [`Advertising failed (${code})`, `प्रसारण विफल (${code})`]);
    return { status: code === 1 || code === 5 ? 'error' : prev.status, error: e };
  }
  if (s.startsWith('scan-failed:')) {
    const code = Number(s.split(':')[1]);
    const e = pair(SCAN_ERRORS[code] ?? [`Scan failed (${code})`, `स्कैन विफल (${code})`]);
    return { status: code === 4 ? 'error' : prev.status, error: e };
  }
  if (s.startsWith('error:')) return { status: prev.status, error: s.slice(6) };
  return prev;
}

/** Honest delivery line under a message you sent. */
export function deliveryText(neighboursAtSend: number): [string, string] {
  if (neighboursAtSend > 0) {
    const n = neighboursAtSend;
    return [`Sent to ${n} phone${n === 1 ? '' : 's'} nearby`, `${n} पास के फ़ोन को भेजा`];
  }
  return [
    'No phones nearby yet: it will be delivered when someone comes in range',
    'अभी पास में कोई फ़ोन नहीं: कोई पास आते ही यह पहुँच जाएगा',
  ];
}

/** Traffic light for the "Mesh status" chip. */
export function healthDot(i: { status: MeshStatus; links: number }): 'red' | 'amber' | 'green' {
  if (i.status !== 'running') return 'red';
  return i.links > 0 ? 'green' : 'amber';
}
