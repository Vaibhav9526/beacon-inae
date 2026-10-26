// Connections page: Telegram, phones (pairing QR) and the brain that words alerts. Spec 3.8 and 5.10.
// Typed values (token, API key) live in the DOM and survive refreshes through update(); only the status
// regions around them are repainted.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';

const { h, Button, Chip, Dot, Field, Input, PageHeader, toast, clock } = ui;

const BRAINS = [
  ['none', 'None', 'Alerts use plain built-in wording. Nothing is sent to a model.'],
  ['claude', 'Claude', 'Use the Claude command installed on this computer.'],
  ['codex', 'Codex', 'Use the Codex command installed on this computer.'],
  ['gemini', 'Gemini', 'Use the Gemini command installed on this computer.'],
  ['api', 'API key', 'Use your own model API key. It is stored on this computer.']
];
const BRAIN_LABEL = Object.fromEntries(BRAINS.map(([id, label]) => [id, label]));

// Per-viewer state for the pairing results and the brain choice (not data; survives re-renders).
const tg = { pair: null };
const phones = { qr: null };
const brain = { pick: null };
const relay = { check: null };
const owm = { test: null, busy: false };

/* ---------- status pieces ---------- */

function pill(tone, label) {
  return h('span', { class: 'pill ' + tone }, label);
}

// The Telegram chip: one entry per connection state the engine reports (see TelegramStatus in engine/telegram.ts).
const TG_CHIP = {
  none: { tone: 'muted', dot: 'asleep', label: 'Not set' },
  connecting: { tone: 'muted', dot: 'asleep', label: 'Connecting...' },
  connected: { tone: 'ok', dot: 'ok' },
  reconnecting: { tone: 'warn', dot: 'bad', label: 'Reconnecting...' },
  rejected: { tone: 'danger', dot: 'bad', label: 'Token rejected' },
  unreachable: { tone: 'warn', dot: 'bad', label: 'Cannot reach Telegram' }
};

function telegramStatus(state) {
  const t = (state.connections && state.connections.telegram) || {};
  const s = t.state || (t.connected ? 'connected' : 'none');
  const paired = Number(t.paired) || 0;
  const chip = TG_CHIP[s] || TG_CHIP.none;
  let label = chip.label;
  if (s === 'connected') label = t.bot ? 'Connected as @' + String(t.bot).replace(/^@/, '') : 'Connected';
  if (s === 'reconnecting') label = 'Reconnecting... (try ' + (t.attempt || 1) + ' of 5)';
  const facts = [t.hint, paired + (paired === 1 ? ' chat paired' : ' chats paired')].filter(Boolean).join(' · ');
  return h('div', { class: 'conn-head-status' },
    Dot({ state: chip.dot, label }),
    pill(chip.tone, label),
    h('span', { class: 'row-sub' }, facts),
    t.message ? h('span', { class: 'row-sub', role: 'status' }, t.message) : null);
}

function telegramPair() {
  if (!tg.pair) return null;
  return h('div', { class: 'conn-pair', role: 'status' },
    h('span', { class: 'field-label' }, 'Pairing code'),
    h('code', { class: 'conn-code' }, tg.pair.code),
    h('p', { class: 'field-desc' },
      'Open a chat with the bot' + (tg.pair.bot ? ' ' + tg.pair.bot : '') + ' in Telegram and send this code. Repeat for each family chat.'));
}

function phonesStatus(state) {
  const n = Number((state.connections && state.connections.beacon && state.connections.beacon.paired) || 0);
  return h('div', { class: 'conn-head-status' },
    Dot({ state: n > 0 ? 'ok' : 'asleep' }),
    pill(n > 0 ? 'ok' : 'muted', n === 0 ? 'No phones yet' : n + (n === 1 ? ' phone paired' : ' phones paired')));
}

function phonesPair() {
  if (!phones.qr) return null;
  const q = phones.qr;
  const payload = q.payload ? String(q.payload) : '';
  return h('div', { class: 'conn-qr-wrap' },
    h('div', { class: 'conn-qr' },
      q.qr ? h('img', { src: q.qr, alt: 'Pairing QR code. Scan it with the Beacon app on the phone.', width: 200, height: 200 }) : null),
    h('div', { class: 'conn-qr-info' },
      q.code ? h('p', { class: 'conn-qr-code' }, 'Code ', h('code', null, q.code)) : null,
      q.expiresAt ? h('p', { class: 'field-desc' }, 'Valid until ' + clock(q.expiresAt) + '.') : null,
      payload ? h('p', { class: 'field-desc' }, 'Payload hint: ' + payload.slice(0, 12) + (payload.length > 12 ? '...' : '')) : null,
      h('p', { class: 'field-desc' }, 'Scan this with the Beacon app. The phone then joins this hub.')));
}

function relayStatus() {
  const c = relay.check;
  if (!c) return null;
  return h('p', { class: 'conn-relay-result ' + (c.ok ? 'ok' : 'bad'), role: 'status' },
    c.ok ? 'Reachable. It answered in ' + c.ms + ' ms.' : 'Not reachable: ' + (c.error || 'unknown error') + '.');
}

function owmStatus(state) {
  const ow = (state.connections && state.connections.openWeather) || {};
  const has = !!ow.hasKey;
  const t = owm.test;
  let tone = has ? 'ok' : 'muted';
  let label = has ? 'Key saved' : 'No key yet';
  let note = has && ow.hint ? ow.hint : '';
  if (owm.busy) { tone = 'muted'; label = 'Testing'; }
  else if (t && t.ok) { tone = 'ok'; label = 'Working'; note = 'Answered in ' + t.ms + ' ms.'; }
  else if (t && !t.ok) { tone = 'danger'; label = 'Not working'; note = t.error || 'unknown error'; }
  return h('div', { class: 'conn-head-status' },
    Dot({ state: tone === 'ok' ? 'ok' : tone === 'danger' ? 'bad' : 'asleep' }),
    pill(tone, label),
    note ? h('span', { class: 'row-sub', role: 'status' }, note) : null);
}

function brainStatus(state) {
  const b = (state.connections && state.connections.brain) || {};
  const ok = !!b.ok;
  return h('div', { class: 'conn-head-status' },
    Dot({ state: ok ? 'ok' : 'bad' }),
    pill(ok ? 'ok' : 'warn', ok ? 'Ready' : 'Needs setup'),
    h('span', { class: 'row-sub' }, 'Using ' + (BRAIN_LABEL[b.kind] || 'none') + '.'));
}

/* ---------- actions ---------- */

/** Telegram state from the engine (never the token): stored for paint() and repainted. */
function applyTelegram(root, t) {
  if (store.state && store.state.connections && t) store.state.connections.telegram = t;
  paint(root);
}

/** Saves the token. The engine checks it first; a refused token shows its error, a slow network saves and retries. */
async function saveTelegram(root) {
  const input = root.querySelector('#conn-tg-token');
  const token = input ? input.value.trim() : '';
  if (!token) return toast('Paste the bot token first. A saved token is kept.', { kind: 'info' });
  const res = await api.post('/api/telegram/token', { token });
  if (!res) return;
  if (input) input.value = '';
  applyTelegram(root, res.telegram);
  const t = res.telegram || {};
  if (t.state === 'connected') toast('Connected to @' + String(t.bot).replace(/^@/, '') + '.', { kind: 'ok', title: 'Telegram' });
  else toast(t.message || 'Token saved.', { kind: 'info', title: 'Telegram' });
}

/** The Retry now button: connect again with the saved token. */
async function retryTelegram(root) {
  const res = await api.post('/api/telegram/retry', {});
  if (!res) return;
  applyTelegram(root, res.telegram);
}

/** Remove key: forgets the bot token. Paired chats stay paired. */
async function removeTelegram(root) {
  const res = await api.del('/api/telegram/token');
  if (!res) return;
  applyTelegram(root, res.telegram);
  toast('Telegram token removed. Paired chats are kept.', { kind: 'ok', title: 'Telegram' });
}

async function getPairingCode(root) {
  const state = store.state || {};
  const res = await api.post('/api/telegram/pair', {});
  if (!res) return;
  tg.pair = { code: res.code, bot: res.bot || (state.connections && state.connections.telegram && state.connections.telegram.bot) || '' };
  paint(root);
}

async function showPairingQr(root) {
  const res = await api.post('/api/beacon/pair', {});
  if (!res) return;
  phones.qr = res;
  paint(root);
}

/** The relay field: the address the hub and its phones use. Saved to this computer; the check is done by the engine. */
async function saveRelay(root) {
  const input = root.querySelector('#conn-relay-url');
  const relayUrl = input ? input.value.trim() : '';
  if (!relayUrl) return toast('Type the relay address first.', { kind: 'info' });
  const res = await api.put('/api/settings', { relayUrl });
  if (!res) return;
  if (input) input.value = res.relayUrl || relayUrl;
  relay.check = null;
  paint(root);
  toast('Relay server saved.', { kind: 'ok', title: 'Relay server' });
}

async function checkRelay(root) {
  const input = root.querySelector('#conn-relay-url');
  const relayUrl = input ? input.value.trim() : '';
  if (!relayUrl) return toast('Type the relay address first.', { kind: 'info' });
  relay.check = { ok: false, ms: 0, error: 'checking' };
  paint(root);
  const res = await api.post('/api/relay/check', { relayUrl });
  relay.check = res || { ok: false, ms: 0, error: 'the hub could not run the check' };
  paint(root);
}

async function saveBrain(root) {
  const kind = brain.pick || 'none';
  const keyEl = root.querySelector('#conn-brain-key');
  const body = { kind };
  if (kind === 'api') {
    const apiKey = keyEl ? keyEl.value.trim() : '';
    if (!apiKey) return toast('Paste the API key first.', { kind: 'info' });
    body.apiKey = apiKey;
  }
  const res = await api.post('/api/brain', body);
  if (!res) return;
  if (keyEl) keyEl.value = '';
  toast('Brain set to ' + (BRAIN_LABEL[kind] || kind) + '.', { kind: 'ok', title: 'Brain' });
}

/** Saves a pasted key. An empty field keeps the saved key; removing one is the Remove key button. */
async function saveOwm(root) {
  const input = root.querySelector('#conn-owm-key');
  const openWeatherKey = input ? input.value.trim() : '';
  if (!openWeatherKey) return toast('Paste the key first. The saved key is kept. Use Remove key to delete it.', { kind: 'info', title: 'OpenWeather' });
  const res = await api.put('/api/settings', { openWeatherKey });
  if (!res) return;
  if (input) input.value = '';
  owm.test = null;
  if (res.openWeather && store.state && store.state.connections) store.state.connections.openWeather = res.openWeather;
  paint(root);
  toast('OpenWeather key saved on this computer.', { kind: 'ok', title: 'OpenWeather' });
}

async function removeOwm(root) {
  const res = await api.put('/api/settings', { removeOpenWeatherKey: true });
  if (!res) return;
  owm.test = null;
  if (res.openWeather && store.state && store.state.connections) store.state.connections.openWeather = res.openWeather;
  paint(root);
  toast('OpenWeather key removed.', { kind: 'ok', title: 'OpenWeather' });
}

async function testOwm(root) {
  const input = root.querySelector('#conn-owm-key');
  const typed = input ? input.value.trim() : '';
  if (typed) await saveOwm(root);
  owm.busy = true;
  paint(root);
  const res = await api.post('/api/owm/test', {});
  owm.busy = false;
  owm.test = res || { ok: false, ms: 0, error: 'the hub could not run the test' };
  paint(root);
}

/* ---------- regions ---------- */

function paint(root) {
  const state = store.state;
  if (!state || !root) return;
  const set = (name, node) => {
    const el = root.querySelector('[data-region="' + name + '"]');
    if (el) el.replaceChildren(...(Array.isArray(node) ? node : [node].filter(Boolean)));
  };
  set('tg-status', telegramStatus(state));
  set('tg-pair', telegramPair());
  set('phones-status', phonesStatus(state));
  set('phones-pair', phonesPair());
  set('relay-status', relayStatus());
  set('owm-status', owmStatus(state));
  set('brain-status', brainStatus(state));
}

function brainChoices(state) {
  if (!brain.pick) brain.pick = (state.connections && state.connections.brain && state.connections.brain.kind) || 'none';
  const keyRow = h('div', { class: 'conn-key', hidden: brain.pick !== 'api' },
    Field({ label: 'API key', id: 'conn-brain-key', desc: 'Stored on this computer. It is never shown again.', children:
      Input({ id: 'conn-brain-key', type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' }) }));
  return h('div', { class: 'conn-brain' },
    h('div', { class: 'conn-radios', role: 'radiogroup', 'aria-label': 'Brain' },
      BRAINS.map(([id, label, desc]) => h('label', { class: 'conn-radio' + (brain.pick === id ? ' selected' : '') },
        h('input', {
          type: 'radio',
          name: 'conn-brain',
          value: id,
          checked: brain.pick === id,
          dataset: { focusKey: 'brain-' + id },
          onchange: () => {
            brain.pick = id;
            keyRow.hidden = id !== 'api';
            // Move the selected highlight without re-rendering, so focus stays on the radio.
            keyRow.closest('.conn-brain').querySelectorAll('.conn-radio').forEach((l) => {
              l.classList.toggle('selected', l.querySelector('input').value === id);
            });
          }
        }),
        h('span', { class: 'conn-radio-text' },
          h('span', { class: 'conn-radio-title' }, label),
          h('span', { class: 'row-sub' }, desc))))),
    keyRow,
    h('div', { class: 'conn-actions' },
      Button({ label: 'Use this brain', variant: 'outline', size: 'sm', onClick: (e) => saveBrain(e.currentTarget.closest('.connections-page')) })));
}

/* ---------- page ---------- */

export default {
  id: 'connections',
  title: 'Connections',
  icon: 'plug',

  render(ctx) {
    const state = ctx.state;
    const tgInfo = (state.connections && state.connections.telegram) || {};
    const tgToken = Field({ label: 'Bot token', id: 'conn-tg-token', desc: 'From BotFather in Telegram. Stored on this computer and reconnected on every start. It is never shown again.', children:
      Input({ id: 'conn-tg-token', type: 'password', placeholder: tgInfo.hint ? tgInfo.hint + '. Paste a new token to replace it' : '123456:ABC...', autocomplete: 'off' }) });

    return h('div', { class: 'page connections-page' },
      PageHeader({ title: 'Connections', sub: 'Telegram, the phones in the family, and the brain that words alerts.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col conn-col' },
          h('section', { class: 'conn-card' },
            h('div', { class: 'conn-head' },
              h('div', { class: 'conn-head-titles' },
                h('h2', { class: 'conn-name' }, 'Telegram'),
                h('p', { class: 'row-sub' }, 'Send short alerts to family chats.')),
              h('div', { 'data-region': 'tg-status' }, telegramStatus(state))),
            tgToken,
            h('div', { class: 'conn-actions' },
              Button({ label: 'Save token', variant: 'outline', size: 'sm', onClick: (e) => saveTelegram(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Retry now', variant: 'outline', size: 'sm', onClick: (e) => retryTelegram(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Remove key', variant: 'outline', size: 'sm', onClick: (e) => removeTelegram(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Get pairing code', variant: 'outline', size: 'sm', onClick: (e) => getPairingCode(e.currentTarget.closest('.connections-page')) })),
            h('div', { 'data-region': 'tg-pair' }, telegramPair())),

          h('section', { class: 'conn-card' },
            h('div', { class: 'conn-head' },
              h('div', { class: 'conn-head-titles' },
                h('h2', { class: 'conn-name' }, 'Phones'),
                h('p', { class: 'row-sub' }, 'Family phones that get alerts and answer questions.')),
              h('div', { 'data-region': 'phones-status' }, phonesStatus(state))),
            h('p', { class: 'conn-text' },
              'Phones join through an invite. Invites are made per family member in Family, so each phone knows whose it is. ',
              h('a', { class: 'btn-link', href: '#family' }, 'Open Family')),
            h('div', { class: 'conn-actions' },
              Button({ label: 'Show pairing QR', variant: 'outline', size: 'sm', onClick: (e) => showPairingQr(e.currentTarget.closest('.connections-page')) })),
            h('div', { 'data-region': 'phones-pair' }, phonesPair()),
            Field({ label: 'Relay server', id: 'conn-relay-url', desc: 'The Beacon server the phones and this computer use, such as https://your-app.up.railway.app. Leave the default for a server on this computer.', children:
              Input({ id: 'conn-relay-url', value: (state.connections && state.connections.beacon && state.connections.beacon.relayUrl) || '', placeholder: 'https://beacon.example.org', autocomplete: 'off' }) }),
            h('div', { class: 'conn-actions' },
              Button({ label: 'Save relay', variant: 'outline', size: 'sm', onClick: (e) => saveRelay(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Check', variant: 'outline', size: 'sm', onClick: (e) => checkRelay(e.currentTarget.closest('.connections-page')) })),
            h('div', { 'data-region': 'relay-status' }, relayStatus())),

          h('section', { class: 'conn-card' },
            h('div', { class: 'conn-head' },
              h('div', { class: 'conn-head-titles' },
                h('h2', { class: 'conn-name' }, 'OpenWeather'),
                h('p', { class: 'row-sub' }, 'Detailed weather, forecast and air quality for your agents.')),
              h('div', { 'data-region': 'owm-status' }, owmStatus(state))),
            Field({ label: 'API key', id: 'conn-owm-key', desc: 'Free key from openweathermap.org (API keys tab). New keys can take up to 2 hours to activate. The key stays on this computer and is kept across restarts and updates.', children:
              Input({ id: 'conn-owm-key', type: 'password', placeholder: (state.connections && state.connections.openWeather && state.connections.openWeather.hint) ? state.connections.openWeather.hint + '. Paste a new key to replace it' : 'Paste your OpenWeather key', autocomplete: 'off' }) }),
            h('div', { class: 'conn-actions' },
              Button({ label: 'Save', variant: 'outline', size: 'sm', onClick: (e) => saveOwm(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Test', variant: 'outline', size: 'sm', onClick: (e) => testOwm(e.currentTarget.closest('.connections-page')) }),
              Button({ label: 'Remove key', variant: 'outline', size: 'sm', onClick: (e) => removeOwm(e.currentTarget.closest('.connections-page')) })),
            h('p', { class: 'field-desc' }, 'Unlocks these nodes: OpenWeather now, OpenWeather forecast, OpenWeather air quality (all work with a free key) and OpenWeather One Call (alerts and UV, needs the separate One Call by Call subscription).')),

          h('section', { class: 'conn-card' },
            h('div', { class: 'conn-head' },
              h('div', { class: 'conn-head-titles' },
                h('h2', { class: 'conn-name' }, 'Brain'),
                h('p', { class: 'row-sub' }, 'Optional. Words alerts in plain language.')),
              h('div', { 'data-region': 'brain-status' }, brainStatus(state))),
            h('div', { 'data-region': 'brain-form' }, brainChoices(state))))));
  },

  update(root, ctx) {
    paint(root);
  }
};
