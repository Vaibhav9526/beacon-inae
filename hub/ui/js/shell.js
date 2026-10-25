// Window shell: top row, card with sidebar / main / right panel, resizers, theme, approval dialog.
import { h, icon, Button, IconButton, Tabs, Chip, Dot, Avatar, EmptyState, Menu, openDialog, toast } from './ui.js';
import { api } from './api.js';
import { store } from './store.js';
import { openPalette } from './palette.js';
import { openNewAgentDialog, deleteAgentWithUndo } from './pages/agents.js';
import { NAV, avatarKey, agentLook, roleOf, lastRun, needsYou, agentStatus, SITUATION, GENRE_LABEL } from './model.js';

const LEFT_MIN = 128;
const LEFT_MAX = 400;
const LEFT_DEFAULT = 280;
const LEFT_COMPACT = 88;
const COLLAPSE_AT = 110;
const EXPAND_AT = 118;
const RIGHT_MIN = 240;
const RIGHT_MAX = 1600;
const RIGHT_DEFAULT = 296;

const KEYS = {
  leftWidth: 'beacon:left-panel-width',
  rightWidth: 'beacon:settings-panel-width',
  compact: 'beacon:left-compact',
  sideTab: 'beacon:side-tab',
  theme: 'beacon:theme'
};

/* ---------- localStorage (never throws) ---------- */

export const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : v;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (e) { /* private window: ignore */ }
  }
};

/* ---------- theme ---------- */

export function initTheme() {
  const t = LS.get(KEYS.theme, 'dark');
  document.documentElement.dataset.theme = ['dark', 'light', 'system'].includes(t) ? t : 'dark';
}

/** The light or dark look actually on screen, resolving 'system' through prefers-color-scheme. */
function effectiveTheme() {
  const mode = document.documentElement.dataset.theme;
  if (mode === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }
  return mode === 'light' ? 'light' : 'dark';
}

function paintThemeButton() {
  if (themeBtn) themeBtn.replaceChildren(icon(effectiveTheme() === 'light' ? 'moon' : 'sun', 14));
}

/** Sets the theme to 'dark' | 'light' | 'system', remembers it, and updates the topbar icon. */
export function setTheme(mode) {
  const next = ['dark', 'light', 'system'].includes(mode) ? mode : 'dark';
  document.documentElement.dataset.theme = next;
  LS.set(KEYS.theme, next);
  paintThemeButton();
}

export function toggleTheme() {
  setTheme(effectiveTheme() === 'light' ? 'dark' : 'light');
}

/* ---------- state held by the shell ---------- */

let els = null;
let themeBtn = null;
let connPill = null;
let lastRoute = { page: 'agents', id: null, query: {} };
let sheet = null;
let sheetId = null;
let panelState = { open: false };

/* ---------- mount ---------- */

/** Builds the shell into #app. Returns the elements the router renders into. */
export function mount() {
  const app = document.getElementById('app');
  const width = clampLeft(Number(LS.get(KEYS.leftWidth, LEFT_DEFAULT)) || LEFT_DEFAULT);
  const compact = LS.get(KEYS.compact, '0') === '1';

  themeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Switch theme', onclick: toggleTheme }, icon(effectiveTheme() === 'light' ? 'moon' : 'sun', 14));
  connPill = h('span', { class: 'pill muted', role: 'status', 'aria-live': 'polite' }, 'Connecting');
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-group' }, h('span', { class: 'topbar-title' }, 'Beacon Hub')),
    h('div', { class: 'topbar-group no-drag' },
      connPill,
      themeBtn,
      IconButton({ icon: 'settings', label: 'Settings (Ctrl+,)', onClick: () => go('#settings') })
    )
  );

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Agents and pages' });
  const resizerL = h('div', { class: 'resizer resizer-left', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize sidebar', tabindex: '-1' });
  const mainBody = h('div', { class: 'main-body', id: 'main-body' });
  const main = h('main', { class: 'main', id: 'main' }, mainBody);
  const resizerR = h('div', { class: 'resizer resizer-right', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize panel', tabindex: '-1', hidden: true });
  const panelTitle = h('div', { class: 'panel-title' });
  const panelBody = h('div', { class: 'panel-body' });
  const panel = h('aside', { class: 'panel-col', id: 'panel', 'aria-label': 'Side panel', hidden: true },
    h('div', { class: 'panel-head' }, panelTitle, IconButton({ icon: 'close', label: 'Close panel', onClick: () => closePanel() })),
    panelBody
  );
  const card = h('div', { class: 'card', id: 'card' }, sidebar, resizerL, main, resizerR, panel);
  card.style.setProperty('--left-w', (compact ? LEFT_COMPACT : width) + 'px');
  card.style.setProperty('--right-w', clampRight(Number(LS.get(KEYS.rightWidth, RIGHT_DEFAULT)) || RIGHT_DEFAULT) + 'px');
  sidebar.classList.toggle('compact', compact);

  app.replaceChildren(topbar, card);
  els = { app, card, sidebar, main, mainBody, resizerL, resizerR, panel, panelTitle, panelBody, leftWidth: width, compact };

  wireResizers();
  return els;
}

/* ---------- panel (right side) ---------- */

export const panel = {
  open(title, node) {
    if (!els) return;
    els.panelTitle.textContent = title || '';
    els.panelBody.replaceChildren(node || document.createTextNode(''));
    els.card.dataset.panel = 'open';
    els.resizerR.hidden = false;
    els.panel.hidden = false;
    panelState.open = true;
  },
  close() {
    closePanel();
  },
  isOpen() {
    return panelState.open;
  }
};

function closePanel() {
  if (!els) return;
  delete els.card.dataset.panel;
  els.resizerR.hidden = true;
  els.panel.hidden = true;
  panelState.open = false;
}

/* ---------- compact sidebar ---------- */

export function toggleCompact() {
  if (!els) return;
  const next = !els.compact;
  setCompact(next);
  LS.set(KEYS.compact, next ? '1' : '0');
}

function setCompact(on) {
  els.compact = on;
  els.sidebar.classList.toggle('compact', on);
  els.card.style.setProperty('--left-w', (on ? LEFT_COMPACT : els.leftWidth) + 'px');
}

/* ---------- resizers ---------- */

function clampLeft(w) {
  return Math.min(LEFT_MAX, Math.max(LEFT_MIN, w));
}

function clampRight(w) {
  return Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w));
}

function wireResizers() {
  drag(els.resizerL, (e, rect) => {
    const w = e.clientX - rect.left;
    if (w < COLLAPSE_AT) {
      if (!els.compact) setCompact(true);
    } else {
      if (els.compact && w >= EXPAND_AT) setCompact(false);
      if (!els.compact) {
        els.leftWidth = clampLeft(w);
        els.card.style.setProperty('--left-w', els.leftWidth + 'px');
      }
    }
  }, () => {
    LS.set(KEYS.compact, els.compact ? '1' : '0');
    if (!els.compact) LS.set(KEYS.leftWidth, els.leftWidth);
  });

  drag(els.resizerR, (e, rect) => {
    const w = clampRight(rect.right - e.clientX);
    els.card.style.setProperty('--right-w', w + 'px');
  }, () => {
    const cur = parseFloat(els.card.style.getPropertyValue('--right-w')) || RIGHT_DEFAULT;
    LS.set(KEYS.rightWidth, cur);
  });
}

function drag(handle, onMove, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    els.card.classList.add('resizing');
    const rect = els.card.getBoundingClientRect();
    const move = (ev) => onMove(ev, rect);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('active');
      els.card.classList.remove('resizing');
      onEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

/* ---------- navigation helper ---------- */

function go(hash) {
  if (location.hash === hash) return;
  location.hash = hash;
}

/* ---------- top row ---------- */

function renderTop(state) {
  if (!connPill) return;
  let tone = 'muted';
  let text = 'Connecting';
  if (api.online === false) {
    tone = 'danger';
    text = 'Hub unreachable';
  } else if (api.online === true && state) {
    tone = 'ok';
    const phones = phoneCount(state);
    text = 'Hub online' + (phones != null ? ' · ' + phones + (phones === 1 ? ' phone' : ' phones') : '');
  }
  connPill.className = 'pill ' + tone;
  connPill.replaceChildren(Dot({ state: tone === 'ok' ? 'ok' : tone === 'danger' ? 'bad' : 'asleep' }), text);
}

/** Paired phones: the hub's own count when given, else members that have a device. */
function phoneCount(state) {
  const paired = state && state.connections && state.connections.beacon ? state.connections.beacon.paired : null;
  if (typeof paired === 'number') return paired;
  const members = (state && state.group && state.group.members) || [];
  return members.filter((m) => m.deviceId).length;
}

/* ---------- sidebar ---------- */

/** Re-renders the sidebar from the latest state. */
function renderSidebar(state) {
  if (!els) return;
  const sideTab = LS.get(KEYS.sideTab, 'agents') === 'pages' ? 'pages' : 'agents';
  const route = lastRoute;

  const hubMenu = (e) => Menu({
    anchor: e.currentTarget,
    items: [
      { label: 'Refresh', icon: 'refresh', onClick: () => store.refresh() },
      { label: 'Toggle theme', icon: 'moon', onClick: toggleTheme },
      '-',
      { label: 'Settings', icon: 'settings', onClick: () => go('#settings') }
    ]
  });

  const head = h('div', { class: 'sb-head' },
    h('div', { class: 'sb-head-name' },
      Button({ label: 'Beacon Hub', icon: 'chevron-down', variant: 'ghost', size: 'sm', onClick: hubMenu, title: 'Hub menu' })),
    IconButton({ icon: 'vault', label: 'Vault (templates)', onClick: () => go('#vault') }),
    IconButton({
      icon: 'plus',
      label: 'New',
      onClick: (e) => Menu({
        anchor: e.currentTarget,
        items: [
          { label: 'New agent', icon: 'agents', onClick: () => openNewAgentDialog() },
          { label: 'Browse the School', icon: 'school', onClick: () => go('#school') }
        ]
      })
    })
  );

  const search = h('div', { class: 'sb-search' },
    h('button', {
      type: 'button',
      class: 'search-field',
      'aria-label': 'Search agents and pages (Ctrl+K)',
      onclick: () => openPalette()
    }, icon('search', 14), h('span', { class: 'search-label' }, 'Search'), h('span', { class: 'kbd search-kbd' }, 'Ctrl K')));

  const tabs = h('div', { class: 'sb-tabs' },
    Tabs({
      block: true,
      label: 'Sidebar view',
      value: sideTab,
      items: [{ id: 'agents', label: 'Agents' }, { id: 'pages', label: 'Pages' }],
      onChange: (v) => {
        LS.set(KEYS.sideTab, v);
        renderSidebar(store.state);
      }
    }));

  const list = h('div', { class: 'sb-list' }, sideTab === 'agents' ? agentGroups(state, route) : navList(route));

  const sit = (state && state.situation) || { phase: 'calm' };
  const info = SITUATION[sit.phase] || SITUATION.calm;
  const phones = phoneCount(state || {});
  const foot = h('div', { class: 'sb-foot' },
    h('span', { title: sit.headline || '' }, Chip({ label: info.label, tone: info.tone })),
    h('span', { class: 'foot-text small muted' }, (phones || 0) + (phones === 1 ? ' phone' : ' phones')));

  els.sidebar.replaceChildren(head, search, tabs, list, foot);
}

function agentGroups(state, route) {
  if (!state) return h('div', { class: 'empty compact' }, h('p', { class: 'empty-text' }, 'Loading...'));
  const agents = state.agents || [];
  if (!agents.length) {
    return EmptyState({
      compact: true,
      icon: 'agents',
      title: 'No agents yet',
      text: 'An agent watches one thing for your family and sends short alerts.',
      action: Button({ label: 'Create your first agent', size: 'sm', onClick: () => openNewAgentDialog() })
    });
  }
  const waiting = agents.filter((a) => needsYou(state, a));
  const rest = agents.filter((a) => !waiting.includes(a));
  const awake = rest.filter((a) => a.enabled);
  const resting = rest.filter((a) => !a.enabled);
  const groups = [
    ['Needs you', waiting],
    ['Awake', awake],
    ['Resting', resting]
  ];
  return h('div', null, groups.filter(([, list]) => list.length).map(([title, list]) =>
    h('div', { class: 'row-section' },
      h('div', { class: 'group-title side-label' }, title, h('span', { class: 'muted' }, String(list.length))),
      h('div', { class: 'group-list' }, list.map((a) => agentRow(state, a, route))))));
}

function agentRow(state, a, route) {
  const st = agentStatus(state, a);
  const r = lastRun(state, a.id);
  const selected = route.page === 'agents' && route.id === a.id;
  let chip = null;
  if (st === 'waiting') chip = h('span', { class: 'chip wait row-chip' }, icon('alert', 11), 'Needs you');
  else if (r) chip = Chip({ label: r.ok ? 'OK' : 'Failed', tone: r.ok ? 'ok' : 'danger' });
  else if (!a.enabled) chip = Chip({ label: 'Resting', tone: 'muted' });
  const preview = r ? r.message : a.enabled ? 'Watching ' + (GENRE_LABEL[a.genre] || 'things') : 'Resting';
  const dot = st === 'waiting' ? 'waiting' : st === 'bad' ? 'bad' : st === 'ok' ? 'ok' : null;
  const row = h('button', {
    type: 'button',
    class: 'row agent-row',
    'aria-pressed': selected ? 'true' : 'false',
    'aria-label': a.name + ', ' + roleOf(state, a) + ', ' + statusWord(st),
    title: a.name,
    onclick: () => go('#agents/' + a.id),
    oncontextmenu: (e) => {
      e.preventDefault();
      Menu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'Open', icon: 'agents', onClick: () => go('#agents/' + a.id) },
          { label: 'Settings', icon: 'settings', onClick: () => go('#agents/' + a.id + '?tab=settings') },
          '-',
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteAgentWithUndo(a) }
        ]
      });
    }
  },
    Avatar({ key: avatarKey(state, a), look: agentLook(state, a), size: 36, status: dot, asleep: !a.enabled }),
    h('div', { class: 'row-text' },
      h('div', { class: 'row-title' }, h('span', { class: 'row-title-name' }, a.name)),
      h('div', { class: 'row-sub' }, preview)),
    h('div', { class: 'row-end' }, chip));
  return row;
}

function statusWord(st) {
  return { waiting: 'needs you', bad: 'last run failed', ok: 'awake', asleep: 'resting' }[st] || st;
}

function navList(route) {
  return h('div', { class: 'nav-list' }, NAV.map((n) =>
    h('button', {
      type: 'button',
      class: 'nav-item',
      'aria-current': route.page === n.id ? 'page' : undefined,
      'aria-label': n.label,
      title: n.label,
      onclick: () => go('#' + n.id)
    }, icon(n.icon, 16), h('span', { class: 'nav-label' }, n.label))));
}

/* ---------- approval sheet (state.pending) ---------- */

function renderSheet(state) {
  const p = state && state.pending;
  if (!p) {
    if (sheet) {
      const s = sheet;
      sheet = null;
      sheetId = null;
      s.close();
    }
    return;
  }
  if (sheetId === p.id) return;
  if (sheet) sheet.close();
  sheetId = p.id;
  const answer = async (ans, dlg) => {
    dlg.setBusy(true);
    const d = await api.post('/api/approve', { id: p.id, answer: ans });
    dlg.setBusy(false);
    if (!d) return;
    toast(ans === 'no' ? 'Not sent' : ans === 'always' ? 'Sent, and always allowed' : 'Sent');
    dlg.close();
    store.refresh();
  };
  sheet = openDialog({
    persistent: true,
    icon: 'send',
    title: 'Send this message?',
    description: 'Beacon wants to send this short alert to your family channels.',
    width: 460,
    body: () => h('div', { class: 'stack' },
      h('blockquote', { class: 'quote' }, p.text),
      h('div', { class: 'row-inline' },
        h('span', { class: 'small muted' }, 'Goes to'),
        (p.channels || []).map((c) => Chip({ label: c, tone: 'outline' })))),
    actions: [
      { label: "Don't send", variant: 'ghost', keepOpen: true, onClick: (dlg) => answer('no', dlg) },
      { label: 'Always allow', variant: 'outline', keepOpen: true, onClick: (dlg) => answer('always', dlg) },
      { label: 'Send once', variant: 'primary', primary: true, keepOpen: true, onClick: (dlg) => answer('once', dlg) }
    ]
  });
}

/* ---------- render entry points ---------- */

/** Called by main.js on every state change and route change. */
export function renderAll(state, route) {
  if (!els) return;
  lastRoute = route;
  renderTop(state);
  renderSidebar(state);
  renderSheet(state);
}

/** Only the top-row status (online/offline changes do not need a full state). */
export function renderStatus() {
  renderTop(store.state);
}

/** Shell elements (main body, panel, card), or null before mount(). */
export function shellEls() {
  return els;
}

