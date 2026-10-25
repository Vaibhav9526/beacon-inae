import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY_PREFIX, type Storage, listWipeTargets, wipeEverything } from '../wipe';

const LABELS = [
  'Your name and settings',
  'Chats and mesh history',
  'Identity keys',
  'Saved reports and outbox',
  'ElevenLabs key',
  'Downloaded models',
  'Hub pairing',
];

test('lists every category with a human label, in order', () => {
  assert.deepEqual(
    listWipeTargets().map((t) => t.label),
    LABELS,
  );
});

test('only the model downloads are keepable, and every target has a detail line', () => {
  const targets = listWipeTargets();
  assert.deepEqual(
    targets.filter((t) => t.keepable).map((t) => t.id),
    ['models'],
  );
  for (const t of targets) assert.ok(t.detail.length > 0, `${t.id} needs a detail`);
});

test('every AsyncStorage key listed is under the beacon. prefix', () => {
  for (const t of listWipeTargets()) for (const k of t.asyncKeys) assert.ok(k.startsWith(KEY_PREFIX), k);
});

interface FakeOpts {
  asyncKeys?: string[];
  secure?: string[];
  failRemove?: string[];
  failList?: boolean;
  failDelete?: string[];
  failMesh?: boolean;
}

function fakeStorage(o: FakeOpts = {}) {
  const async = new Set(o.asyncKeys ?? []);
  const secure = new Set(o.secure ?? []);
  const dirs = new Set<string>(['/doc/reports/', '/doc/vlm/', '/doc/maps/', '/cache/tts/']);
  const calls: string[] = [];
  const storage: Storage = {
    documentDir: '/doc/',
    cacheDir: '/cache/',
    async asyncKeys() {
      calls.push('asyncKeys');
      if (o.failList) throw new Error('nope');
      return [...async];
    },
    async asyncRemove(k) {
      calls.push(`async:${k}`);
      if (o.failRemove?.includes(k)) throw new Error('disk');
      async.delete(k);
    },
    async secureDelete(k) {
      calls.push(`secure:${k}`);
      secure.delete(k);
    },
    async deleteDir(uri) {
      calls.push(`dir:${uri}`);
      if (o.failDelete?.includes(uri)) throw new Error('busy');
      dirs.delete(uri);
    },
    async stopMesh() {
      calls.push('stopMesh');
      if (o.failMesh) throw new Error('mesh');
    },
    async resetStores() {
      calls.push('resetStores');
    },
  };
  return { storage, async, secure, dirs, calls };
}

test('wipe removes beacon keys, secure keys and folders, and leaves other keys alone', async () => {
  const f = fakeStorage({
    asyncKeys: ['beacon.settings.v1', 'beacon.hub.v1', 'beacon.mesh.snapshot.v1', 'someone.else'],
    secure: ['beacon.identity.v1', 'beacon.elevenlabs.key'],
  });
  const r = await wipeEverything({ storage: f.storage });
  assert.deepEqual(r.failed, []);
  assert.deepEqual([...f.async], ['someone.else']);
  assert.equal(f.secure.size, 0);
  assert.equal(f.dirs.size, 0);
  assert.ok(r.cleared >= 3 + 2 + 3, `cleared was ${r.cleared}`);
});

test('mesh stops and stores reset before anything is removed', async () => {
  const f = fakeStorage({ asyncKeys: ['beacon.settings.v1'] });
  await wipeEverything({ storage: f.storage });
  assert.equal(f.calls[0], 'stopMesh');
  assert.equal(f.calls[1], 'resetStores');
  assert.ok(f.calls.indexOf('async:beacon.settings.v1') > 1);
});

test('keepModels leaves the model and map folders in place', async () => {
  const f = fakeStorage({ asyncKeys: [] });
  await wipeEverything({ storage: f.storage, keepModels: true });
  assert.ok(f.dirs.has('/doc/vlm/'));
  assert.ok(f.dirs.has('/doc/maps/'));
  assert.ok(!f.dirs.has('/doc/reports/'));
  assert.ok(!f.dirs.has('/cache/tts/'));
});

test('a failing step is reported and the rest still runs', async () => {
  const f = fakeStorage({
    asyncKeys: ['beacon.settings.v1', 'beacon.hub.v1'],
    failRemove: ['beacon.hub.v1'],
    failDelete: ['/doc/reports/'],
    failMesh: true,
  });
  const r = await wipeEverything({ storage: f.storage });
  assert.ok(r.failed.includes('mesh'));
  assert.ok(r.failed.includes('beacon.hub.v1'));
  assert.ok(r.failed.includes('Saved reports and outbox'));
  assert.ok(!f.async.has('beacon.settings.v1'));
  assert.ok(f.dirs.has('/doc/reports/') === true);
  assert.ok(!f.dirs.has('/doc/vlm/'));
});

test('a failing key listing still wipes the keys named in the targets', async () => {
  const f = fakeStorage({ asyncKeys: ['beacon.hub.v1', 'beacon.settings.v1'], failList: true });
  const r = await wipeEverything({ storage: f.storage });
  assert.deepEqual(r.failed, ['key list']);
  assert.equal(f.async.size, 0);
});

test('never throws, even when the storage cannot be built', async () => {
  const r = await wipeEverything({
    storage: {
      get documentDir(): string {
        throw new Error('boom');
      },
    } as unknown as Storage,
  });
  assert.equal(typeof r.cleared, 'number');
  assert.ok(Array.isArray(r.failed));
});
