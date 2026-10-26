// Nodes page. renderNodes(agent, ctx) draws one agent's path (spec 3.12, 6.3) and is used by the agent's
// Nodes tab. The default export is the overview of every agent's path (#nodes).
// Unsaved paths, the last run results and the repaint hook live in module variables, because the agent
// page rebuilds this view on every state change.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { GENRE_LABEL, avatarKey, agentLook, severityLabel } from '../model.js';
import { placePicker } from '../components/placePicker.js';

const { h, Button, IconButton, Tabs, Switch, Chip, Dot, Avatar, EmptyState, PageHeader, Input, Textarea, Select, Field, openDialog, toast, icon } = ui;

const NS = 'http://www.w3.org/2000/svg';
const drafts = {};   // agent id -> { nodes, base, seen }   base: last saved JSON, seen: last server JSON seen
const results = {};  // agent id -> { [nodeId]: NodeRunResult }
const running = {};  // agent id -> true while Run path is in flight
const views = {};    // agent id -> repaint(focusKey) of the latest mounted view
let direction = 'down';
let resizeObs = null;

// Genre starters: the nodes added by "Use the genre starter".
const STARTER = {
  news: ['rss', 'keyword-filter', 'dedupe'],
  wind: ['weather'],
  weather: ['weather'],
  quake: ['quake'],
  flood: ['weather', 'keyword-filter']
};

const SEV_TONE = { info: 'muted', watch: 'accent', warning: 'warn', severe: 'danger' };

const KIND_PATHS = {
  rss: '<path d="M4 4.5a11.5 11.5 0 0 1 11.5 11.5"/><path d="M4 9.5a6.5 6.5 0 0 1 6.5 6.5"/><circle cx="4.8" cy="15.2" r="1.2"/>',
  'http-json': '<path d="M7 4.5c-1.5 0-1.5 1-1.5 2.5v1.8c0 1-.7 1.7-1.8 1.7 1.1 0 1.8.7 1.8 1.7v1.8c0 1.5 0 2.5 1.5 2.5"/><path d="M13 4.5c1.5 0 1.5 1 1.5 2.5v1.8c0 1 .7 1.7 1.8 1.7-1.1 0-1.8.7-1.8 1.7v1.8c0 1.5 0 2.5-1.5 2.5"/>',
  weather: '<circle cx="7.5" cy="7.5" r="2.7"/><path d="M7.5 2.5v1.2M2.5 7.5h1.2M4.2 4.2l.8.8M10.8 4.2l-.8.8"/><path d="M6.5 16.5h7.3a2.5 2.5 0 0 0 .2-5 4 4 0 0 0-7.7 1.1 2 2 0 0 0 .2 3.9z"/>',
  aqi: '<path d="M3 8h9.5a2.2 2.2 0 1 0-2.2-2.2"/><path d="M3 12h13a2.2 2.2 0 1 1-2.2 2.2"/><path d="M3 16h5"/>',
  quake: '<path d="M2 10h3.5l2-5 3 10 2.5-6 1.5 1H18"/>',
  cap: '<path d="M10 3 16.5 5.5V10c0 3.5-2.6 5.8-6.5 7-3.9-1.2-6.5-3.5-6.5-7V5.5z"/><path d="M7.2 10l2 2 3.6-3.8"/>',
  'mcp-tool': '<path d="M7 3v3.5M13 3v3.5M5 6.5h10v2.5a5 5 0 0 1-10 0V6.5z"/><path d="M10 14v3"/>',
  'keyword-filter': '<path d="M3 4.5h14l-5.5 6.5v4.5l-3 1.5V11z"/>',
  threshold: '<path d="M3 11h14" stroke-dasharray="2 2"/><path d="M4 15l4-6 3 3 5-6"/>',
  summarize: '<path d="M4 5h12M4 9h8M4 13h10M4 17h5"/>',
  dedupe: '<rect x="3.5" y="3.5" width="8" height="8" rx="1.5"/><rect x="8.5" y="8.5" width="8" height="8" rx="1.5"/>',
  gateway: '<path d="M3 6h7M3 14h7"/><path d="M7.5 3.5 10 6l-2.5 2.5M7.5 11.5 10 14l-2.5 2.5"/><rect x="13.5" y="4" width="3.5" height="12" rx="1.5"/>'
};

function kindIcon(kind, size = 14) {
  const body = KIND_PATHS[kind] || '<circle cx="10" cy="10" r="2.5"/>';
  const t = document.createElement('template');
  t.innerHTML = '<svg class="ico" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  return t.content.firstElementChild;
}

/* ---------- data helpers ---------- */

const clone = (v) => JSON.parse(JSON.stringify(v));
const jsonOf = (v) => JSON.stringify(v == null ? [] : v);
const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function kindDef(state, kind) {
  return ((state && state.nodeKinds) || []).find((k) => k.kind === kind) || null;
}

/** Returns the draft for an agent, taking the saved path again when the draft is clean and the server changed. */
function getDraft(a) {
  const cur = jsonOf(a.pipeline);
  let d = drafts[a.id];
  if (!d) {
    d = drafts[a.id] = { nodes: clone(a.pipeline || []), base: cur, seen: cur };
  } else if (cur !== d.seen) {
    d.seen = cur;
    if (jsonOf(d.nodes) === d.base) {
      d.nodes = clone(a.pipeline || []);
      d.base = cur;
    }
  }
  return d;
}

const isDirty = (d) => jsonOf(d.nodes) !== d.base;

function blankConfig(def) {
  const cfg = {};
  ((def && def.fields) || []).forEach((f) => {
    if (f.type === 'list') cfg[f.key] = [];
    else if (f.type === 'toggle') cfg[f.key] = false;
    else if (f.type === 'text' || f.type === 'select') cfg[f.key] = '';
  });
  return cfg;
}

/** One line for the card, e.g. "https://example.org/feed.xml · 20". */
function summaryOf(def, node) {
  const cfg = node.config || {};
  const parts = ((def && def.fields) || []).map((f) => {
    const v = cfg[f.key];
    if (v == null || v === '' || v === false) return '';
    if (f.type === 'toggle') return f.label;
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }).filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not set up yet';
}

function starterNodes(state, a) {
  const genre = a.genre;
  const place = a.place || {};
  return (STARTER[genre] || []).map((kind) => {
    const def = kindDef(state, kind);
    const config = blankConfig(def);
    if (kind === 'rss') config.limit = 20;
    if (kind === 'keyword-filter') { config.words = genre === 'flood' ? ['flood', 'rain', 'water'] : []; config.mode = 'any'; }
    if (kind === 'dedupe') config.windowHours = 24;
    if (kind === 'weather') { config.lat = place.lat == null ? null : place.lat; config.lon = place.lon == null ? null : place.lon; }
    if (kind === 'quake') { config.radiusKm = 300; config.minMag = 4; }
    return { id: newId(), kind, label: def ? def.label : kind, config, enabled: true };
  });
}

/* ---------- focus helpers ---------- */

function pathOf(el, root) {
  const p = [];
  let n = el;
  while (n && n !== root) {
    const par = n.parentNode;
    if (!par) return null;
    p.unshift(Array.prototype.indexOf.call(par.children, n));
    n = par;
  }
  return n === root ? p : null;
}

/* ---------- renderNodes: one agent's path ---------- */

/**
 * renderNodes(agent, ctx): the path of one agent as a graph. Returns one DOM node.
 * ctx is the shell context (state, api, ui, nav, toast). The agent page calls this for its Nodes tab.
 */
export function renderNodes(agent, ctx) {
  const a = agent;
  const root = h('div', { class: 'nodes', dataset: { agent: a.id } });
  let dragFrom = null;
  let stage = null;

  function paint(focusKey) {
    const d = getDraft(a);
    const dirty = isDirty(d);
    const busy = !!running[a.id];
    const body = d.nodes.length ? stageEl(d) : emptyEl();
    const toolbar = h('div', { class: 'nodes-bar' },
      Tabs({
        label: 'Layout',
        items: [{ id: 'down', label: 'Vertical' }, { id: 'across', label: 'Left to right' }],
        value: direction,
        onChange: (v) => { direction = v; paint('layout'); }
      }),
      h('div', { class: 'nodes-bar-actions' },
        Button({ label: 'Add node', icon: 'plus', variant: 'outline', size: 'sm', dataset: { focusKey: 'add' }, onClick: (e) => openPicker(e.currentTarget, addNode) }),
        Button({ label: busy ? 'Running' : 'Run path', icon: 'play', variant: 'outline', size: 'sm', loading: busy, dataset: { focusKey: 'run' }, onClick: runPath }),
        h('span', { class: 'nodes-dirty', role: 'status' }, Dot({ state: dirty ? 'waiting' : 'ok' }), dirty ? 'Unsaved changes' : 'Saved'),
        Button({ label: 'Save', size: 'sm', disabled: !dirty, dataset: { focusKey: 'save' }, onClick: save })));
    root.replaceChildren(toolbar, body);
    if (focusKey) {
      const el = root.querySelector('[data-focus-key="' + focusKey + '"]');
      if (el && el.focus) el.focus({ preventScroll: true });
    }
    if (stage) scheduleEdges(stage);
  }

  function refresh(focusKey) {
    (views[a.id] || paint)(focusKey);
  }

  views[a.id] = paint;

  function byId(d, id) {
    return d.nodes.find((x) => x.id === id) || null;
  }

  /* ----- the graph ----- */

  function stageEl(d) {
    const st = h('div', { class: 'node-stage' + (direction === 'across' ? ' across' : ''), role: 'list', 'aria-label': 'Path of ' + a.name });
    d.nodes.forEach((n, i) => st.append(nodeCard(d, n, i, d.nodes.length)));
    st.append(gatewayCard());
    stage = st;
    return st;
  }

  function nodeCard(d, n, i, total) {
    const def = kindDef(ctx.state, n.kind);
    const isSource = def ? !!def.source : true;
    const on = n.enabled !== false;
    const r = (results[a.id] || {})[n.id] || null;
    const summary = summaryOf(def, n);

    const title = h('button', { type: 'button', class: 'node-title', dataset: { focusKey: 'edit-' + n.id }, title: n.label, onclick: () => openEditor(n.id) }, n.label);
    const sw = Switch({
      checked: on,
      small: true,
      label: 'Enabled: ' + n.label,
      onChange: (v) => {
        const cur = byId(draft(), n.id);
        if (cur) cur.enabled = v;
        refresh('switch-' + n.id);
      }
    });
    sw.dataset.focusKey = 'switch-' + n.id;
    const menuBtn = IconButton({ icon: 'more', label: 'Options for ' + n.label, onClick: (e) => openCardMenu(e.currentTarget, n.id, i, total) });
    menuBtn.dataset.focusKey = 'menu-' + n.id;

    const badge = r
      ? h('span', { class: 'node-badge ' + (r.ok ? 'ok' : 'bad') }, r.ok ? (r.items || 0) + (r.items === 1 ? ' item' : ' items') : (r.error || 'Error'))
      : null;

    const card = h('div', { class: 'node-card' + (on ? '' : ' off'), role: 'listitem', draggable: 'true', dataset: { nodeId: n.id } },
      h('span', { class: 'node-port in', 'aria-hidden': 'true' }),
      h('div', { class: 'node-head' },
        h('span', { class: 'node-ico' + (isSource ? '' : ' filter'), 'aria-hidden': 'true' }, kindIcon(n.kind)),
        h('div', { class: 'node-head-text' }, h('div', { class: 'node-kicker' }, isSource ? 'Source' : 'Filter'), title),
        menuBtn),
      h('div', { class: 'node-summary', title: summary }, summary),
      h('div', { class: 'node-foot' }, sw, badge),
      h('span', { class: 'node-port out', 'aria-hidden': 'true' }));

    card.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveNode(i, i + (e.key === 'ArrowUp' ? -1 : 1));
      }
    });
    card.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', n.id); } catch (err) { /* some browsers refuse */ }
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      dragFrom = null;
      card.classList.remove('dragging');
      clearDrop();
    });
    card.addEventListener('dragover', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      const before = direction === 'across' ? e.clientX < rect.left + rect.width / 2 : e.clientY < rect.top + rect.height / 2;
      clearDrop();
      card.classList.add(before ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('drop', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      const before = card.classList.contains('drop-before');
      clearDrop();
      const from = dragFrom;
      dragFrom = null;
      let to = before ? i : i + 1;
      if (to > from) to -= 1;
      moveNode(from, to);
    });
    return card;
  }

  function clearDrop() {
    root.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  function gatewayCard() {
    return h('div', { class: 'node-card node-end', role: 'listitem' },
      h('span', { class: 'node-port in', 'aria-hidden': 'true' }),
      h('div', { class: 'node-head' },
        h('span', { class: 'node-ico out', 'aria-hidden': 'true' }, kindIcon('gateway')),
        h('div', { class: 'node-head-text' }, h('div', { class: 'node-kicker' }, 'Output'), h('div', { class: 'node-title static' }, 'Gateway'))),
      h('div', { class: 'node-summary' }, 'Sends to phones through the gateway'),
      h('div', { class: 'node-foot' }, h('a', { class: 'node-link', href: '#gateway' }, 'Open gateway')));
  }

  function emptyEl() {
    const actions = [Button({ label: 'Add a source', icon: 'plus', size: 'sm', dataset: { focusKey: 'add-source' }, onClick: (e) => openPicker(e.currentTarget, addNode, 'source') })];
    if (STARTER[a.genre]) actions.push(Button({ label: 'Use the genre starter', variant: 'outline', size: 'sm', dataset: { focusKey: 'starter' }, onClick: useStarter }));
    return h('div', { class: 'nodes-empty' },
      EmptyState({
        icon: 'nodes',
        title: 'No path yet',
        text: 'A path is the steps this agent follows. A source reads the world, a filter keeps what matters.',
        action: h('div', { class: 'nodes-empty-actions' }, actions)
      }));
  }

  /* ----- edges (SVG overlay, measured after layout) ----- */

  function scheduleEdges(st) {
    const running_ = !!running[a.id];
    requestAnimationFrame(() => drawEdges(st, running_));
    if (resizeObs) resizeObs.disconnect();
    if (window.ResizeObserver) {
      resizeObs = new ResizeObserver(() => drawEdges(st, !!running[a.id]));
      resizeObs.observe(st);
    }
  }

  /* ----- actions ----- */

  function draft() {
    return getDraft(a);
  }

  function moveNode(from, to) {
    const nodes = draft().nodes;
    if (from < 0 || from >= nodes.length || to < 0 || to >= nodes.length || from === to) return;
    const [moved] = nodes.splice(from, 1);
    nodes.splice(to, 0, moved);
    refresh('edit-' + moved.id);
  }

  function duplicate(id) {
    const nodes = draft().nodes;
    const i = nodes.findIndex((x) => x.id === id);
    if (i < 0) return;
    const copy = clone(nodes[i]);
    copy.id = newId();
    copy.label = nodes[i].label + ' copy';
    nodes.splice(i + 1, 0, copy);
    refresh('edit-' + copy.id);
  }

  function removeNode(id) {
    const nodes = draft().nodes;
    const i = nodes.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [gone] = nodes.splice(i, 1);
    refresh('add');
    toast('Removed ' + gone.label, {
      kind: 'info',
      undo: {
        label: 'Undo',
        ms: 5000,
        onUndo: () => {
          const cur = draft().nodes;
          cur.splice(Math.min(i, cur.length), 0, gone);
          refresh('edit-' + gone.id);
        }
      }
    });
  }

  function commit(next) {
    const nodes = draft().nodes;
    const i = nodes.findIndex((x) => x.id === next.id);
    if (i >= 0) nodes[i] = next;
    else nodes.push(next);
    refresh('edit-' + next.id);
  }

  function addNode(kind) {
    const def = kindDef(ctx.state, kind);
    if (!def) return;
    const fresh = { id: newId(), kind, label: def.label, config: blankConfig(def), enabled: true };
    openEditor(fresh.id, fresh);
  }

  function useStarter() {
    const added = starterNodes(ctx.state, a);
    if (!added.length) return;
    draft().nodes.push(...added);
    refresh('edit-' + added[0].id);
  }

  function openCardMenu(anchor, id, i, total) {
    ui.Menu({
      anchor,
      items: [
        { label: 'Edit', icon: 'edit', onClick: () => openEditor(id) },
        { label: 'Duplicate', icon: 'plus', onClick: () => duplicate(id) },
        { label: 'Move up', icon: 'chevron-up', disabled: i === 0, onClick: () => moveNode(i, i - 1) },
        { label: 'Move down', icon: 'chevron-down', disabled: i >= total - 1, onClick: () => moveNode(i, i + 1) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeNode(id) }
      ]
    });
  }

  /** Add-node picker: sources and filters with descriptions. Arrow keys move, Escape closes. */
  function openPicker(anchor, onPick, only) {
    const kinds = ((ctx.state && ctx.state.nodeKinds) || []).filter((k) => !only || (only === 'source' ? k.source : !k.source));
    const groups = [['Sources', kinds.filter((k) => k.source)], ['Filters', kinds.filter((k) => !k.source)]].filter((g) => g[1].length);
    const items = [];
    let closed = false;
    const pop = h('div', { class: 'node-pick', role: 'menu', 'aria-label': 'Add a node' },
      groups.map(([title, list]) => h('div', { role: 'group', 'aria-label': title },
        h('div', { class: 'node-pick-title', 'aria-hidden': 'true' }, title),
        list.map((k) => {
          const b = h('button', {
            type: 'button',
            role: 'menuitem',
            class: 'node-pick-item',
            onclick: () => { close(false); onPick(k.kind); }
          },
          h('span', { class: 'node-ico sm' + (k.source ? '' : ' filter'), 'aria-hidden': 'true' }, kindIcon(k.kind, 14)),
          h('span', { class: 'node-pick-text' },
            h('span', { class: 'node-pick-label' }, k.label),
            h('span', { class: 'node-pick-desc' }, k.description)));
          items.push(b);
          return b;
        }))));
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 60) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';

    function close(restore) {
      if (closed) return;
      closed = true;
      pop.remove();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
    }
    function onDown(e) {
      if (!pop.contains(e.target)) close(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      const n = items.length;
      if (!n) return;
      const idx = items.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % n;
      else if (e.key === 'ArrowUp') next = idx < 0 ? n - 1 : (idx - 1 + n) % n;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      if (next != null) { e.preventDefault(); items[next].focus(); }
    }
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    if (items[0]) items[0].focus({ preventScroll: true });
  }

  /** Edit dialog generated from the kind's fields. fresh: a node not yet in the path. */
  function openEditor(id, fresh) {
    const cur = fresh || byId(draft(), id);
    if (!cur) return;
    const def = kindDef(ctx.state, cur.kind);
    const cfg = cur.config || {};
    const vals = {};
    const errs = {};
    let labelVal = cur.label || (def ? def.label : cur.kind);
    const resultsEl = h('div', { class: 'node-test', 'aria-live': 'polite' });

    // A kind with latitude and longitude fields gets the place picker instead; manual coordinates stay inside it.
    const kindFields = (def && def.fields) || [];
    const hasCoords = kindFields.some((f) => f.key === 'lat') && kindFields.some((f) => f.key === 'lon');
    const fieldNodes = kindFields.map((f) => {
      if (hasCoords && f.key === 'lon') return null;
      if (hasCoords && f.key === 'lat') return placeField(cfg, vals, errs);
      return fieldControl(f, cfg, vals, errs);
    });
    const labelField = Field({ label: 'Label', id: 'nf-label', children: Input({ id: 'nf-label', value: labelVal, onInput: (v) => { labelVal = v; } }) });

    function readNode() {
      const config = { ...cfg };
      let bad = false;
      Object.keys(errs).forEach((k) => { errs[k].textContent = ''; });
      ((def && def.fields) || []).forEach((f) => {
        const raw = vals[f.key];
        const fail = (text) => { if (errs[f.key]) errs[f.key].textContent = text; bad = true; };
        if (f.type === 'toggle') {
          config[f.key] = !!raw;
        } else if (f.type === 'number') {
          if (String(raw == null ? '' : raw).trim() === '') delete config[f.key];
          else if (Number.isFinite(Number(raw))) config[f.key] = Number(raw);
          else fail('Enter a number.');
        } else if (f.type === 'list') {
          const items = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
          if (items.length) config[f.key] = items;
          else delete config[f.key];
        } else if (f.type === 'json') {
          const txt = String(raw || '').trim();
          if (!txt) delete config[f.key];
          else {
            try { config[f.key] = JSON.parse(txt); } catch (e) { fail('This is not valid JSON. Check quotes and commas.'); }
          }
        } else {
          const txt = String(raw == null ? '' : raw);
          if (txt === '') delete config[f.key];
          else config[f.key] = txt;
        }
      });
      if (bad) return null;
      return { ...cur, label: String(labelVal || '').trim() || (def ? def.label : cur.kind), config };
    }

    async function testNode() {
      const node = readNode();
      if (!node) return;
      resultsEl.replaceChildren(h('p', { class: 'node-test-status' }, 'Testing this node...'));
      const out = await api.post('/api/agents/' + a.id + '/nodes/test', { node });
      if (!out) {
        resultsEl.replaceChildren(h('p', { class: 'node-test-status err' }, 'The node could not run. Check its settings.'));
        return;
      }
      const r = out.result || {};
      const items = out.items || [];
      const count = items.length + (items.length === 1 ? ' item' : ' items');
      resultsEl.replaceChildren(
        h('p', { class: 'node-test-status' + (r.ok === false ? ' err' : '') },
          r.ok === false ? (r.error || 'This node failed.') : 'Found ' + count + (r.ms ? ' in ' + r.ms + ' ms' : '') + '.'),
        ...items.map(itemRow));
    }

    const dlg = openDialog({
      title: def ? def.label : 'Node',
      description: def ? def.description : '',
      width: 500,
      body: h('div', { class: 'node-form' }, labelField, fieldNodes.filter(Boolean), resultsEl),
      actions: [
        { label: 'Test this node', variant: 'outline', keepOpen: true, onClick: () => testNode() },
        { label: 'Cancel', variant: 'outline' },
        {
          label: 'Save node',
          variant: 'primary',
          primary: true,
          keepOpen: true,
          onClick: () => {
            const node = readNode();
            if (!node) return;
            commit(node);
            dlg.close();
          }
        }
      ]
    });
  }

  /* ----- run and save ----- */

  async function runPath() {
    if (running[a.id]) return;
    if (isDirty(draft())) toast('Running the saved path. Save first to include your changes.', { kind: 'info' });
    running[a.id] = true;
    refresh('run');
    const out = await api.post('/api/agents/' + a.id + '/run', {});
    running[a.id] = false;
    if (out) {
      const map = {};
      (out.results || []).forEach((r) => { map[r.nodeId] = r; });
      results[a.id] = map;
      const failed = (out.results || []).filter((r) => !r.ok).length;
      const line = out.delivery && out.delivery.line ? '. ' + out.delivery.line : '';
      toast(failed ? 'Path ran with ' + failed + (failed === 1 ? ' failing node' : ' failing nodes') : 'Path ran: ' + (out.items || 0) + ' items' + line, {
        kind: failed ? 'err' : 'ok'
      });
    }
    refresh('run');
  }

  async function save() {
    const d = draft();
    const out = await api.put('/api/agents/' + a.id + '/pipeline', { nodes: d.nodes });
    if (!out) return;
    const saved = out.pipeline || d.nodes;
    drafts[a.id] = { nodes: clone(saved), base: jsonOf(saved), seen: jsonOf(a.pipeline) };
    toast('Path saved', { kind: 'ok' });
    refresh('save');
  }

  paint();
  return root;
}

/** Place picker for a kind's latitude and longitude. Writes the picked coordinates into vals.lat and vals.lon. */
function placeField(cfg, vals, errs) {
  vals.lat = cfg.lat == null ? '' : String(cfg.lat);
  vals.lon = cfg.lon == null ? '' : String(cfg.lon);
  const err = h('div', { class: 'field-error', id: 'err-lat', role: 'alert' });
  errs.lat = err;
  return Field({ label: 'Place', id: 'nf-place', desc: 'Sets the latitude and longitude for this step.' },
    placePicker({
      id: 'nf-place',
      lat: vals.lat,
      lon: vals.lon,
      onChange: (p) => { vals.lat = p.lat; vals.lon = p.lon; },
    }),
    err);
}

function fieldControl(f, cfg, vals, errs) {
  const id = 'nf-' + f.key;
  const raw = cfg[f.key];
  if (f.type === 'toggle') {
    vals[f.key] = !!raw;
    return h('div', { class: 'node-toggle' },
      h('span', { class: 'field-label' }, f.label),
      Switch({ checked: !!raw, label: f.label, onChange: (v) => { vals[f.key] = v; } }));
  }
  let control;
  if (f.type === 'json') {
    vals[f.key] = raw === undefined ? '' : JSON.stringify(raw, null, 2);
    control = Textarea({ id, rows: 4, value: vals[f.key], placeholder: f.placeholder, onInput: (v) => { vals[f.key] = v; } });
    control.classList.add('mono');
  } else if (f.type === 'list') {
    vals[f.key] = Array.isArray(raw) ? raw.join(', ') : '';
    control = Input({ id, value: vals[f.key], placeholder: 'Comma separated', onInput: (v) => { vals[f.key] = v; } });
  } else if (f.type === 'select') {
    vals[f.key] = raw == null ? '' : String(raw);
    control = Select({ id, value: vals[f.key], options: [['', 'Choose']].concat((f.options || []).map((o) => [o, o])), onChange: (v) => { vals[f.key] = v; } });
  } else {
    vals[f.key] = raw == null ? '' : String(raw);
    control = Input({
      id,
      type: f.type === 'number' ? 'number' : 'text',
      value: vals[f.key],
      placeholder: f.placeholder,
      onInput: (v) => { vals[f.key] = v; }
    });
    if (f.type === 'number') control.setAttribute('step', 'any');
  }
  const err = h('div', { class: 'field-error', id: 'err-' + f.key, role: 'alert' });
  errs[f.key] = err;
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', htmlFor: id }, f.label),
    control,
    f.type === 'json' ? h('div', { class: 'field-desc' }, 'JSON, for example {"words": ["flood"]}.') : null,
    err);
}

function itemRow(item) {
  return h('div', { class: 'node-item' },
    h('div', { class: 'node-item-head' },
      Chip({ label: severityLabel(item.severity), tone: SEV_TONE[item.severity] || 'muted' }),
      h('span', { class: 'node-item-title' }, item.title)),
    item.body ? h('p', { class: 'node-item-body' }, item.body) : null);
}

/** Draws the edges between consecutive cards. Vertical: bottom to top. Across: right to left. */
function drawEdges(st, isRunning) {
  if (!st || !st.isConnected) return;
  const cards = [...st.querySelectorAll(':scope > .node-card')];
  const across = st.classList.contains('across');
  const W = st.scrollWidth;
  const H = st.scrollHeight;
  let svg = st.querySelector(':scope > .node-edges');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'node-edges');
    svg.setAttribute('aria-hidden', 'true');
    st.prepend(svg);
  }
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.classList.toggle('running', !!isRunning);
  let paths = '';
  for (let k = 0; k < cards.length - 1; k++) {
    const c = cards[k];
    const nx = cards[k + 1];
    let d;
    if (across) {
      const x1 = c.offsetLeft + c.offsetWidth;
      const y1 = c.offsetTop + c.offsetHeight / 2;
      const x2 = nx.offsetLeft - 6;
      const y2 = nx.offsetTop + nx.offsetHeight / 2;
      const m = (x2 - x1) / 2;
      d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + m) + ' ' + y1 + ', ' + (x2 - m) + ' ' + y2 + ', ' + x2 + ' ' + y2;
    } else {
      const x1 = c.offsetLeft + c.offsetWidth / 2;
      const y1 = c.offsetTop + c.offsetHeight;
      const x2 = nx.offsetLeft + nx.offsetWidth / 2;
      const y2 = nx.offsetTop - 6;
      const m = (y2 - y1) / 2;
      d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + m) + ', ' + x2 + ' ' + (y2 - m) + ', ' + x2 + ' ' + y2;
    }
    paths += '<path class="node-edge' + (isRunning ? ' flow' : '') + '" d="' + d + '" marker-end="url(#node-arrow)"/>';
  }
  svg.innerHTML = '<defs><marker id="node-arrow" viewBox="0 0 10 12" refX="10" refY="6" markerWidth="9" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 6 L0 12 Z" fill="currentColor"/></marker></defs>' + paths;
}

/* ---------- default export: overview of every agent's path (#nodes) ---------- */

function chainChip(n, state) {
  const def = kindDef(state, n.kind);
  const isSource = def ? !!def.source : true;
  return h('span', { class: 'node-chip' + (n.enabled === false ? ' off' : '') + (isSource ? '' : ' filter'), title: (n.label || n.kind) + (n.enabled === false ? ' (off)' : '') },
    kindIcon(n.kind, 12),
    h('span', null, n.label || n.kind));
}

function overviewRow(ctx, a) {
  const state = ctx.state;
  const nodes = a.pipeline || [];
  const chain = [];
  nodes.forEach((n, i) => {
    if (i) chain.push(h('span', { class: 'node-chain-arrow', 'aria-hidden': 'true' }, icon('chevron-right', 12)));
    chain.push(chainChip(n, state));
  });
  return h('div', { class: 'node-row' },
    Avatar({ key: avatarKey(state, a), look: agentLook(state, a), size: 36, asleep: !a.enabled }),
    h('div', { class: 'node-row-main' },
      h('div', { class: 'node-row-head' },
        h('span', { class: 'node-row-name' }, a.name),
        Chip({ label: GENRE_LABEL[a.genre] || 'Custom', tone: 'outline' })),
      h('div', { class: 'node-chain' }, nodes.length ? chain : h('span', { class: 'node-chain-empty' }, 'No path yet'), h('span', { class: 'node-chain-arrow', 'aria-hidden': 'true' }, icon('chevron-right', 12)), h('span', { class: 'node-chip gateway' }, 'Gateway'))),
    Button({ label: 'Open', variant: 'outline', size: 'sm', onClick: () => ctx.nav('#agents/' + a.id + '?tab=nodes') }));
}

export default {
  id: 'nodes',
  title: 'Nodes',
  icon: 'nodes',

  render(ctx) {
    const agents = (ctx.state && ctx.state.agents) || [];
    const header = PageHeader({
      title: 'Nodes',
      sub: 'The path each agent follows, from sources to phones',
      actions: [Button({ label: 'New source agent', icon: 'plus', variant: 'outline', size: 'sm', onClick: () => ctx.nav('#school') })]
    });
    const rows = agents.length
      ? agents.map((a) => overviewRow(ctx, a))
      : [EmptyState({ icon: 'nodes', title: 'No agents yet', text: 'Create a source agent in School. Its path appears here.', action: Button({ label: 'Open School', variant: 'outline', size: 'sm', onClick: () => ctx.nav('#school') }) })];
    return h('div', { class: 'page nodes-page' },
      header,
      h('div', { class: 'scroll' },
        h('div', { class: 'col nodes-overview' }, rows)));
  }
};
