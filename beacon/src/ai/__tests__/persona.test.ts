import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGuide } from '../../kb';
import { PERSONAS, type Block, reply } from '../persona';

const texts = (bs: Block[]) => bs.flatMap((b) => (b.type === 'text' || b.type === 'warn' ? [b.text] : b.type === 'steps' ? b.steps : []));

test('Dr. Asha answers a bleeding question with the curated steps, 112 and the do-nots', async () => {
  const r = await reply('asha', 'my friend is bleeding from a deep cut', 'en');
  const g = getGuide('severe-bleeding')!;
  const all = texts(r.blocks).join(' ');
  for (const s of g.steps) assert.ok(all.includes(s[0]), `missing step: ${s[0].slice(0, 40)}`);
  assert.match(all, /112/);
  assert.ok(r.blocks.some((b) => b.type === 'warn' && /Do not pull out/.test(b.text)));
  assert.ok(r.blocks.some((b) => b.type === 'guide' && b.id === 'severe-bleeding'));
});

test('replies come out in Hindi when asked', async () => {
  const r = await reply('asha', 'खून बह रहा है', 'hi');
  assert.match(texts(r.blocks).join(' '), /[ऀ-ॿ]/);
  assert.match(texts(r.blocks).join(' '), /112/);
});

test('Didi keeps it short for kids, tells them to involve a grown-up, and never triggers SOS from chat', async () => {
  // "burn" alone is a tie between two guides, so Didi asks first; the tapped choice then gives the steps
  const asked = await reply('didi', 'I burnt my hand on the stove', 'en');
  assert.ok(!asked.blocks.some((b) => b.type === 'steps'), 'an unsure match must not give steps');
  const chip = asked.blocks.find((b) => b.type === 'chips') as Extract<Block, { type: 'chips' }>;
  const burns = chip.items.find((c) => c.guideId === 'burns');
  assert.ok(burns, 'the burns guide is offered as a choice');
  const burn = await reply('didi', burns!.query, 'en', null, burns!.guideId);
  const steps = burn.blocks.find((b) => b.type === 'steps') as Extract<Block, { type: 'steps' }>;
  assert.ok(steps.steps.length <= 4);
  assert.match(texts(burn.blocks).join(' '), /grown-up/i);
  assert.ok(!burn.blocks.some((b) => b.type === 'warn' && /Do not/.test(b.text) && b.text.length > 200), 'no long adult warnings for kids');

  const sos = await reply('didi', 'help me, rescue me', 'en');
  assert.ok(!sos.blocks.some((b) => b.type === 'action'), 'a chat message must not fire an SOS for a child');
  assert.match(texts(sos.blocks).join(' '), /Help button/);

  const adultSos = await reply('veer', 'send sos', 'en');
  assert.ok(adultSos.blocks.some((b) => b.type === 'action' && b.action.type === 'sos'), 'adults get an explicit confirm button');
});

test('Captain Veer gives disaster plans', async () => {
  const r = await reply('veer', 'earthquake shaking what do I do', 'en');
  const all = texts(r.blocks).join(' ');
  assert.match(all, /DROP/);
  assert.ok(r.blocks.some((b) => b.type === 'disaster' && b.id === 'earthquake'));
});

test('unknown questions are not answered with invented advice', async () => {
  const r = await reply('asha', 'what is the capital of mongolia', 'en');
  assert.equal(r.source, 'none');
  assert.ok(r.blocks.some((b) => b.type === 'chips'));
  assert.ok(!r.blocks.some((b) => b.type === 'steps'));
  assert.equal(r.confidence, 0);
});

test('every persona has bilingual copy and starters that actually resolve to a guide or disaster', async () => {
  for (const p of Object.values(PERSONAS)) {
    assert.ok(p.name[0] && p.name[1] && p.greeting[0] && p.greeting[1]);
    for (const s of p.starters) {
      for (const lang of ['en', 'hi'] as const) {
        const r = await reply(p.id, s[lang === 'en' ? 0 : 1], lang);
        assert.notEqual(r.source, 'none', `starter "${s[lang === 'en' ? 0 : 1]}" (${p.id}/${lang}) found nothing`);
      }
    }
  }
});
