import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadServiceAccount, parseServiceAccount } from './fcm.ts';

const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n';
const sa = { type: 'service_account', project_id: 'beacon-test', client_email: 'push@beacon-test.iam.gserviceaccount.com', private_key: KEY };
const json = JSON.stringify(sa);

test('parses the service-account JSON text', () => {
  const got = parseServiceAccount(json);
  assert.equal(got.project_id, 'beacon-test');
  assert.equal(got.client_email, sa.client_email);
  assert.equal(got.private_key, KEY);
});

test('parses the base64 of the JSON (what hosts with no files are given)', () => {
  const b64 = Buffer.from(json).toString('base64');
  assert.equal(parseServiceAccount(b64).project_id, 'beacon-test');
  assert.equal(parseServiceAccount(`  ${b64}\n`).project_id, 'beacon-test');
});

test('loadServiceAccount reads FIREBASE_SERVICE_ACCOUNT_JSON in either form, and the file path form', () => {
  assert.equal(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: json })?.project_id, 'beacon-test');
  assert.equal(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString('base64') })?.project_id, 'beacon-test');
  const dir = mkdtempSync(join(tmpdir(), 'fcm-'));
  const file = join(dir, 'sa.json');
  writeFileSync(file, json);
  assert.equal(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT: file })?.project_id, 'beacon-test');
  assert.equal(loadServiceAccount({}), null);
});

test('garbage is rejected with a readable error that does not echo the input', () => {
  const garbage = 'not-a-key-$$$-' + 'x'.repeat(40);
  assert.throws(() => parseServiceAccount(garbage), /must be the service-account JSON, or its base64, but it is neither/);
  let msg = '';
  try {
    parseServiceAccount(garbage);
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.ok(!msg.includes(garbage), 'error must not echo the input');
});

test('valid JSON that is not a service account is rejected, and the private key is never in the message', () => {
  const partial = JSON.stringify({ project_id: 'x', private_key: KEY });
  let msg = '';
  try {
    parseServiceAccount(partial);
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.match(msg, /not a Firebase service-account key/);
  assert.ok(!msg.includes('PRIVATE KEY'));
  assert.throws(() => parseServiceAccount(JSON.stringify({ ...sa, private_key: 'nope' })), /not a Firebase service-account key/);
});

test('a missing file is reported by path, not by contents', () => {
  assert.throws(() => loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT: '/nonexistent/sa.json' }), /cannot read the file at \/nonexistent\/sa.json/);
});
