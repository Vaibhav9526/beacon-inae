import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// the plugin is CommonJS (like the other plugins in plugins/)
const { addSpeechQueries } = createRequire(import.meta.url)('../../../plugins/withSpeechQueries.js') as {
  addSpeechQueries: (m: unknown) => any;
};
const ACTION = 'android.speech.RecognitionService';
const count = (m: any) => JSON.stringify(m).split(ACTION).length - 1;

test('adds the speech recognition <queries> entry to a manifest without one', () => {
  const m = addSpeechQueries({ manifest: { $: { 'xmlns:android': 'x' }, application: [{}] } });
  assert.equal(count(m), 1);
  assert.deepEqual(m.manifest.queries, [{ intent: [{ action: [{ $: { 'android:name': ACTION } }] }] }]);
});

test('is idempotent: running twice does not duplicate the entry', () => {
  const once = addSpeechQueries({ manifest: {} });
  const twice = addSpeechQueries(once);
  assert.equal(count(twice), 1);
});

test('keeps existing <queries> entries and does not add when already present', () => {
  const existing = {
    manifest: {
      queries: [
        { package: [{ $: { 'android:name': 'com.example.other' } }] },
        { intent: [{ action: [{ $: { 'android:name': ACTION } }] }] },
      ],
    },
  };
  const m = addSpeechQueries(existing);
  assert.equal(m.manifest.queries.length, 2);
  assert.equal(m.manifest.queries[0].package[0].$['android:name'], 'com.example.other');
  assert.equal(count(m), 1);
});

test('appends next to unrelated <queries> entries', () => {
  const m = addSpeechQueries({ manifest: { queries: [{ package: [{ $: { 'android:name': 'com.example.other' } }] }] } });
  assert.equal(m.manifest.queries.length, 2);
  assert.equal(count(m), 1);
});
