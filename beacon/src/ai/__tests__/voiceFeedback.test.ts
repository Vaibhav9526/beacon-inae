import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXAMPLE_COMMANDS, interpret, parseNavigation, VOICE_TEXT } from '../navigate';

const OPTS = { log: false } as const;

test('every example command is understood without the model', async () => {
  for (const c of EXAMPLE_COMMANDS) {
    const d = await interpret(c, null, OPTS);
    assert.notEqual(d.kind, 'chip', `"${c}" must not fall through to "did not understand"`);
  }
});

test('"open weather" opens the weather screen', async () => {
  const d = await interpret('open weather', null, OPTS);
  assert.equal(d.kind, 'run');
  assert.equal(d.kind === 'run' ? d.route : undefined, '/weather');
});

test('"first aid for burns" opens the burns guide, with and without the prefix', () => {
  assert.equal(parseNavigation('first aid for burns')?.route, '/guide/burns');
  assert.equal(parseNavigation('first aid on snake bite')?.route, '/guide/snake-bite');
  assert.equal(parseNavigation('burns')?.route, '/guide/burns');
});

test('"call 112" and "I am safe" are actions the user can trigger by voice', async () => {
  const call = await interpret('call 112', null, OPTS);
  assert.equal(call.kind, 'run');
  assert.equal(call.kind === 'run' ? call.action?.type : undefined, 'call112');
  const safe = await interpret('I am safe', null, OPTS);
  assert.equal(safe.kind, 'run');
  assert.equal(safe.kind === 'run' ? safe.action?.type : undefined, 'safe');
});

test('nothing heard or gibberish gives the "did not understand" path, never a silent result', async () => {
  for (const t of ['', '   ', 'zzqx blorp vanta']) {
    const d = await interpret(t, null, OPTS);
    assert.equal(d.kind, 'chip', `"${t}" should be the not-understood path`);
  }
});

test('the not-understood message names all three example commands, in English and Hindi', () => {
  for (const l of ['en', 'hi'] as const) {
    const msg = VOICE_TEXT.unknown(l);
    assert.ok(msg.length > 0);
    for (const c of EXAMPLE_COMMANDS) assert.ok(msg.includes(c), `${l} message lacks "${c}"`);
  }
  assert.equal(EXAMPLE_COMMANDS.length, 3);
});

test('every voice feedback line is non-empty in both languages', () => {
  for (const l of ['en', 'hi'] as const) {
    for (const [key, fn] of Object.entries(VOICE_TEXT)) {
      const v = typeof fn === 'function' ? (fn as (lang: 'en' | 'hi', t?: string) => string)(l, 'x') : String(fn);
      assert.ok(v && v.trim().length > 0, `VOICE_TEXT.${key} is empty for ${l}`);
    }
  }
});

test('the English mic messages match the requested wording', () => {
  assert.equal(VOICE_TEXT.notHeard('en'), 'I did not catch that, try again');
  assert.match(VOICE_TEXT.micOff('en'), /Microphone is off/);
  assert.match(VOICE_TEXT.noRecogniser('en'), /not available on this phone/);
});
