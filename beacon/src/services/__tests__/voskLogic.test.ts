import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGrammar, cleanVoskText, DL_INITIAL, dlReduce, onlyUnknown, pickEngine, shouldAutoDownload, VOSK_MODELS, type DlEvent, type DlState } from '../voskLogic';

const run = (events: DlEvent[], from: DlState = DL_INITIAL) => events.reduce(dlReduce, from);

test('engine order: Vosk when installed, else Google, never both', () => {
  const base = { enabled: true, nativeVosk: true, installed: true, googleAvailable: true };
  assert.equal(pickEngine(base), 'vosk');
  assert.equal(pickEngine({ ...base, installed: false }), 'google');
  assert.equal(pickEngine({ ...base, enabled: false }), 'google');
  assert.equal(pickEngine({ ...base, nativeVosk: false }), 'google');
  assert.equal(pickEngine({ ...base, installed: false, googleAvailable: false }), 'none');
  assert.equal(pickEngine({ ...base, googleAvailable: false }), 'vosk');
});

test('grammar: screens, emergency phrases, [unk], no duplicates', () => {
  const en = buildGrammar('en');
  for (const p of ['weather', 'open weather', 'show first aid', 'i am safe', 'call one one two', '[unk]']) assert.ok(en.includes(p), p);
  assert.equal(new Set(en).size, en.length);
  assert.ok(en.every((p) => p.trim() === p && p.length > 0));
  assert.ok(en.every((p) => /^[a-z0-9 [\]]+$/.test(p)), 'English grammar is Latin only');
  assert.ok(en.length < 3000);
  const hi = buildGrammar('hi');
  assert.ok(hi.includes('मौसम') && hi.includes('मौसम खोलो'.split(' ').reverse().join(' ')) && hi.includes('मैं सुरक्षित हूँ') && hi.includes('[unk]'));
  assert.ok(hi.filter((p) => p !== '[unk]').every((p) => /^[ऀ-ॿ ]+$/.test(p)), 'Hindi grammar is Devanagari only');
});

test('[unk] handling', () => {
  assert.equal(cleanVoskText('open [unk] weather'), 'open weather');
  assert.equal(cleanVoskText('[unk]'), '');
  assert.equal(onlyUnknown('[unk] [unk]'), true);
  assert.equal(onlyUnknown('open map'), false);
  assert.equal(onlyUnknown(''), false);
});

test('download state machine', () => {
  assert.equal(run([{ t: 'checked', installed: true }]).status, 'ready');
  assert.equal(run([{ t: 'checked', installed: false }]).status, 'missing');
  const mid = run([{ t: 'start' }, { t: 'progress', pct: 40 }, { t: 'progress', pct: 20 }]);
  assert.deepEqual(mid, { status: 'downloading', pct: 40, error: null });
  assert.equal(run([{ t: 'progress', pct: 50 }]).pct, 0, 'progress is ignored when not downloading');
  assert.equal(dlReduce(mid, { t: 'checked', installed: false }), mid, 'a check never interrupts a download');
  assert.equal(dlReduce(mid, { t: 'start' }), mid);
  assert.equal(run([{ t: 'start' }, { t: 'progress', pct: 250 }]).pct, 100);
  assert.equal(run([{ t: 'start' }, { t: 'done' }]).status, 'ready');
  assert.deepEqual(run([{ t: 'start' }, { t: 'fail', error: 'no network' }]), { status: 'error', pct: 0, error: 'no network' });
  assert.equal(run([{ t: 'start' }, { t: 'fail', error: 'x' }, { t: 'start' }]).status, 'downloading', 'retry after an error');
  assert.equal(run([{ t: 'start' }, { t: 'cancelled' }]).status, 'missing');
  assert.equal(run([{ t: 'checked', installed: true }, { t: 'removed' }]).status, 'missing');
});

test('auto download happens once, online, when the model is missing', () => {
  const ok = { enabled: true, alreadyTried: false, status: 'missing' as const, nativeVosk: true, online: true };
  assert.equal(shouldAutoDownload(ok), true);
  assert.equal(shouldAutoDownload({ ...ok, status: 'unknown' }), true);
  for (const patch of [{ enabled: false }, { alreadyTried: true }, { status: 'ready' as const }, { status: 'downloading' as const }, { nativeVosk: false }, { online: false }]) {
    assert.equal(shouldAutoDownload({ ...ok, ...patch }), false, JSON.stringify(patch));
  }
});

test('model table', () => {
  for (const m of Object.values(VOSK_MODELS)) {
    assert.ok(m.url.startsWith('https://') && m.url.endsWith(`${m.name}.zip`));
    assert.ok(Math.abs(m.bytes / 1048576 - m.mb) < 1);
  }
});
