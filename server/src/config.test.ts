import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveDataDir, startupWarnings } from './config.ts';

const VOLUME = 'Data will be lost on redeploy: attach a Volume and set BEACON_DATA=/data';

test('data directory defaults to ./data under the working directory, and BEACON_DATA wins', () => {
  const def = join('/app/server', 'data');
  assert.equal(resolveDataDir({}, '/app/server'), def);
  assert.equal(resolveDataDir({ BEACON_DATA: '  ' }, '/app/server'), def);
  assert.equal(resolveDataDir({ BEACON_DATA: '/data' }, '/app/server'), '/data');
});

test('on Railway, a missing or relative BEACON_DATA gets the volume warning', () => {
  assert.ok(startupWarnings({ RAILWAY_ENVIRONMENT: 'production' }).includes(VOLUME));
  assert.ok(startupWarnings({ RAILWAY_ENVIRONMENT: 'production', BEACON_DATA: './data' }).includes(VOLUME));
  assert.ok(!startupWarnings({ RAILWAY_ENVIRONMENT: 'production', BEACON_DATA: '/data' }).includes(VOLUME));
});

test('off Railway there is no volume warning', () => {
  assert.ok(!startupWarnings({}).includes(VOLUME));
  assert.ok(!startupWarnings({ BEACON_DATA: './data' }).some((w) => w.includes('Volume')));
});

test('a warning is given when MOD_TOKEN is unset, and not when it is set', () => {
  assert.ok(startupWarnings({ MOD_TOKEN: '' }).some((w) => w.includes('MOD_TOKEN not set')));
  assert.ok(!startupWarnings({ MOD_TOKEN: 'long-random' }).some((w) => w.includes('MOD_TOKEN')));
});
