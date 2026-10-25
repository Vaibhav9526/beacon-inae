// Vault page: the template gallery (search, group, genre and level filters), pastel cards, a detail
// drawer in the side panel, and 'Add to my agents'. Spec 3.5 and 5.3.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { GENRE_LABEL, metricWords } from '../model.js';

const { h, Avatar, Button, Chip, Input, EmptyState, PageHeader, toast } = ui;

const GROUPS = [
  ['all', 'All'],
  ['disaster', 'Disaster'],
  ['help', 'Help'],
  ['medicine', 'Medicine'],
  ['child', 'Child'],
  ['prepare', 'Prepare']
];
const GROUP_LABEL = Object.fromEntries(GROUPS);
const LEVELS = [
  ['all', 'Any level'],
  ['starter', 'Starter'],
  ['guardian', 'Guardian'],
  ['expert', 'Expert']
];
const LEVEL_LABEL = Object.fromEntries(LEVELS);
const OPS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '==': 'is', '!=': 'is not' };
const SEVERITY = { info: 'Info', watch: 'Watch', warning: 'Warning', severe: 'Severe' };

// Filters survive navigation (they are a per-viewer convenience, not data).
const filters = { q: '', group: 'all', genre: 'all', level: 'all' };
let last = null; // the most recent ctx, for panel and navigation calls from event handlers

const genreOf = (t) => (t.agent && t.agent.genre) || 'custom';

function matches(t) {
  if (filters.group !== 'all' && t.group !== filters.group) return false;
  if (filters.genre !== 'all' && genreOf(t) !== filters.genre) return false;
  if (filters.level !== 'all' && t.level !== filters.level) return false;
  const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [t.name, t.summary, t.about, t.who, ...(t.watches || []), ...(t.sources || [])].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "All of: heat index above 41 and Maa heart rate above 110." in plain words. */
function ruleSentence(r) {
  const conds = (r.when && r.when.conditions) || [];
  const parts = conds.map((c) => metricWords(c.metric) + ' ' + (OPS[c.op] || c.op) + ' ' + c.value);
  const joiner = r.when && r.when.mode === 'any' ? ' or ' : ' and ';
  const text = parts.join(joiner) || 'nothing set';
  return text.charAt(0).toUpperCase() + text.slice(1) + '. Sends a ' + (SEVERITY[r.severity] || r.severity || 'watch') + ' alert.';
}

function kindLabel(state, kind) {
  const k = (state.nodeKinds || []).find((x) => x.kind === kind);
  return k ? k.label : kind;
}

function pathView(state, pipeline) {
  const nodes = pipeline || [];
  if (!nodes.length) return h('p', { class: 'vault-text' }, 'Built-in rules only. No extra steps.');
  return h('ol', { class: 'vault-path', 'aria-label': 'Path' }, nodes.map((n) =>
    h('li', { class: 'vault-path-node' },
      h('span', { class: 'vault-path-kind' }, kindLabel(state, n.kind)),
      h('span', { class: 'vault-path-label' }, n.label || kindLabel(state, n.kind)))));
}

/* ---------- drawer ---------- */

async function addTemplate(t) {
  const a = await api.post('/api/agents', { templateId: t.id });
  if (!a) return;
  toast(a.name + ' is in your agents.', { kind: 'ok', title: 'Added' });
  if (last) {
    last.panel.close();
    last.nav('#agents/' + a.id);
  }
}

function section(title, body) {
  return h('section', { class: 'vault-sec' }, h('h3', { class: 'vault-sec-title' }, title), body);
}

function list(items) {
  const arr = items || [];
  if (!arr.length) return h('p', { class: 'vault-text' }, 'Nothing listed.');
  return h('ul', { class: 'vault-list' }, arr.map((x) => h('li', null, x)));
}

function drawerNode(state, t) {
  const agent = (state.agents || []).find((a) => a.templateId === t.id) || null;
  const rules = (t.agent && t.agent.rules) || [];
  const footer = agent
    ? h('div', { class: 'vault-drawer-foot' },
        h('p', { class: 'vault-text' }, 'Already in My agents.'),
        Button({ label: 'Open agent', variant: 'outline', block: true, onClick: () => { last.panel.close(); last.nav('#agents/' + agent.id); } }))
    : h('div', { class: 'vault-drawer-foot' },
        Button({ label: 'Add to my agents', variant: 'primary', block: true, onClick: (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          addTemplate(t).finally(() => { btn.disabled = false; });
        } }));

  return h('div', { class: 'vault-drawer' },
    h('div', { class: 'vault-drawer-id' },
      Avatar({ key: t.avatar, size: 72 }),
      h('div', { class: 'vault-drawer-titles' },
        h('p', { class: 'vault-drawer-name' }, t.name),
        h('p', { class: 'row-sub' }, (GROUP_LABEL[t.group] || t.group) + ' · ' + (LEVEL_LABEL[t.level] || 'Starter')))),
    section('What it does', h('p', { class: 'vault-text' }, t.about || t.summary)),
    section('Watches', list(t.watches)),
    section('Sources', list(t.sources)),
    section('Who it helps', h('p', { class: 'vault-text' }, t.who || 'Whole family')),
    section('Example alert', h('p', { class: 'quote' }, t.example || 'No example yet.')),
    section('Rules, in plain words', rules.length
      ? h('ul', { class: 'vault-list' }, rules.map((r) => h('li', null, ruleSentence(r))))
      : h('p', { class: 'vault-text' }, 'Built-in rules only.')),
    section('Node path', pathView(state, t.agent && t.agent.pipeline)),
    footer);
}

function openDetail(t) {
  if (!last) return;
  const state = store.state || last.state;
  last.panel.open(t.name, drawerNode(state, t));
}

/* ---------- gallery ---------- */

function templateCard(state, t) {
  const added = (state.agents || []).some((a) => a.templateId === t.id);
  return h('button', {
    type: 'button',
    class: 'vault-card g-' + t.group,
    dataset: { focusKey: 't-' + t.id },
    'aria-label': t.name + '. ' + t.summary,
    onclick: () => openDetail(t)
  },
    h('span', { class: 'vault-card-art' }, Avatar({ key: t.avatar, size: 56 })),
    h('span', { class: 'vault-card-name' }, t.name),
    h('span', { class: 'vault-card-sum' }, t.summary),
    h('span', { class: 'vault-card-foot' },
      Chip({ label: GENRE_LABEL[genreOf(t)] || genreOf(t), tone: 'outline' }),
      t.level ? Chip({ label: LEVEL_LABEL[t.level] || t.level, tone: 'outline' }) : null,
      added ? Chip({ label: 'Added', tone: 'ok' }) : null));
}

function facetRow(label, items, current, onPick, keyPrefix) {
  return h('div', { class: 'vault-facet' },
    h('span', { class: 'vault-facet-label' }, label),
    h('div', { class: 'vault-chips', role: 'group', 'aria-label': label },
      items.map(([id, text]) => h('button', {
        type: 'button',
        class: 'chip-btn vault-chip',
        'aria-pressed': current === id ? 'true' : 'false',
        dataset: { focusKey: keyPrefix + id, facet: keyPrefix, value: id },
        onclick: (e) => onPick(keyPrefix, id, e.currentTarget)
      }, text))));
}

function facetsNode(state) {
  const genres = [...new Set((state.templates || []).map(genreOf))];
  const genreItems = [['all', 'All genres'], ...genres.map((g) => [g, GENRE_LABEL[g] || g])];
  return [
    facetRow('Group', GROUPS, filters.group, pick, 'g-'),
    facetRow('Genre', genreItems, filters.genre, pick, 'n-'),
    facetRow('Level', LEVELS, filters.level, pick, 'l-')
  ];
}

function galleryNode(state) {
  const all = state.templates || [];
  const shown = all.filter(matches);
  const count = h('p', { class: 'vault-count', role: 'status' },
    shown.length === all.length ? all.length + ' templates' : shown.length + ' of ' + all.length + ' templates');
  if (!all.length) {
    return [EmptyState({ icon: 'vault', title: 'No templates yet', text: 'The Vault has no templates to show.' })];
  }
  if (!shown.length) {
    return [count, EmptyState({ icon: 'vault', title: 'Nothing matches', text: 'Try a shorter search or clear the filters.',
      action: Button({ label: 'Clear filters', variant: 'outline', size: 'sm', onClick: clearFilters }) })];
  }
  return [count, h('div', { class: 'vault-grid' }, shown.map((t) => templateCard(state, t)))];
}

/** Repaints the filter chips and the gallery in place. The search field is never touched. */
function paint(root) {
  const state = store.state;
  if (!state || !root) return;
  const facets = root.querySelector('[data-region="facets"]');
  const gallery = root.querySelector('[data-region="gallery"]');
  if (facets) facets.replaceChildren(...facetsNode(state));
  if (gallery) gallery.replaceChildren(...galleryNode(state));
}

function pick(prefix, id, el) {
  const key = { 'g-': 'group', 'n-': 'genre', 'l-': 'level' }[prefix];
  filters[key] = id;
  const focusKey = el && el.dataset.focusKey;
  paint(el && el.closest('.page'));
  const root = el && el.closest('.page');
  const again = root && focusKey && root.querySelector('[data-focus-key="' + focusKey + '"]');
  if (again) again.focus({ preventScroll: true });
}

function clearFilters() {
  filters.q = '';
  filters.group = 'all';
  filters.genre = 'all';
  filters.level = 'all';
  const root = document.querySelector('.vault-page');
  if (root) {
    const input = root.querySelector('#vault-search');
    if (input) input.value = '';
    paint(root);
  }
}

/* ---------- page ---------- */

export default {
  id: 'vault',
  title: 'Vault',
  icon: 'vault',

  render(ctx) {
    last = ctx;
    const search = Input({
      id: 'vault-search',
      value: filters.q,
      placeholder: 'Search templates, sources, watches',
      onInput: (v) => {
        filters.q = v;
        paint(document.querySelector('.vault-page'));
      }
    });
    search.setAttribute('type', 'search');
    search.setAttribute('aria-label', 'Search templates');
    return h('div', { class: 'page vault-page' },
      PageHeader({ title: 'Vault', sub: 'Ready-made agents for common needs. Look one over, then add it to your agents.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col vault-col' },
          h('div', { class: 'vault-search' }, search),
          h('div', { class: 'vault-facets', 'data-region': 'facets' }, facetsNode(ctx.state)),
          h('div', { class: 'vault-gallery', 'data-region': 'gallery' }, galleryNode(ctx.state)))));
  },

  update(root, ctx) {
    last = ctx;
    paint(root);
  }
};
