import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALLBACK_VOICES, ElevenError, cleanKey, errorFromResponse, lacksPermissionOnly, pickVoices, type Voice } from '../elevenlabsCore';

test('cleanKey trims spaces, newlines and surrounding quotes, and drops inner whitespace', () => {
  assert.equal(cleanKey('  "sk_abc\n123"  '), 'sk_abc123');
  assert.equal(cleanKey("'sk_xyz'"), 'sk_xyz');
  assert.equal(cleanKey('\n sk_1 2 \t'), 'sk_12');
  assert.equal(cleanKey('   '), '');
});

test('missing_permissions on /v1/voices gives a readable reason and keeps the 401', () => {
  const e = errorFromResponse(
    401,
    JSON.stringify({ detail: { status: 'missing_permissions', message: 'The API key you used is missing the permission voices_read to execute this operation.' } }),
  );
  assert.ok(e instanceof ElevenError);
  assert.equal(e.status, 401);
  assert.equal(e.kind, 'permission');
  assert.equal(e.permission, 'voices_read');
  assert.equal(e.reason, 'missing permission: voices_read');
  assert.equal(e.message, 'ElevenLabs says: missing permission: voices_read (HTTP 401)');
  assert.ok(!e.message.includes('rejected the key'));
  assert.ok(lacksPermissionOnly(e));
});

test('speech_to_text permission is named for the mic', () => {
  const e = errorFromResponse(401, JSON.stringify({ detail: { status: 'missing_permissions', message: 'missing the permission speech_to_text to execute this operation.' } }));
  assert.equal(e.reason, 'missing permission: speech_to_text');
});

test('a 401 that says the key is invalid is the only one called rejected', () => {
  const e = errorFromResponse(401, JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } }));
  assert.equal(e.kind, 'invalid_key');
  assert.equal(e.message, 'ElevenLabs rejected the key (HTTP 401)');
  assert.ok(!lacksPermissionOnly(e));
});

test('a 401 with a string detail saying unknown key is rejected', () => {
  const e = errorFromResponse(401, JSON.stringify({ detail: 'Unknown API key' }));
  assert.equal(e.kind, 'invalid_key');
  assert.equal(e.message, 'ElevenLabs rejected the key (HTTP 401)');
});

test('a 401 with no readable body is not called rejected', () => {
  const e = errorFromResponse(401, '<html>gateway</html>');
  assert.equal(e.kind, 'other');
  assert.equal(e.message, 'ElevenLabs error (HTTP 401)');
});

test('detail as a string and as validation list both give a reason', () => {
  assert.equal(errorFromResponse(429, JSON.stringify({ detail: 'Too many requests' })).message, 'ElevenLabs says: Too many requests (HTTP 429)');
  const v = errorFromResponse(422, JSON.stringify({ detail: [{ loc: ['query', 'page_size'], msg: 'bad size', type: 'x' }] }));
  assert.equal(v.reason, 'bad size');
  assert.equal(v.status, 422);
});

test('403 is a permission failure that can fall back to default voices', () => {
  const e = errorFromResponse(403, JSON.stringify({ detail: { status: 'forbidden', message: 'Access denied' } }));
  assert.equal(e.kind, 'permission');
  assert.ok(lacksPermissionOnly(e));
  assert.equal(lacksPermissionOnly(new Error('plain')), false);
});

test('pickVoices keeps the existing role assignment', () => {
  const list: Voice[] = [
    { id: 'f1', name: 'A', gender: 'female' },
    { id: 'f2', name: 'B', gender: 'female' },
    { id: 'm1', name: 'C', gender: 'male' },
  ];
  const v = pickVoices(list);
  assert.equal(v.didi?.id, 'f1');
  assert.equal(v.asha?.id, 'f2');
  assert.equal(v.veer?.id, 'm1');
  assert.equal(v.default?.id, 'f1');
});

test('fallback voices cover every role with documented premade ids', () => {
  assert.equal(FALLBACK_VOICES.default.id, '21m00Tcm4TlvDq8ikWAM');
  assert.equal(FALLBACK_VOICES.veer.id, 'pNInz6obpgDQGcFmaJgB');
  for (const r of ['didi', 'asha', 'veer', 'default'] as const) assert.ok(FALLBACK_VOICES[r].id.length > 0);
});
