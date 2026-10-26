// Gateway page: routes that decide which feed items reach which phones (spec 3.13, 6.4).
// The route draft and the try-an-item form live in module variables, because the shell re-renders the page
// on every state change. Local edits rebuild the page in place and keep focus where it was.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { severityLabel } from '../model.js';

const { h, Button, IconButton, Tabs, Switch, Chip, Dot, Field, Select, EmptyState, PageHeader, toast, confirmDialog, relTime, icon } = ui;

const KINDS = [
  ['news', 'News'], ['weather', 'Weather'], ['wind', 'Wind'], ['quake', 'Earthquake'], ['flood', 'Flood'],
  ['alert', 'Official alert'], ['health', 'Health'], ['supply', 'Supply'], ['advisory', 'Advisory'],
  ['chat', 'Group chat'], ['custom', 'Custom']
];
const KIND_LABEL = Object.fromEntries(KINDS);
const SEVS = ['info', 'watch', 'warning', 'severe'];
const RANK = { info: 0, watch: 1, warning: 2, severe: 3 };
const SEV_TONE = { info: 'muted', watch: 'accent', warning: 'warn', severe: 'danger' };
const ROLES = ['adult', 'elder', 'child'];
const ROLE_LABEL = { adult: 'Adults', elder: 'Elders', child: 'Children' };
const MIN_TABS = [{ id: 'any', label: 'Any level' }].concat(SEVS.map((s) => ({ id: s, label: severityLabel(s) })));
const NOTIFY_TABS = SEVS.map((s) => ({ id: s, label: severityLabel(s) }));
const DELIVER_TABS = [{ id: 'instant', label: 'Instant' }, { id: 'digest', label: 'Digest' }];
const PERIODS = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [180, '3 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '24 hours']];

/** Short chip text for a route's delivery: "Instant" or "Every 1 h". */
function deliverLabel(r) {
  const d = r.deliver;
  if (!d || d.mode !== 'digest') return 'Instant';
  const n = d.everyMin || 60;
  return 'Every ' + (n % 60 === 0 ? n / 60 + ' h' : n + ' min');
}

/** "Next in 12 min" / "Due now" / "Waiting for the first item". */
function nextText(d, now) {
  if (!d.nextAt) return 'Waiting for the first item';
  const m = Math.ceil((d.nextAt - now) / 60000);
  if (m <= 0) return d.queued ? 'Due now' : 'No items waiting';
  return 'Next in ' + (m >= 120 ? Math.round(m / 60) + ' h' : m + ' min');
}

// gw.routes: the draft. gw.base: JSON of the last saved list. gw.seen: JSON of the last server list seen.
const gw = {
  routes: [], base: '', seen: '', selected: null, initialised: false,
  probe: { kind: 'flood', severity: 'warning', agentId: '', tags: 'rain' },
  probeResult: null,
  tgPreview: false
};
let root = null;
let ctx = null;

const clone = (v) => JSON.parse(JSON.stringify(v));
const newId = (p) => (p || 'rt') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function syncDraft(state) {
  const saved = (state.gateway && state.gateway.routes) || [];
  const cur = JSON.stringify(saved);
  if (!gw.initialised) {
    gw.routes = clone(saved); gw.base = cur; gw.seen = cur; gw.initialised = true;
  } else if (cur !== gw.seen) {
    gw.seen = cur;
    if (JSON.stringify(gw.routes) === gw.base) { gw.routes = clone(saved); gw.base = cur; }
  }
  if (!gw.routes.some((r) => r.id === gw.selected)) gw.selected = gw.routes[0] ? gw.routes[0].id : null;
}

const isDirty = () => JSON.stringify(gw.routes) !== gw.base;

/* ---------- matching (client side, against the saved routes) ---------- */

function routeMatches(r, item) {
  if (r.enabled === false) return false;
  const m = r.match || {};
  if (m.kinds && m.kinds.length && !m.kinds.includes(item.kind)) return false;
  if (m.agents && m.agents.length && !m.agents.includes(item.agentId)) return false;
  if (m.tags && m.tags.length && !(item.tags || []).some((t) => m.tags.includes(t))) return false;
  if (m.minSeverity && RANK[item.severity] < RANK[m.minSeverity]) return false;
  return true;
}

/** Routes an item takes, in order: stops after the first route that does not keep matching. */
function routesFor(item, routes) {
  const out = [];
  for (const r of routes) {
    if (!routeMatches(r, item)) continue;
    out.push(r);
    if (!r.continue) break;
  }
  return out;
}

function describeTo(to) {
  to = to || {};
  const parts = [];
  if (to.phones === 'all') parts.push('All phones');
  else {
    const roles = (to.roles || []).map((x) => ROLE_LABEL[x] || x);
    if (roles.length) parts.push(roles.join(', '));
    if ((to.members || []).length) parts.push((to.members || []).length + (to.members.length === 1 ? ' member' : ' members'));
  }
  if (to.telegram) parts.push('Telegram');
  return parts.length ? parts.join(' + ') : 'No one';
}

const reaches = (to) => !!(to && (to.phones === 'all' || (to.roles || []).length || (to.members || []).length || to.telegram));

function memberName(state, x) {
  const m = ((state.group && state.group.members) || []).find((mm) => mm.id === x || mm.name === x);
  return m ? m.name : x;
}

/* ---------- page ---------- */

export default {
  id: 'gateway',
  title: 'Gateway',
  icon: 'gateway',

  render(c) {
    ctx = c;
    syncDraft(c.state);
    root = build();
    return root;
  }
};

function pathOf(el, top) {
  const p = [];
  let n = el;
  while (n && n !== top) {
    const par = n.parentNode;
    if (!par) return null;
    p.unshift(Array.prototype.indexOf.call(par.children, n));
    n = par;
  }
  return n === top ? p : null;
}

function atPath(top, p) {
  let n = top;
  for (const i of p) n = n && n.children[i];
  return n || null;
}

/** Rebuilds the page in place. selector: element to focus afterwards (default: the element that had focus). */
function rebuild(selector) {
  if (!root || !ctx) return;
  const active = document.activeElement;
  const path = active && active !== root && root.contains(active) ? pathOf(active, root) : null;
  const sc0 = root.querySelector('.scroll');
  const top = sc0 ? sc0.scrollTop : 0;
  const fresh = build();
  root.replaceChildren(...[...fresh.childNodes]);
  const sc = root.querySelector('.scroll');
  if (sc) sc.scrollTop = top;
  let target = selector ? root.querySelector(selector) : null;
  if (!target && path) target = atPath(root, path);
  if (target && target.focus) target.focus({ preventScroll: true });
}

function build() {
  const state = ctx.state;
  const dirty = isDirty();
  const page = h('div', { class: 'page gw-page' },
    PageHeader({
      title: 'Gateway',
      sub: 'Which items reach which phones',
      actions: [
        h('span', { class: 'gw-dirty', role: 'status' }, Dot({ state: dirty ? 'waiting' : 'ok' }), dirty ? 'Unsaved changes' : 'All saved'),
        Button({ label: 'Send a test to all phones', icon: 'send', variant: 'outline', size: 'sm', onClick: sendTest }),
        Button({ label: 'Save', size: 'sm', disabled: !dirty, onClick: save })
      ]
    }),
    h('div', { class: 'scroll' },
      h('div', { class: 'col gw-col' },
        h('p', { class: 'gw-hint' }, 'Routes are checked from top to bottom. The first route that matches an item decides who gets it, unless that route is set to keep matching. Paused routes are skipped.'),
        h('div', { class: 'gw-layout' },
          listPanel(),
          gw.routes.length ? editorPanel(gw.routes.find((r) => r.id === gw.selected) || gw.routes[0]) : h('section', { class: 'gw-editor' }, EmptyState({ icon: 'gateway', title: 'No routes yet', text: 'Add a route to decide which items reach the phones.', compact: true }))),
        digestPanel(state),
        tryPanel(state),
        recentPanel(state))));
  return page;
}

/* ---------- route list ---------- */

function listPanel() {
  const rows = gw.routes.map((r, i) => routeRow(r, i));
  return h('section', { class: 'gw-list', 'aria-label': 'Routes' },
    h('div', { class: 'gw-list-head' },
      h('h2', { class: 'gw-h' }, 'Routes'),
      Button({ label: 'Add route', icon: 'plus', variant: 'outline', size: 'sm', dataset: { focusKey: 'add-route' }, onClick: addRoute })),
    gw.routes.length ? h('div', { class: 'gw-rows', role: 'list' }, rows) : null);
}

function routeRow(r, i) {
  const on = r.enabled !== false;
  const sel = r.id === gw.selected;
  const m = r.match || {};
  const chips = [
    Chip({ label: m.kinds && m.kinds.length ? m.kinds.map((k) => KIND_LABEL[k] || k).join(', ') : 'Any kind', tone: 'outline' }),
    Chip({ label: m.minSeverity ? severityLabel(m.minSeverity) + ' and up' : 'Any level', tone: 'muted' }),
    Chip({ label: describeTo(r.to), tone: r.to && r.to.phones === 'all' ? 'accent' : 'outline' }),
    Chip({ label: deliverLabel(r), tone: r.deliver && r.deliver.mode === 'digest' ? 'accent' : 'muted' })
  ];
  return h('div', { class: 'gw-row' + (on ? '' : ' paused') + (sel ? ' selected' : ''), role: 'listitem' },
    h('button', {
      type: 'button',
      class: 'gw-row-main',
      'aria-pressed': sel ? 'true' : 'false',
      dataset: { focusKey: 'row-' + r.id },
      onclick: () => { gw.selected = r.id; rebuild(); },
      onkeydown: (e) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          move(i, i + (e.key === 'ArrowUp' ? -1 : 1));
        }
      }
    },
    h('span', { class: 'gw-row-name' }, r.name || 'Untitled route'),
    h('span', { class: 'gw-row-chips' }, chips)),
    Switch({
      small: true,
      checked: on,
      label: 'Route on: ' + (r.name || 'Untitled route'),
      onChange: (v) => { r.enabled = v; rebuild(); }
    }));
}

/* ---------- editor ---------- */

function labeled(label, children, desc) {
  return Field({ label, desc, children });
}

function chipSet(items, selected, onChange, disabled) {
  return h('div', { class: 'gw-chips', role: 'group' }, items.map(([v, text]) => {
    const on = selected.includes(v);
    return h('button', {
      type: 'button',
      class: 'gw-chip',
      'aria-pressed': on ? 'true' : 'false',
      disabled: !!disabled,
      onclick: () => onChange(on ? selected.filter((x) => x !== v) : selected.concat([v]))
    }, text);
  }));
}

function setList(obj, key, next) {
  if (next.length) obj[key] = next;
  else delete obj[key];
  rebuild();
}

function editorPanel(r) {
  const state = ctx.state;
  const idx = gw.routes.indexOf(r);
  const n = gw.routes.length;
  const members = (state.group && state.group.members) || [];
  const agents = state.agents || [];
  const to = r.to || (r.to = { phones: 'none' });
  const m = r.match || (r.match = {});
  const allPhones = to.phones === 'all';

  const nameInput = h('input', {
    class: 'input gw-name',
    id: 'gw-name',
    name: 'gw-name',
    value: r.name || '',
    'aria-label': 'Route name',
    oninput: (e) => { r.name = e.target.value; },
    onchange: () => rebuild()
  });

  const head = h('div', { class: 'gw-ed-head' },
    h('div', { class: 'gw-ed-name' }, h('label', { class: 'field-label', htmlFor: 'gw-name' }, 'Route name'), nameInput),
    h('div', { class: 'gw-ed-actions' },
      IconButton({ icon: 'chevron-up', label: 'Move route up', disabled: idx === 0, onClick: () => move(idx, idx - 1) }),
      IconButton({ icon: 'chevron-down', label: 'Move route down', disabled: idx === n - 1, onClick: () => move(idx, idx + 1) }),
      Button({ label: 'Duplicate', icon: 'plus', variant: 'outline', size: 'sm', onClick: () => duplicate(idx) }),
      Button({ label: 'Delete', icon: 'trash', variant: 'destructive', size: 'sm', onClick: () => removeRoute(idx) })),
    h('div', { class: 'gw-ed-on' },
      Switch({ checked: r.enabled !== false, label: 'Route on', onChange: (v) => { r.enabled = v; rebuild(); } }),
      h('span', null, r.enabled !== false ? 'Active' : 'Paused')));

  const matchSec = h('section', { class: 'gw-section' },
    h('h3', { class: 'gw-h3' }, 'Match'),
    labeled('Kinds', chipSet(KINDS, m.kinds || [], (next) => setList(m, 'kinds', next)), 'Empty means any kind.'),
    labeled('Agents', chipSet(agents.map((a) => [a.id, a.name]), m.agents || [], (next) => setList(m, 'agents', next)), 'Empty means any agent.'),
    labeled('Tags', textInput('gw-tags', (m.tags || []).join(', '), 'rain, heat', (v) => { m.tags = splitList(v); }), 'Any one of these tags matches. Separate with commas.'),
    labeled('Minimum severity', Tabs({
      label: 'Minimum severity',
      items: MIN_TABS,
      value: m.minSeverity || 'any',
      onChange: (v) => { if (v === 'any') delete m.minSeverity; else m.minSeverity = v; rebuild(); }
    })));

  const recipSec = h('section', { class: 'gw-section' },
    h('h3', { class: 'gw-h3' }, 'Recipients'),
    labeled('Who gets it', Tabs({
      label: 'Who gets it',
      items: [{ id: 'all', label: 'All phones' }, { id: 'none', label: 'No phones' }],
      value: allPhones ? 'all' : 'none',
      onChange: (v) => { to.phones = v; rebuild(); }
    }), allPhones ? 'Every paired phone gets the item. The roles and members below are ignored.' : 'Only the roles, members and Telegram picked below get the item.'),
    labeled('Roles', chipSet(ROLES.map((x) => [x, ROLE_LABEL[x]]), to.roles || [], (next) => setList(to, 'roles', next), allPhones)),
    labeled('Members', members.length
      ? chipSet(members.map((mm) => [mm.id, mm.name + ' (' + mm.role + ')']), to.members || [], (next) => setList(to, 'members', next), allPhones)
      : h('p', { class: 'gw-probe-text' }, 'No family members yet.')),
    h('div', { class: 'gw-toggle-row' },
      h('span', { class: 'gw-toggle-text' },
        h('span', { class: 'gw-toggle-label' }, 'Also send to Telegram'),
        h('span', { class: 'gw-toggle-desc' }, 'Posts the item to the family Telegram group.')),
      Switch({ checked: !!to.telegram, label: 'Also send to Telegram', onChange: (v) => { to.telegram = v; rebuild(); } })),
    reaches(to) ? null : h('p', { class: 'gw-warn', role: 'status' }, 'This route reaches nobody. Pick a role, a member or Telegram.'));

  const notifySec = h('section', { class: 'gw-section' },
    h('h3', { class: 'gw-h3' }, 'Notify'),
    labeled('Notify from', Tabs({
      label: 'Notify from',
      items: NOTIFY_TABS,
      value: r.notifyFrom || 'warning',
      onChange: (v) => { r.notifyFrom = v; rebuild(); }
    }), 'Phones buzz for items at this level and up. Other items only show in the feed.'),
    h('div', { class: 'gw-toggle-row' },
      h('span', { class: 'gw-toggle-text' },
        h('span', { class: 'gw-toggle-label' }, 'Keep matching after this route'),
        h('span', { class: 'gw-toggle-desc' }, 'Later routes also get the item, so one item can reach several groups.')),
      Switch({ checked: !!r.continue, label: 'Keep matching after this route', onChange: (v) => { r.continue = v; rebuild(); } })));

  const digest = !!r.deliver && r.deliver.mode === 'digest';
  const everyMin = (r.deliver && r.deliver.everyMin) || 60;
  const periodOpts = PERIODS.some((p) => p[0] === everyMin) ? PERIODS : PERIODS.concat([[everyMin, everyMin + ' min']]);
  const deliverSec = h('section', { class: 'gw-section' },
    h('h3', { class: 'gw-h3' }, 'Delivery'),
    labeled('When to send', Tabs({
      label: 'When to send',
      items: DELIVER_TABS,
      value: digest ? 'digest' : 'instant',
      onChange: (v) => { r.deliver = v === 'digest' ? { mode: 'digest', everyMin } : { mode: 'instant' }; rebuild(); }
    }), digest
      ? 'Matching items are collected and sent together as one update. Severe items still go out right away.'
      : 'Each matching item is sent as soon as it arrives.'),
    digest ? labeled('Send one update every', Select({
      id: 'gw-every',
      value: everyMin,
      options: periodOpts,
      onChange: (v) => { r.deliver = { mode: 'digest', everyMin: Number(v) }; rebuild(); }
    })) : null,
    digest ? h('div', { class: 'row-inline gw-actions' },
      Button({ label: 'Send digest now', icon: 'send', variant: 'outline', size: 'sm', onClick: () => flushNow(r) }),
      Button({ label: 'Preview Telegram post', icon: 'search', variant: 'outline', size: 'sm', onClick: () => { gw.tgPreview = !gw.tgPreview; rebuild(); } })) : null,
    digest && gw.tgPreview ? telegramPreview(r) : null);

  return h('section', { class: 'gw-editor', 'aria-label': 'Route editor' }, head, matchSec, recipSec, deliverSec, notifySec);
}

/** Sends the queued items of a saved digest route now. The endpoint is POST /api/gateway/flush. */
async function flushNow(r) {
  if (isDirty()) { toast('Save the routes first, then send the digest', { kind: 'info' }); return; }
  try {
    const out = await api.post('/api/gateway/flush', { routeId: r.id }, { throws: true });
    const f = ((out && out.flushed) || []).find((x) => x.routeId === r.id);
    toast(f ? 'Digest sent: ' + f.items + (f.items === 1 ? ' item' : ' items') : 'Nothing is waiting to be sent', { kind: f ? 'ok' : 'info' });
  } catch (err) {
    const msg = String(err && err.message || '');
    toast(/404|not found/i.test(msg) ? 'This hub version cannot send digests yet. Update the hub.' : msg || 'Could not send the digest', { kind: 'err' });
  }
}

/* ---------- Telegram preview (client side, structure only) ---------- */

const SECTION_ORDER = ['Alerts', 'Weather now', 'Next 24 hours', 'Wind', 'Rain and flood', 'Air quality', 'Quakes', 'Other updates', 'News headlines'];
const DATA_LABEL = {
  temp_c: ['Temperature', ' C'], feels_like_c: ['Feels like', ' C'], humidity_pct: ['Humidity', '%'], wind_kmh: ['Wind', ' km/h'],
  wind_gust_kmh: ['Gusts', ' km/h'], rain_mm_24h: ['Rain in 24 h', ' mm'], rain_mm_3h: ['Rain in 3 h', ' mm'], rain_mm_now: ['Rain now', ' mm'],
  uv_index: ['UV index', ''], aqi: ['AQI', ''], pm25: ['PM2.5', ' ug/m3']
};

function sectionOf(it) {
  const tags = it.tags || [];
  if (it.kind === 'alert') return 'Alerts';
  if (tags.includes('forecast')) return 'Next 24 hours';
  if (it.kind === 'wind') return 'Wind';
  if (it.kind === 'flood') return 'Rain and flood';
  if (it.kind === 'quake') return 'Quakes';
  if (it.kind === 'news') return 'News headlines';
  if (it.data && ('aqi' in it.data || 'pm25' in it.data)) return 'Air quality';
  if (it.kind === 'weather') return 'Weather now';
  return 'Other updates';
}

function dataText(data) {
  return Object.entries(data || {}).map(([k, v]) => {
    const d = DATA_LABEL[k];
    return d ? d[0] + ' ' + v + d[1] : k.replace(/_/g, ' ') + ' ' + v;
  }).join(', ');
}

function telegramPreview(r) {
  const feed = (ctx.state.feed || []).filter((it) => routeMatches(Object.assign({}, r, { enabled: true }), it)).slice(0, 8);
  const items = feed.length ? feed : (ctx.state.feed || []).slice(0, 5);
  const every = (r.deliver && r.deliver.everyMin) || 60;
  const kids = [h('div', { class: 'gw-tg-title' }, r.name || 'Update'), h('div', { class: 'gw-tg-meta' }, new Date().toLocaleString())];
  if (!items.length) kids.push(h('p', { class: 'gw-probe-text' }, 'No recent items to show yet.'));
  for (const name of SECTION_ORDER) {
    const group = items.filter((it) => sectionOf(it) === name).sort((a, b) => RANK[b.severity] - RANK[a.severity]);
    if (!group.length) continue;
    kids.push(h('div', { class: 'gw-tg-head' }, name));
    for (const it of group) {
      const nums = dataText(it.data);
      const text = String(it.detail || it.body || '').slice(0, 600);
      kids.push(h('div', { class: 'gw-tg-item' },
        h('b', null, it.title), it.severity !== 'info' ? ' (' + severityLabel(it.severity) + ')' : '',
        nums ? h('div', null, nums) : null,
        text ? h('div', { class: 'gw-tg-text' }, text) : null));
    }
  }
  kids.push(h('div', { class: 'gw-tg-meta' }, 'Sent by Beacon Hub. Next update in ' + every + ' min.'));
  return h('div', { class: 'gw-tg', role: 'region', 'aria-label': 'Telegram post preview' },
    h('p', { class: 'gw-probe-text' }, 'Preview only, built from your latest items. The real post is formatted by the hub.'), ...kids);
}

/* ---------- digest status ---------- */

function digestPanel(state) {
  const list = (state.gateway && state.gateway.digests) || [];
  if (!list.length) return null;
  const now = Date.now();
  return h('section', { class: 'gw-panel', 'aria-labelledby': 'gw-digest-h' },
    h('h2', { class: 'gw-h', id: 'gw-digest-h' }, 'Digest status'),
    h('p', { class: 'gw-sub' }, 'Routes that send one update on a timer.'),
    h('ul', { class: 'gw-feed' }, list.map((d) => h('li', { class: 'gw-feed-row gw-digest-row' },
      Chip({ label: deliverLabel({ deliver: { mode: 'digest', everyMin: d.everyMin } }), tone: 'accent' }),
      h('div', { class: 'gw-feed-text' },
        h('div', { class: 'gw-feed-title' }, d.name),
        h('div', { class: 'gw-feed-meta' }, d.queued + (d.queued === 1 ? ' item waiting' : ' items waiting') + ' · ' + nextText(d, now) + (d.lastFlush ? ' · last sent ' + relTime(d.lastFlush) : ''))),
      Button({ label: 'Send digest now', icon: 'send', variant: 'outline', size: 'sm', disabled: isDirty(), onClick: () => flushNow({ id: d.routeId }) })))));
}

/** A text input that writes to the draft as you type and rebuilds (for the dirty mark) when it commits. */
function textInput(id, value, placeholder, set) {
  return h('input', {
    class: 'input',
    id,
    name: id,
    value,
    placeholder,
    autocomplete: 'off',
    oninput: (e) => set(e.target.value),
    onchange: () => rebuild()
  });
}

function move(i, j) {
  if (i < 0 || j < 0 || j >= gw.routes.length || i >= gw.routes.length) return;
  const [x] = gw.routes.splice(i, 1);
  gw.routes.splice(j, 0, x);
  rebuild('[data-focus-key="row-' + x.id + '"]');
}

function duplicate(i) {
  const copy = clone(gw.routes[i]);
  copy.id = newId();
  copy.name = (gw.routes[i].name || 'Route') + ' copy';
  gw.routes.splice(i + 1, 0, copy);
  gw.selected = copy.id;
  rebuild('#gw-name');
}

async function removeRoute(i) {
  const r = gw.routes[i];
  if (!r) return;
  const ok = await confirmDialog({
    title: 'Delete this route?',
    text: '"' + (r.name || 'Untitled route') + '" will stop sending items the next time you save.',
    confirmLabel: 'Delete route',
    danger: true,
    icon: 'trash'
  });
  if (!ok) return;
  gw.routes.splice(i, 1);
  const next = gw.routes[i] || gw.routes[i - 1];
  gw.selected = next ? next.id : null;
  rebuild();
}

function addRoute() {
  const r = { id: newId(), name: 'New route', enabled: true, match: {}, to: { phones: 'none', roles: ['adult'] }, notifyFrom: 'warning', continue: false };
  gw.routes.push(r);
  gw.selected = r.id;
  rebuild('#gw-name');
}

async function save() {
  const seenBefore = JSON.stringify((ctx.state.gateway && ctx.state.gateway.routes) || []);
  const out = await api.put('/api/gateway/routes', { routes: gw.routes });
  if (!out) return;
  const saved = out.routes || gw.routes;
  gw.routes = clone(saved);
  gw.base = JSON.stringify(saved);
  gw.seen = seenBefore;
  toast('Routes saved', { kind: 'ok' });
  rebuild();
}

async function sendTest() {
  const out = await api.post('/api/gateway/send-test', {});
  if (!out) return;
  const n = out.delivered || 0;
  toast(n ? 'Test sent to ' + n + (n === 1 ? ' phone' : ' phones') : 'No phones are paired yet', { kind: n ? 'ok' : 'info' });
}

/* ---------- try an item ---------- */

function tryPanel(state) {
  const p = gw.probe;
  const agents = state.agents || [];
  const agentOpts = [['', agents.length ? 'First agent' : 'No agents']].concat(agents.map((a) => [a.id, a.name]));
  return h('section', { class: 'gw-panel', 'aria-labelledby': 'gw-try-h' },
    h('h2', { class: 'gw-h', id: 'gw-try-h' }, 'Try an item'),
    h('p', { class: 'gw-sub' }, 'Describe an item. Nothing is sent.'),
    h('div', { class: 'gw-probe-grid' },
      Field({ label: 'Kind', id: 'gw-p-kind', children: Select({ id: 'gw-p-kind', value: p.kind, options: KINDS, onChange: (v) => { p.kind = v; } }) }),
      Field({ label: 'Severity', id: 'gw-p-sev', children: Select({ id: 'gw-p-sev', value: p.severity, options: SEVS.map((s) => [s, severityLabel(s)]), onChange: (v) => { p.severity = v; } }) }),
      Field({ label: 'Agent', id: 'gw-p-agent', children: Select({ id: 'gw-p-agent', value: p.agentId, options: agentOpts, onChange: (v) => { p.agentId = v; } }) }),
      Field({ label: 'Tags', id: 'gw-p-tags', children: h('input', { class: 'input', id: 'gw-p-tags', name: 'gw-p-tags', value: p.tags, placeholder: 'rain, flood', autocomplete: 'off', oninput: (e) => { p.tags = e.target.value; } }) })),
    h('div', { class: 'row-inline' }, Button({ label: 'Check route', icon: 'search', variant: 'outline', size: 'sm', onClick: checkProbe })),
    h('div', { class: 'gw-probe-out', role: 'status', 'aria-live': 'polite' }, probeOutput(state)));
}

async function checkProbe() {
  const p = gw.probe;
  const agents = ctx.state.agents || [];
  const agent = agents.find((a) => a.id === p.agentId) || agents[0] || null;
  const item = {
    kind: p.kind,
    severity: p.severity,
    agentId: agent ? agent.id : '',
    agentName: agent ? agent.name : '',
    title: 'Test item',
    body: '',
    tags: splitList(p.tags),
    at: Date.now()
  };
  const out = await api.post('/api/gateway/preview', { item });
  if (!out) return;
  gw.probeResult = out.matches || [];
  rebuild();
}

function probeOutput(state) {
  const list = gw.probeResult;
  if (!list) return h('p', { class: 'gw-probe-text' }, 'Check an item to see which route takes it.');
  if (!list.length) return h('p', { class: 'gw-probe-text' }, 'No route matches. Nothing is sent to phones.');
  return h('ol', { class: 'gw-probe-list' }, list.map((mt, i) => {
    const names = (mt.recipients || []).map((x) => memberName(state, x));
    const who = [names.length ? names.join(', ') : 'no phones'];
    if (mt.telegram) who.push('Telegram');
    return h('li', { class: 'gw-probe-item' },
      h('div', { class: 'gw-probe-head' },
        h('span', null, mt.routeName),
        Chip({ label: i === 0 ? 'Decides' : 'Also matches', tone: i === 0 ? 'accent' : 'outline' })),
      h('div', { class: 'gw-probe-text' },
        'Goes to ' + who.join(' and ') + '. ' + (mt.notify ? 'The phone buzzes.' : 'No buzz, feed only.')));
  }));
}

/* ---------- recent items ---------- */

function recentPanel(state) {
  const routes = (state.gateway && state.gateway.routes) || [];
  const feed = (state.feed || []).slice(0, 8);
  return h('section', { class: 'gw-panel', 'aria-labelledby': 'gw-recent-h' },
    h('h2', { class: 'gw-h', id: 'gw-recent-h' }, 'Recent items'),
    h('p', { class: 'gw-sub' }, 'Each item with the route it takes, from the saved routes.'),
    feed.length
      ? h('ul', { class: 'gw-feed' }, feed.map((item) => feedRow(item, routes)))
      : h('p', { class: 'gw-probe-text' }, 'No items yet.'));
}

function feedRow(item, routes) {
  const hits = routesFor(item, routes);
  const first = hits[0];
  const buzz = !!first && RANK[item.severity] >= RANK[first.notifyFrom || 'warning'];
  const routeText = first
    ? h('span', null, first.name + (hits.length > 1 ? ' +' + (hits.length - 1) + ' more' : ''), buzz ? h('span', { class: 'buzz' }, ' · buzzes') : null)
    : h('span', null, 'No route, feed only');
  return h('li', { class: 'gw-feed-row' },
    Chip({ label: severityLabel(item.severity), tone: SEV_TONE[item.severity] || 'muted' }),
    h('div', { class: 'gw-feed-text' },
      h('div', { class: 'gw-feed-title' }, item.title),
      h('div', { class: 'gw-feed-meta' }, (KIND_LABEL[item.kind] || item.kind) + ' · ' + (item.agentName || 'Agent') + ' · ' + relTime(item.at))),
    h('div', { class: 'gw-feed-route' }, routeText));
}
