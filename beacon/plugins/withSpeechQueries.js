// Android 11+ package visibility: SpeechRecognizer.isRecognitionAvailable() can return false unless the manifest
// declares the speech recognition service in <queries>. This adds that entry to AndroidManifest.xml on every
// `expo prebuild`, keeping any existing <queries> entries, and does nothing if it is already there.
const { withAndroidManifest } = require('@expo/config-plugins');

const ACTION = 'android.speech.RecognitionService';

const hasAction = (intents) =>
  (intents ?? []).some((intent) => (intent.action ?? []).some((a) => a?.$?.['android:name'] === ACTION));

/** Pure: adds the speech <queries> entry to a parsed AndroidManifest (xml2js shape). Returns the same object. */
function addSpeechQueries(manifest) {
  const root = manifest.manifest;
  root.queries = root.queries ?? [];
  const present = root.queries.some((q) => hasAction(q.intent));
  if (!present) root.queries.push({ intent: [{ action: [{ $: { 'android:name': ACTION } }] }] });
  return manifest;
}

const withSpeechQueries = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults = addSpeechQueries(c.modResults);
    return c;
  });

module.exports = withSpeechQueries;
module.exports.addSpeechQueries = addSpeechQueries;
