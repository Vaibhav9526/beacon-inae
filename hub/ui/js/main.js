// Boot, token, theme, hash router, global shortcuts. Pages are registered in PAGES below.
import * as ui from './ui.js';
import { api } from './api.js';
import { store } from './store.js';
import * as shell from './shell.js';
import { openPalette } from './palette.js';
import agents from './pages/agents.js';
import school from './pages/school.js';
import vault from './pages/vault.js';
import nodes from './pages/nodes.js';
import gateway from './pages/gateway.js';
import family from './pages/family.js';
import mcp from './pages/mcp.js';
import health from './pages/health.js';
import activity from './pages/activity.js';
import connections from './pages/connections.js';
import settings from './pages/settings.js';

const PAGES = { agents, school, vault, nodes, gateway, family, mcp, health, activity, connections, settings };

const TOKEN_KEY = 'beaconHubToken';

/* ---------- router ---------- */

/** "#agents/<id>?tab=rules" -> { page, id, query }. Unknown pages fall back to agents. */
export function parseRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [pathPart, qs = ''] = raw.split('?');
  const parts = pathPart.split('/');
  const page = PAGES[parts[0]] ? parts[0] : 'agents';
  const id = parts.slice(1).join('/') || null;
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { page, id, query, hash: '#' + raw };
}

/** Navigate to a hash such as '#agents/abc?tab=rules'. Same-hash navigations are ignored. */
export function go(hash) {
  if (location.hash === hash) return;
  location.hash = hash;
}

/* ---------- main pane render ---------- */

function makeCtx(route, state) {
  return {
    state,
    route,
    id: route.id,
    query: route.query,
    api,
    ui,
    el: ui.h,
    nav: go,
    toast: ui.toast,
    openDialog: ui.openDialog,
    confirm: ui.confirmDialog,
    refresh: () => store.refresh(),
    panel: shell.panel,
    palette: openPalette,
    store
  };
}

function captureFocus(body) {
  const ae = document.activeElement;
  if (!ae || ae === document.body || !body.contains(ae)) return null;
  return {
    id: ae.id || '',
    name: ae.getAttribute('name') || '',
    key: ae.dataset ? ae.dataset.focusKey || '' : '',
    start: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
    end: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null
  };
}

function restoreFocus(body, f) {
  if (!f) return;
  let el = null;
  if (f.id) el = body.querySelector('[id="' + cssEscape(f.id) + '"]');
  if (!el && f.name) el = body.querySelector('[name="' + cssEscape(f.name) + '"]');
  if (!el && f.key) el = body.querySelector('[data-focus-key="' + cssEscape(f.key) + '"]');
  if (!el) return;
  el.focus({ preventScroll: true });
  if (f.start != null && el.setSelectionRange) {
    try { el.setSelectionRange(f.start, f.end); } catch (e) { /* input types without selection */ }
  }
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

function errorView(err) {
  console.error(err);
  return ui.EmptyState({
    icon: 'alert',
    title: 'This page hit a problem',
    text: String(err && err.message ? err.message : err),
    action: ui.Button({ label: 'Reload', variant: 'outline', size: 'sm', onClick: () => location.reload() })
  });
}

let lastKey = null;

function renderMain(route) {
  const els = shell.shellEls();
  if (!els) return;
  const body = els.mainBody;
  const state = store.state;
  const key = route.page + '|' + (route.id || '');

  if (!state) {
    const offline = api.online === false;
    body.replaceChildren(offline
      ? ui.EmptyState({
          icon: 'alert',
          title: "Can't reach the hub",
          text: 'The hub is not answering. Check that it is running on this computer, then try again.',
          action: ui.Button({ label: 'Try again', size: 'sm', onClick: () => store.refresh() })
        })
      : ui.Loading());
    body.dataset.key = '';
    lastKey = null;
    return;
  }

  const mod = PAGES[route.page];
  const ctx = makeCtx(route, state);
  const sameKey = body.dataset.key === key;
  const scrollEl = body.querySelector('.scroll');
  const scrollTop = scrollEl && sameKey ? scrollEl.scrollTop : 0;
  const focus = captureFocus(body);
  const existing = body.firstElementChild;

  if (sameKey && mod.update && existing && existing.__page === mod.id) {
    try {
      mod.update(existing, ctx);
    } catch (err) {
      body.replaceChildren(errorView(err));
    }
  } else {
    let node;
    try {
      node = mod.render(ctx);
    } catch (err) {
      node = errorView(err);
    }
    node.__page = mod.id;
    body.replaceChildren(node);
    body.dataset.key = key;
  }

  const next = body.querySelector('.scroll');
  if (next && sameKey) next.scrollTop = scrollTop;
  restoreFocus(body, focus);
  lastKey = key;
}

/** Re-renders the sidebar, top row, approval dialog and main pane. */
function render() {
  const route = parseRoute();
  shell.renderAll(store.state, route);
  renderMain(route);
}

/* ---------- token and theme ---------- */

function readToken(params) {
  const fromUrl = params.get('t');
  try {
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return fromUrl || '';
  }
}

/* ---------- shortcuts ---------- */

function onShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const k = e.key.toLowerCase();
  if (k === 'k') {
    e.preventDefault();
    openPalette();
  } else if (k === 'b') {
    e.preventDefault();
    shell.toggleCompact();
  } else if (e.key === ',') {
    e.preventDefault();
    go('#settings');
  }
}

/* ---------- boot ---------- */

function boot() {
  const params = new URLSearchParams(location.search);
  api.demo = params.get('demo') === '1';
  api.token = api.demo ? '' : readToken(params);

  shell.initTheme();
  shell.mount();
  store.init();
  api.onStatus(() => {
    shell.renderStatus();
    if (!store.state) render();
  });
  store.subscribe(() => render());
  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', onShortcut);
  api.connect();

  if (!api.demo && !api.token) {
    ui.toast('Open the Hub from the link on your computer, which includes the access token.', { kind: 'info', title: 'No access token', undo: null });
  }

  render();
  store.refresh();
}

boot();
