import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHECK_INTERVAL_MS,
  RELEASES_URL,
  checkForUpdate,
  compareVersions,
  parseSha256,
  parseShaFromBody,
  pickRelease,
  plainNotes,
  type FetchLike,
  type GithubRelease,
} from '../updates';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const SHA = 'a'.repeat(64);
const url = (name: string) => `https://github.com/Vaibhav9526/beacon-inae/releases/download/v/${name}`;

function apk(version: string, size = 52_428_800) {
  return { name: `beacon-${version}.apk`, browser_download_url: url(`beacon-${version}.apk`), size };
}
function rel(tag: string, o: Partial<GithubRelease> & { apk?: boolean } = {}): GithubRelease {
  const { apk: withApk = true, ...rest } = o;
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    body: 'New things.\n\nmin-android: 8',
    draft: false,
    prerelease: false,
    published_at: '2026-10-20T10:00:00Z',
    assets: withApk ? [apk(version)] : [],
    ...rest,
  };
}

test('compareVersions table', () => {
  const cases: [string, string, number][] = [
    ['1.0.0', '1.0.0', 0],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.1.0', '1.0.9', 1],
    ['2.0.0', '1.9.9', 1],
    ['1.0.9', '1.0.10', -1],
    ['1.0.10', '1.0.9', 1],
    ['1.0.1-beta', '1.0.1', -1],
    ['1.0.1', '1.0.1-beta', 1],
    ['1.0.1-beta.2', '1.0.1-beta.10', -1],
    ['1.0.1-alpha', '1.0.1-beta', -1],
    ['1.0.1-2', '1.0.1-alpha', -1],
    ['v1.2.3', '1.2.3', 0],
    ['v1.2.4', 'v1.2.3', 1],
    ['junk', '1.0.0', 0],
    ['1.0.0', 'junk', 0],
    ['1.0', '1.0.0', 0],
    ['', '', 0],
  ];
  for (const [a, b, want] of cases) assert.equal(compareVersions(a, b), want, `${a} vs ${b}`);
});

test('hub-v tags are ignored', () => {
  const picked = pickRelease([rel('hub-v9.0.0', { assets: [apk('9.0.0')] }), rel('v1.0.1')], '1.0.0');
  assert.equal(picked?.version, '1.0.1');
  assert.equal(pickRelease([rel('hub-v9.0.0', { assets: [apk('9.0.0')] })], '1.0.0'), null);
});

test('drafts are skipped and the newest wins', () => {
  const picked = pickRelease([rel('v1.0.3', { draft: true }), rel('v1.0.2'), rel('v1.0.1')], '1.0.0');
  assert.equal(picked?.version, '1.0.2');
});

test('pre-releases are hidden unless beta is on', () => {
  const list = [rel('v1.1.0-beta', { prerelease: true }), rel('v1.0.5')];
  assert.equal(pickRelease(list, '1.0.0')?.version, '1.0.5');
  assert.equal(pickRelease(list, '1.0.0', { includeBeta: true })?.version, '1.1.0-beta');
  // a -beta tag without the GitHub prerelease flag is still a test version
  assert.equal(pickRelease([rel('v1.1.0-beta')], '1.0.0')?.version ?? null, null);
  assert.equal(pickRelease([rel('v1.1.0-beta')], '1.0.0', { includeBeta: true })?.version, '1.1.0-beta');
});

test('only newer than current, and null when nothing is newer', () => {
  assert.equal(pickRelease([rel('v1.0.0'), rel('v0.9.0')], '1.0.0'), null);
  assert.equal(pickRelease([rel('v1.0.1')], '1.0.1'), null);
});

test('asset selection needs a beacon apk', () => {
  assert.equal(pickRelease([rel('v1.0.1', { apk: false })], '1.0.0'), null);
  const onlyOther = rel('v1.0.1', { assets: [{ name: 'notes.zip', browser_download_url: url('notes.zip'), size: 1 }] });
  assert.equal(pickRelease([onlyOther], '1.0.0'), null);
  const untrusted = rel('v1.0.1', { assets: [{ name: 'beacon-1.0.1.apk', browser_download_url: 'https://evil.example/x.apk', size: 1 }] });
  assert.equal(pickRelease([untrusted], '1.0.0'), null);
});

test('picked release has url, size, date and notes', () => {
  const p = pickRelease([rel('v1.0.1')], '1.0.0');
  assert.ok(p);
  assert.equal(p.url, url('beacon-1.0.1.apk'));
  assert.equal(p.sizeBytes, 52_428_800);
  assert.equal(p.publishedAt, '2026-10-20T10:00:00Z');
  assert.equal(p.notes, 'New things.');
  assert.equal(p.sha256, null);
  assert.equal(p.shaUrl, null);
});

test('sha parsed from body and from .sha256 file text', () => {
  assert.equal(parseShaFromBody(`intro\nsha256: ${SHA.toUpperCase()}\n`), SHA);
  assert.equal(parseShaFromBody('sha256: abc'), null);
  assert.equal(parseShaFromBody(null), null);
  assert.equal(parseSha256(`${SHA}  beacon-1.0.1.apk\n`), SHA);
  assert.equal(parseSha256('nothing here'), null);
  const p = pickRelease([rel('v1.0.1', { body: `sha256: ${SHA}` })], '1.0.0');
  assert.equal(p?.sha256, SHA);
  const withFile = rel('v1.0.1', { body: '', assets: [apk('1.0.1'), { name: 'beacon-1.0.1.apk.sha256', browser_download_url: url('beacon-1.0.1.apk.sha256'), size: 90 }] });
  const q = pickRelease([withFile], '1.0.0');
  assert.equal(q?.sha256, null);
  assert.equal(q?.shaUrl, url('beacon-1.0.1.apk.sha256'));
});

test('plain notes strip markdown and cap at 800 chars', () => {
  const md = '## Title\n**bold** and `code` [link](https://x.y)\n- one\n- two\nmin-android: 8\nsha256: ' + SHA;
  assert.equal(plainNotes(md), 'Title\nbold and code link\n• one\n• two');
  const long = plainNotes('a'.repeat(2000));
  assert.equal(long.length, 801);
  assert.ok(long.endsWith('…'));
  assert.equal(plainNotes(null), '');
});

const json = (status: number, body: unknown, ok = status >= 200 && status < 300) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('checkForUpdate reports an available update with headers and url', async () => {
  const seen: { url: string; headers?: Record<string, string> }[] = [];
  const fetchFn: FetchLike = async (u, init) => {
    seen.push({ url: u, headers: init?.headers });
    return json(200, [rel('hub-v2.0.0', { assets: [apk('2.0.0')] }), rel('v1.0.1')]);
  };
  const r = await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', lastCheckedAt: null });
  assert.equal(seen[0].url, RELEASES_URL);
  assert.equal(seen[0].headers?.Accept, 'application/vnd.github+json');
  assert.equal(seen[0].headers?.['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(r.status, 'available');
  if (r.status === 'available') {
    assert.equal(r.latest.version, '1.0.1');
    assert.equal(r.checkedAt, NOW);
    assert.equal('shaUrl' in r.latest, false);
  }
});

test('checkForUpdate fetches the sha file when the body has none', async () => {
  const shaUrl = url('beacon-1.0.1.apk.sha256');
  const fetchFn: FetchLike = async (u) => {
    if (u === shaUrl) return { ok: true, status: 200, json: async () => null, text: async () => `${SHA}  beacon-1.0.1.apk` };
    return json(200, [rel('v1.0.1', { body: '', assets: [apk('1.0.1'), { name: 'beacon-1.0.1.apk.sha256', browser_download_url: shaUrl, size: 90 }] })]);
  };
  const r = await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0' });
  assert.ok(r.status === 'available' && r.latest.sha256 === SHA);
});

test('up to date when nothing newer', async () => {
  const r = await checkForUpdate({ fetchFn: async () => json(200, [rel('v1.0.0')]), now: NOW, current: '1.0.0' });
  assert.deepEqual(r, { status: 'current', checkedAt: NOW });
});

test('403 and 429 map to rate-limited', async () => {
  for (const code of [403, 429]) {
    const r = await checkForUpdate({ fetchFn: async () => json(code, {}), now: NOW, current: '1.0.0' });
    assert.deepEqual(r, { status: 'rate-limited', checkedAt: NOW });
  }
});

test('other HTTP errors and bad bodies are error, not offline', async () => {
  assert.deepEqual(await checkForUpdate({ fetchFn: async () => json(500, {}), now: NOW, current: '1.0.0' }), { status: 'error' });
  assert.deepEqual(await checkForUpdate({ fetchFn: async () => json(200, { message: 'x' }), now: NOW, current: '1.0.0' }), { status: 'error' });
  const bad = { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }, text: async () => '' };
  assert.deepEqual(await checkForUpdate({ fetchFn: async () => bad, now: NOW, current: '1.0.0' }), { status: 'error' });
});

test('network failure maps to offline and does not stamp the check time', async () => {
  const fetchFn: FetchLike = async () => {
    throw new TypeError('Network request failed');
  };
  assert.deepEqual(await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0' }), { status: 'offline' });
});

test('a hung request times out as offline', async () => {
  const fetchFn: FetchLike = (_u, init) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    });
  const r = await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', timeoutMs: 20 });
  assert.deepEqual(r, { status: 'offline' });
});

test('interval throttling: 6 hours unless forced', async () => {
  let calls = 0;
  const fetchFn: FetchLike = async () => {
    calls++;
    return json(200, [rel('v1.0.0')]);
  };
  const last = NOW - 60_000;
  assert.deepEqual(await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', lastCheckedAt: last }), { status: 'throttled' });
  assert.equal(calls, 0);
  assert.equal((await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', lastCheckedAt: last, force: true })).status, 'current');
  assert.equal(calls, 1);
  const old = NOW - CHECK_INTERVAL_MS;
  assert.equal((await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', lastCheckedAt: old })).status, 'current');
  assert.equal(calls, 2);
  // a clock that went backwards does not block checks forever
  assert.equal((await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0', lastCheckedAt: NOW + 1_000_000 })).status, 'current');
});

test('checkForUpdate never throws, even with a broken fetch', async () => {
  const fetchFn = (() => {
    throw new Error('boom');
  }) as unknown as FetchLike;
  assert.equal((await checkForUpdate({ fetchFn, now: NOW, current: '1.0.0' })).status, 'offline');
});
