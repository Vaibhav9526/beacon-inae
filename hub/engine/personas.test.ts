import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HubApp } from './app.ts';
import { haikuWriter } from './brains.ts';
import { startHttp } from './httpServer.ts';
import { HealthStore, newKey } from './healthStore.ts';
import { Hub } from './hub.ts';
import { AuditLog, Outbox } from './outbox.ts';
import type { Sender } from './outbox.ts';
import { PERSONAS, personaById } from './personas.ts';
import { instantiate, templateById, TEMPLATES } from './templates.ts';
import type { Alert, Persona } from './types.ts';

const TINTS = ['pink', 'yellow', 'blue', 'green', 'lilac', 'peach'];
const HEX = /^#[0-9A-F]{6}$/i;

function offlineApp(interactive = true) {
  const sent: string[] = [];
  const app = new HubApp({
    dir: mkdtempSync(join(tmpdir(), 'personas-')),
    offline: true,
    interactive,
    extraSenders: [{ channel: 'telegram', send: async (t) => void sent.push(t) }],
  });
  return { app, sent };
}

test('every persona has a unique id, filled-in text, a valid tint and look, and real templates', () => {
  const ids = PERSONAS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'persona ids are unique');
  const templateIds = new Set(TEMPLATES.map((t) => t.id));
  for (const p of PERSONAS) {
    for (const field of ['name', 'role', 'tagline', 'about', 'voice', 'signature', 'avatar'] as const) {
      assert.ok(p[field].trim().length > 0, `${p.id}.${field} is non-empty`);
    }
    assert.ok(p.skills.length > 0 && p.skills.every((s) => s.trim().length > 0), `${p.id} has skills`);
    assert.ok(TINTS.includes(p.tint), `${p.id} has a valid tint (${p.tint})`);
    assert.match(p.look.color, HEX, `${p.id} look colour is hex`);
    assert.ok(p.templates.length > 0, `${p.id} suggests at least one template`);
    for (const tid of p.templates) assert.ok(templateIds.has(tid), `${p.id} template ${tid} exists in TEMPLATES`);
  }
});

test('HubApp.enrol creates an awake agent with persona look, avatar and defaults', () => {
  const { app } = offlineApp();
  const doctor = personaById('doctor')!;
  const a = app.enrol({ personaId: 'doctor' })!;
  assert.ok(a, 'enrol returns the agent');
  assert.equal(a.personaId, 'doctor');
  assert.deepEqual(a.look, doctor.look);
  assert.equal(a.avatar, doctor.avatar);
  assert.equal(a.enabled, true, 'starts awake');
  assert.equal(a.templateId, doctor.templates[0], 'defaults to the first template of the persona');
  assert.equal(a.name, `${doctor.name}'s ${templateById(doctor.templates[0])!.name}`);
  assert.ok(app.hub.agents().some((x) => x.id === a.id), 'agent is stored');
});

test('HubApp.enrol honours templateId, name, place, members and awake:false', () => {
  const { app } = offlineApp();
  const place = { name: 'Pune', lat: 18.52, lon: 73.85, state: 'maharashtra' };
  const a = app.enrol({ personaId: 'rescuer', templateId: 'flood-watcher', name: '  Veer Two ', place, members: ['Maa'], awake: false })!;
  assert.equal(a.templateId, 'flood-watcher');
  assert.equal(a.name, 'Veer Two');
  assert.deepEqual(a.place, place);
  assert.deepEqual(a.members, ['Maa']);
  assert.equal(a.enabled, false);
});

test('HubApp.enrol returns null for an unknown persona or template', () => {
  const { app } = offlineApp();
  assert.equal(app.enrol({ personaId: 'nobody' }), null);
  assert.equal(app.enrol({ personaId: 'doctor', templateId: 'no-such-template' }), null);
  assert.equal(app.hub.agents().length, 0, 'nothing is stored on refusal');
});

test('POST /api/agents with personaId enrols through HTTP and GET /api/state lists personas', async () => {
  const { app } = offlineApp();
  const { server, port, token } = await startHttp(app, { token: 'tok' });
  try {
    const headers = { 'x-hub-token': token, 'content-type': 'application/json' };
    const post = await fetch(`http://127.0.0.1:${port}/api/agents`, { method: 'POST', headers, body: JSON.stringify({ personaId: 'doctor' }) });
    assert.equal(post.status, 200);
    const agent = (await post.json()) as { personaId: string; enabled: boolean };
    assert.equal(agent.personaId, 'doctor');
    assert.equal(agent.enabled, true);

    const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers })).json()) as { personas: Persona[] };
    assert.deepEqual(
      state.personas.map((p) => p.id),
      PERSONAS.map((p) => p.id),
    );
  } finally {
    server.close();
  }
});

test('the persona signature is appended to a sent heatwave alert', async () => {
  const sent: string[] = [];
  const sender = (channel: 'telegram' | 'beacon'): Sender => ({ channel, send: async (t) => void sent.push(`${channel}:${t}`) });
  const dir = mkdtempSync(join(tmpdir(), 'persona-sig-'));
  const health = new HealthStore(join(dir, 'h.bin'), newKey());
  health.add({ member: 'Maa', at: Date.now(), hr: 112, spo2: 91 });
  const outbox = new Outbox({ senders: [sender('telegram'), sender('beacon')], audit: new AuditLog(join(dir, 'audit.jsonl')), ask: async () => 'always' });
  const hub = new Hub({ dir, health, outbox, source: { offline: true } });
  const doctor = personaById('doctor')!;
  hub.upsert(instantiate(templateById('heatwave-guardian')!, { members: ['Maa'], personaId: 'doctor' }));
  const out = await hub.tick(true);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'sent');
  assert.ok(sent.length > 0);
  for (const s of sent) assert.ok(s.endsWith(` - ${doctor.signature}`), `signed with ${doctor.signature}: ${s}`);
});

test('haikuWriter passes the persona voice to the brain', async () => {
  const doctor = personaById('doctor')!;
  const systems: string[] = [];
  const brain = async (system: string) => {
    systems.push(system);
    return 'Maa heart rate 112 in a 43 C heatwave. Move to a cooler room.';
  };
  const alert = { severity: 'severe' } as Alert;
  const out = await haikuWriter(brain)(alert, 'Urgent: Maa heart rate 112, heatwave at 43 C.', doctor);
  assert.ok(out, 'wording is kept');
  assert.equal(systems.length, 1);
  assert.ok(systems[0].includes(doctor.voice), 'system prompt carries the persona voice');

  await haikuWriter(brain)(alert, 'Urgent: Maa heart rate 112, heatwave at 43 C.');
  assert.ok(!systems[1].includes(doctor.voice), 'no persona means no voice line');
});
