import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLE_COMMANDS, interpret, VOICE_TEXT } from '../navigate';
import { type NeedleEngine } from '../router';

const OPTS = { log: false } as const;

test('unrecognised speech is answered with what was heard and the three examples', () => {
  const en = VOICE_TEXT.heardUnknown('make me a sandwich', 'en');
  assert.match(en, /^I heard: "make me a sandwich"\./);
  for (const c of EXAMPLE_COMMANDS) assert.ok(en.includes(`"${c}"`), `card names "${c}"`);
  const hi = VOICE_TEXT.heardUnknown('x', 'hi');
  assert.ok(hi.includes('"x"'));
});

test('an unknown sentence falls through to the chip (so the dock always has a reply to show)', async () => {
  const d = await interpret('zzqq blorp wibble', null, OPTS);
  assert.equal(d.kind, 'chip');
});

test('a model that never answers is cut off, and the keyword router still answers in time', async () => {
  const hang: NeedleEngine = { complete: () => new Promise(() => {}) };
  const started = Date.now();
  const d = await interpret('open weather', hang, { ...OPTS, timeoutMs: 50 });
  assert.equal(d.kind, 'run');
  assert.equal(d.kind === 'run' ? d.route : undefined, '/weather');
  assert.ok(Date.now() - started < 1000, 'interpret did not wait for the model');
});

test('a model that throws falls back to the keywords instead of failing the reply', async () => {
  const broken: NeedleEngine = {
    complete: () => {
      throw new Error('model gone');
    },
  };
  const d = await interpret('call 112', broken, OPTS);
  assert.equal(d.kind, 'run');
  assert.equal(d.kind === 'run' ? d.action?.type : undefined, 'call112');
});

test('"hold to talk" and "cancelled" copy exists in both languages', () => {
  assert.equal(VOICE_TEXT.holdToTalk('en'), 'Hold to talk');
  assert.ok(VOICE_TEXT.holdToTalk('hi').length > 0);
  assert.equal(VOICE_TEXT.cancelled('en'), 'Cancelled');
  assert.ok(VOICE_TEXT.cancelled('hi').length > 0);
});
