import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Deframer,
  FALLBACK_INITIATE_MS,
  advRetryMs,
  chunksFor,
  deliveryText,
  frame,
  healthDot,
  reconnectDelayMs,
  reduceRadioState,
  scanRetryMs,
  shouldInitiate,
  type RadioView,
} from '../radioPolicy';
import { buildChecklist, overall, signalWord } from '../../components/meshTestState';
import type { RadioDiagnostics } from '../../../modules/beacon-mesh';

test('framing survives any chunk boundary, including a split length prefix', () => {
  const a = Uint8Array.from({ length: 700 }, (_, i) => i % 251);
  const b = Uint8Array.from([9, 8, 7]);
  const wire = new Uint8Array([...frame(a), ...frame(b)]);
  for (const mtu of [23, 24, 50, 185, 517]) {
    const d = new Deframer();
    const out: Uint8Array[] = [];
    // re-chunk the whole stream by mtu, which splits frames and prefixes at arbitrary points
    for (let o = 0; o < wire.length; o += Math.max(20, mtu - 3)) out.push(...d.push(wire.slice(o, o + Math.max(20, mtu - 3))));
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], a);
    assert.deepEqual(out[1], b);
  }
  assert.equal(chunksFor(frame(a), 23).length, Math.ceil(702 / 20));
  assert.throws(() => frame(new Uint8Array(0)));
  assert.throws(() => frame(new Uint8Array(65_536)));
});

test('a stalled half frame is dropped instead of gluing onto the next frame', () => {
  const d = new Deframer();
  const first = frame(Uint8Array.from([1, 2, 3, 4, 5]));
  assert.equal(d.push(first.slice(0, 4), 1000).length, 0);
  const next = frame(Uint8Array.from([42]));
  const out = d.push(next, 1000 + 9_000);
  assert.deepEqual(out, [Uint8Array.from([42])]);
});

test('reconnect backoff doubles and caps at 60 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
});

test('exactly one phone of a pair initiates', () => {
  const lo = 5;
  const hi = 900;
  assert.equal(shouldInitiate(lo, hi, 0, 0, false), true);
  assert.equal(shouldInitiate(hi, lo, 0, 0, false), false);
  // equal tokens: nobody wins at first, the fallback breaks the tie
  assert.equal(shouldInitiate(7, 7, 0, 0, false), false);
  // the higher phone steps in only after the fallback delay and only with no server links
  assert.equal(shouldInitiate(hi, lo, 0, FALLBACK_INITIATE_MS, false), true);
  assert.equal(shouldInitiate(hi, lo, 0, FALLBACK_INITIATE_MS, true), false);
  // a peer without a token (older build) is always connected to
  assert.equal(shouldInitiate(hi, null, 0, 0, false), true);
});

test('scan and advertise failure codes map to retry delays', () => {
  assert.equal(scanRetryMs(1), null);
  assert.equal(scanRetryMs(4), null);
  assert.equal(scanRetryMs(6), 35_000);
  assert.equal(scanRetryMs(2), 35_000);
  assert.equal(scanRetryMs(99), 15_000);
  assert.equal(advRetryMs(4), 10_000);
  assert.equal(advRetryMs(1), null);
  assert.equal(advRetryMs(5), null);
});

test('radio state reducer: bluetooth off, permissions, retryable and fatal failures', () => {
  let v: RadioView = { status: 'starting', error: null };
  v = reduceRadioState(v, 'running');
  assert.equal(v.status, 'running');
  v = reduceRadioState(v, 'scan-failed:6');
  assert.equal(v.status, 'running'); // native retries, only the reason shows
  assert.match(v.error!, /too often/);
  v = reduceRadioState(v, 'adv-failed:5');
  assert.equal(v.status, 'error');
  assert.match(v.error!, /cannot advertise/);
  v = reduceRadioState(v, 'bluetooth-off');
  assert.equal(v.status, 'bluetooth-off');
  v = reduceRadioState(v, 'bluetooth-on');
  assert.equal(v.status, 'running');
  assert.equal(v.error, null);
  v = reduceRadioState(v, 'permission-denied:BLUETOOTH_SCAN');
  assert.equal(v.status, 'no-permission');
  assert.match(v.error!, /BLUETOOTH_SCAN/);
  v = reduceRadioState({ status: 'running', error: null }, 'error:foreground service: SecurityException');
  assert.equal(v.status, 'running');
  assert.match(v.error!, /SecurityException/);
  assert.deepEqual(reduceRadioState(v, 'something-new'), v);
  assert.equal(reduceRadioState(v, 'stopped').status, 'idle');
});

test('delivery text is honest about nobody being in range', () => {
  assert.match(deliveryText(0)[0], /No phones nearby yet/);
  assert.match(deliveryText(0)[0], /delivered when someone comes in range/);
  assert.equal(deliveryText(1)[0], 'Sent to 1 phone nearby');
  assert.equal(deliveryText(3)[0], 'Sent to 3 phones nearby');
});

test('status chip colour', () => {
  assert.equal(healthDot({ status: 'bluetooth-off', links: 2 }), 'red');
  assert.equal(healthDot({ status: 'running', links: 0 }), 'amber');
  assert.equal(healthDot({ status: 'running', links: 1 }), 'green');
});

const good: RadioDiagnostics = {
  apiLevel: 34,
  manufacturer: 'x',
  model: 'y',
  bleSupported: true,
  bluetoothOn: true,
  advertiserAvailable: true,
  permissions: { scan: true, advertise: true, connect: true, location: true, notifications: true },
  locationRequired: false,
  locationServicesOn: true,
  wanted: true,
  running: true,
  serviceRunning: true,
  serviceError: null,
  serverReady: true,
  advertising: true,
  scanning: true,
  scanFast: false,
  scanStartsLast30s: 1,
  token: 'abc',
  links: [],
  nearby: [],
  txFrames: 0,
  txBytes: 0,
  rxFrames: 0,
  rxBytes: 0,
  lastError: null,
};
const view = { status: 'running' as const, radioError: null, radioAvailable: true };

test('self-test checklist reflects each failure', () => {
  assert.equal(overall(buildChecklist(good, view)), 'warn'); // all fine but no phone linked yet
  const linked = { ...good, links: [{ id: 'a', role: 'client' as const, ready: true, mtu: 247, rssi: -60, queued: 0 }] };
  assert.equal(overall(buildChecklist(linked, view)), 'ok');
  const btOff = buildChecklist({ ...good, bluetoothOn: false }, view);
  assert.equal(btOff.find((r) => r.id === 'bt')!.level, 'bad');
  assert.equal(btOff.find((r) => r.id === 'bt')!.fix, 'bluetooth');
  const noPerm = buildChecklist({ ...good, permissions: { ...good.permissions, scan: false } }, view);
  assert.equal(noPerm.find((r) => r.id === 'nearby')!.fix, 'nearby');
  const old = buildChecklist({ ...good, apiLevel: 30, locationRequired: true, locationServicesOn: false }, view);
  assert.equal(old.find((r) => r.id === 'locsvc')!.level, 'bad');
  assert.equal(buildChecklist(null, { ...view, radioAvailable: false })[0].level, 'bad');
  assert.equal(signalWord(-55), 'strong');
  assert.equal(signalWord(-95), 'very weak');
  assert.equal(signalWord(null), 'unknown');
});
