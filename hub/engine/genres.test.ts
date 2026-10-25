import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, instantiate, templateById } from './templates.ts';
import { PERSONAS } from './personas.ts';
import { NODE_KINDS, cleanPipeline } from './nodeCatalog.ts';

const GENRE_IDS = [
  'news-desk', 'wind-watch', 'weather-brief', 'flood-desk',
  'quake-desk', 'official-alert-desk', 'relief-desk', 'mcp-bridge',
];

test('the eight genre agents exist with a genre and a pipeline', () => {
  for (const id of GENRE_IDS) {
    const t = templateById(id);
    assert.ok(t, `${id} exists`);
    assert.ok(t.agent.genre, `${id} genre`);
    assert.ok(Array.isArray(t.agent.pipeline) && t.agent.pipeline.length > 0, `${id} pipeline`);
  }
});

test('template ids are unique', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('node ids are unique within each pipeline', () => {
  for (const t of TEMPLATES) {
    const ids = (t.agent.pipeline ?? []).map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id} node ids`);
  }
});

test('every pipeline passes cleanPipeline unchanged', () => {
  for (const t of TEMPLATES) {
    const pipeline = t.agent.pipeline ?? [];
    if (pipeline.length === 0) continue;
    const cleaned = cleanPipeline(pipeline);
    assert.equal(cleaned.length, pipeline.length, `${t.id} length`);
    cleaned.forEach((c, i) => {
      assert.equal(c.id, pipeline[i].id, `${t.id} node ${i} keeps its id`);
      assert.equal(c.kind, pipeline[i].kind, `${t.id} node ${i} kind`);
    });
  }
});

test('every node kind is one the engine implements', () => {
  const known = new Set(NODE_KINDS.map((k) => k.kind));
  for (const t of TEMPLATES) {
    for (const n of t.agent.pipeline ?? []) {
      assert.ok(known.has(n.kind), `${t.id}/${n.id} kind ${n.kind}`);
    }
  }
});

test('every persona template id exists', () => {
  for (const p of PERSONAS) {
    for (const id of p.templates) {
      assert.ok(templateById(id), `${p.id} lists unknown template ${id}`);
    }
  }
});

test('the genre agents are listed under the right personas', () => {
  const listed = (persona: string) => PERSONAS.find((p) => p.id === persona)?.templates ?? [];
  for (const id of ['wind-watch', 'weather-brief']) assert.ok(listed('scientist').includes(id), `scientist ${id}`);
  for (const id of ['flood-desk', 'quake-desk', 'official-alert-desk']) assert.ok(listed('rescuer').includes(id), `rescuer ${id}`);
  for (const id of ['news-desk', 'relief-desk']) assert.ok(listed('helper').includes(id), `helper ${id}`);
  assert.ok(listed('engineer').includes('mcp-bridge'), 'engineer mcp-bridge');
});

test('instantiate keeps genre and pipeline, and copies the pipeline', () => {
  for (const id of GENRE_IDS) {
    const t = templateById(id);
    assert.ok(t);
    const a = instantiate(t);
    assert.equal(a.genre, t.agent.genre, `${id} genre`);
    assert.deepEqual(a.pipeline, t.agent.pipeline, `${id} pipeline`);
    assert.notEqual(a.pipeline, t.agent.pipeline, `${id} pipeline array is a copy`);
    a.pipeline?.[0] && (a.pipeline[0].config.changed = true);
    assert.equal(t.agent.pipeline?.[0].config.changed, undefined, `${id} template not changed`);
  }
});

test('the news desk has no built-in rules, the weather, wind and flood ones have one', () => {
  assert.equal(templateById('news-desk')?.agent.rules.length, 0);
  for (const id of ['wind-watch', 'weather-brief', 'flood-desk']) {
    assert.equal(templateById(id)?.agent.rules.length, 1, `${id} rule count`);
  }
});
