import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { detectEmergency, guessScreens, interpret, NAVIGATION_ROUTES, parseNavigation, type Decision } from '../navigate';
import { addHints, routePath, SCREEN_IDS, SCREENS } from '../intents';
import { type NeedleEngine } from '../router';
import { TOOLS, toAction, type ToolCall } from '../tools';

const OPTS = { log: false } as const;

/** A fake on-device model: answers by looking for a known sentence at the start of the request. */
function fake(table: Record<string, ToolCall[]>, confidence: number | null = 0.9): NeedleEngine & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async complete(text) {
      requests.push(text);
      const key = Object.keys(table).find((k) => text.startsWith(k));
      return { calls: key ? table[key] : [], confidence };
    },
  };
}
const open = (screen: string): ToolCall[] => [{ name: 'open_screen', arguments: { screen } }];

function screenOf(d: Decision): string | null {
  if (d.kind !== 'run' || d.action?.type !== 'screen') return null;
  return d.action.id;
}

const ENGLISH: [string, string][] = [
  ['I want to see where the shelters are', 'shelters'],
  ['where can I get treated nearby', 'hospitals'],
  ['talk to my neighbours', 'chat'],
  ['how is the weather going to be', 'weather'],
  ['switch on the torch', 'signals'],
  ['I need to make a noise so people find me', 'signals'],
  ['what is happening in the news', 'news'],
  ['help me get ready for a flood', 'prepare'],
  ['we lost our house what now', 'recover'],
  ['check on my relatives', 'family'],
  ['where did my family walk', 'findfamily'],
  ['is the road to town blocked', 'roads'],
  ['pack my emergency bag', 'gobag'],
  ['show my blood group info', 'medical'],
  ['is this photo safe to trust', 'photo'],
  ['are my phones connected to each other', 'mesh'],
  ['who can see my data', 'privacy'],
  ['change the text size for me', 'settings'],
  ['open the computer dashboard', 'hub'],
  ['is there a new version of the app', 'update'],
  ['go back to the start', 'home'],
  ['what else can this app do', 'more'],
  ['tell me when the ground shakes', 'shake'],
  ['where am I right now', 'locate'],
  ['show me the map of my area', 'map'],
  ['read me the first aid basics', 'aid'],
  ['let me practise with my kids', 'familydrill'],
];

const HINGLISH: [string, string][] = [
  ['mere ghar ka naksha dikhao', 'map'],
  ['nazdeeki aspatal batao', 'hospitals'],
  ['मौसम कैसा रहेगा', 'weather'],
  ['पास में कोई आश्रय है क्या', 'shelters'],
  ['टॉर्च जलाओ', 'signals'],
  ['सड़क बंद है क्या', 'roads'],
  ['मेरा परिवार कहाँ है', 'findfamily'],
  ['khabar sunao', 'news'],
  ['ghar ki taiyari kaise karein', 'prepare'],
  ['photo jaanch karo', 'photo'],
  ['मेरे खून का ग्रुप दिखाओ', 'medical'],
  ['bhasha badalne ke liye settings', 'settings'],
  ['मुझे अपने पड़ोसियों से बात करनी है', 'chat'],
  ['आपदा के बाद क्या करें', 'recover'],
  ['mesh ka haal batao', 'mesh'],
  ['हब चालू करो', 'hub'],
];

test('free-form English sentences open the right screen through the model', async () => {
  for (const [text, id] of ENGLISH) {
    const d = await interpret(text, fake({ [text]: open(id) }), OPTS);
    assert.equal(screenOf(d), id, `${text} -> ${JSON.stringify(d)}`);
    assert.ok(d.kind === 'run' && d.undo, 'screens offer Undo');
  }
});

test('Hindi and Hinglish sentences open the right screen; the model gets English hint words', async () => {
  for (const [text, id] of HINGLISH) {
    const engine = fake({ [text]: open(id) });
    const d = await interpret(text, engine, OPTS);
    assert.equal(screenOf(d), id, `${text} -> ${JSON.stringify(d)}`);
  }
  const e = fake({ 'mere ghar ka naksha': open('map') });
  await interpret('mere ghar ka naksha dikhao', e, OPTS);
  assert.match(e.requests[0], /\(.*map.*\)$/, 'transliterated words get an English hint');
  assert.equal(addHints('hello there'), 'hello there');
});

test('other tools from the model: pharmacy map, lifeboat, settings', async () => {
  const med = 'take me to somewhere I can get medicine';
  let d = await interpret(med, fake({ [med]: [{ name: 'find_nearest', arguments: { place: 'pharmacy' } }] }), OPTS);
  assert.deepEqual(d.kind === 'run' && d.action, { type: 'map', place: 'pharmacy' });
  const hi = 'mujhe davai chahiye';
  d = await interpret(hi, fake({ [hi]: [{ name: 'find_nearest', arguments: { place: 'pharmacy' } }] }), OPTS);
  assert.deepEqual(d.kind === 'run' && d.action, { type: 'map', place: 'pharmacy' });
  const life = 'lifeboat chaalu karo';
  d = await interpret(life, fake({ [life]: [{ name: 'set_lifeboat', arguments: { state: 'on' } }] }), OPTS);
  assert.deepEqual(d.kind === 'run' && d.action, { type: 'lifeboat', state: 'on' });
});

test('exact phrases never reach the model', async () => {
  const e = fake({});
  const d = await interpret('open map', e, OPTS);
  assert.equal(d.kind, 'run');
  assert.equal(d.kind === 'run' && d.route, '/map');
  assert.equal(e.requests.length, 0);
});

test('low confidence asks, with the second-best call as an alternative', async () => {
  const text = 'something about the sky tomorrow';
  const e = fake({ [text]: [...open('weather'), ...open('news'), ...open('map')] }, 0.4);
  const d = await interpret(text, e, OPTS);
  assert.equal(d.kind, 'confirm');
  if (d.kind !== 'confirm') return;
  assert.deepEqual(d.primary.action, { type: 'screen', id: 'weather' });
  assert.match(d.question, /^Did you mean: /);
  assert.deepEqual(d.alternatives.map((a) => a.action), [{ type: 'screen', id: 'news' }, { type: 'screen', id: 'map' }]);
});

test('risky actions always ask, even at full confidence', async () => {
  const cases: [string, ToolCall][] = [
    ['we are on the roof please come', { name: 'send_sos', arguments: {} }],
    ['I need someone to come quickly', { name: 'call_emergency', arguments: {} }],
    ['let everyone know I got out', { name: 'mark_safe', arguments: {} }],
    ['let me practise a fire drill with my kids', { name: 'start_drill', arguments: { scenario: 'fire' } }],
    ['sadak par paani bhar gaya hai', { name: 'report_road', arguments: { status: 'flooded' } }],
  ];
  for (const [text, call] of cases) {
    const d = await interpret(text, fake({ [text]: [call] }, 0.99), OPTS);
    assert.equal(d.kind, 'confirm', `${text} -> ${JSON.stringify(d)}`);
  }
  const d = await interpret('I need someone to come quickly', fake({ 'I need someone': [{ name: 'call_emergency', arguments: {} }] }, 1), OPTS);
  assert.equal(d.kind === 'confirm' && d.question, 'Did you mean: Call 112?');
});

test('model failure and timeout fall back to keywords, then the chip', async () => {
  const crash: NeedleEngine = { complete: async () => { throw new Error('native crash'); } };
  let d = await interpret('where is the nearest shelter', crash, OPTS);
  assert.deepEqual(d.kind === 'run' && d.action, { type: 'map', place: 'shelter' });

  const hang: NeedleEngine = { complete: () => new Promise(() => undefined) };
  const t0 = Date.now();
  d = await interpret('where is the nearest shelter', hang, { ...OPTS, timeoutMs: 60 });
  assert.deepEqual(d.kind === 'run' && d.action, { type: 'map', place: 'shelter' });
  assert.ok(Date.now() - t0 < 1500);

  d = await interpret('asdf qwerty blah', crash, OPTS);
  assert.equal(d.kind, 'chip');
  d = await interpret('asdf qwerty blah', null, OPTS);
  assert.equal(d.kind, 'chip');

  // no model at all: a keyword guess at a screen is offered, not opened
  d = await interpret('is the weather ok', null, OPTS);
  assert.equal(d.kind, 'confirm');
  assert.deepEqual(d.kind === 'confirm' && d.primary.action, { type: 'screen', id: 'weather' });
});

test('emergencies bypass the model and are instant', async () => {
  const hang: NeedleEngine = { complete: () => { throw new Error('the model must not be called'); } };
  const cases: [string, string][] = [
    ['I think my father is having a heart attack', 'heart-attack'],
    ['he has chest pain', 'heart-attack'],
    ['she is not breathing', 'cpr-adult'],
    ['my son is bleeding badly', 'severe-bleeding'],
    ['a snake bit my brother', 'snake-bite'],
    ['we are trapped under the roof', 'trapped-debris'],
    ['उसकी साँस नहीं चल रही', 'cpr-adult'],
    ['पापा को दिल का दौरा पड़ा है', 'heart-attack'],
    ['मैं मलबे में फँस गया हूँ', 'trapped-debris'],
    ['साँप ने काट लिया', 'snake-bite'],
    ['mere pitaji ko dil ka daura aaya hai', 'heart-attack'],
  ];
  for (const [text, guide] of cases) {
    const d = await interpret(text, hang, OPTS);
    assert.equal(d.kind, 'emergency', text);
    assert.equal(d.kind === 'emergency' && d.guideId, guide, text);
    assert.match(d.kind === 'emergency' ? d.callQuestion : '', /112/);
  }
  assert.equal(detectEmergency('he is not bleeding'), null);
  assert.equal(detectEmergency('there is no heart attack'), null);
  assert.equal(detectEmergency('open the map'), null);
});

test('unknown screen words from the model are rejected', async () => {
  for (const bad of ['../../etc', 'constructor', '__proto__', 'secret', '/admin', '']) {
    assert.deepEqual(toAction({ name: 'open_screen', arguments: { screen: bad } }), { type: 'none' }, bad);
  }
  assert.deepEqual(toAction({ name: 'open_screen', arguments: {} }), { type: 'none' });
  assert.deepEqual(toAction({ name: 'open_screen', arguments: { screen: ' Map ' } }), { type: 'screen', id: 'map' });
  const text = 'take me somewhere secret';
  const d = await interpret(text, fake({ [text]: open('secret') }), OPTS);
  assert.notEqual(d.kind, 'run');
  assert.deepEqual(toAction({ name: 'start_drill', arguments: { scenario: 'zombies' } }), { type: 'none' });
  assert.deepEqual(toAction({ name: 'report_road', arguments: { status: 'lava' } }), { type: 'none' });
  assert.deepEqual(toAction({ name: 'set_lifeboat', arguments: { state: 'maybe' } }), { type: 'none' });
});

test('SCREENS, navigate.ts and the tool enum agree', () => {
  const routes = new Set(Object.values(SCREENS).map((s) => s.route));
  for (const r of NAVIGATION_ROUTES) assert.ok(routes.has(r), `navigate.ts route ${r} is not in SCREENS`);
  const tool = TOOLS.find((t) => t.name === 'open_screen');
  assert.deepEqual([...(tool?.parameters.properties as { screen: { enum: readonly string[] } }).screen.enum], SCREEN_IDS);
  for (const s of Object.values(SCREENS)) assert.ok(s.en && s.hi && s.aliases.length, s.route);
});

test('every SCREENS route is a real file under src/app', () => {
  const app = path.join(process.cwd(), 'src', 'app');
  for (const [id, s] of Object.entries(SCREENS)) {
    const p = routePath(s.route);
    const rel = p === '/' ? 'index' : p.slice(1);
    const ok = fs.existsSync(path.join(app, `${rel}.tsx`)) || fs.existsSync(path.join(app, rel, 'index.tsx'));
    assert.ok(ok, `${id}: ${s.route} has no file under src/app`);
  }
});

test('every alias opens its own screen (no two screens share a phrase)', () => {
  for (const [id, s] of Object.entries(SCREENS)) {
    for (const a of s.aliases) {
      const hit = parseNavigation(a);
      assert.equal(hit?.route, s.route, `alias "${a}" of ${id} resolves to ${hit?.route}`);
    }
  }
  assert.deepEqual(guessScreens('is the weather ok'), ['weather']);
  assert.deepEqual(guessScreens(''), []);
});

test('the catalogue keeps its original tools and adds the new ones', () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ['show_first_aid', 'show_home_remedy', 'show_disaster_guide', 'find_nearest', 'send_sos', 'mark_safe', 'call_emergency', 'read_alerts', 'open_chat', 'change_setting', 'open_screen', 'start_drill', 'report_road', 'set_lifeboat']) {
    assert.ok(names.includes(n as never), n);
  }
});
