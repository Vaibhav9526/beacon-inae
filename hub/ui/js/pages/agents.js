// Agents page: the list detail view (Overview, Nodes, Rules, Activity, Settings), the New agent dialog
// and the delete-with-undo flow. Spec sections 1.4, 3.4, 3.6, 5.1 and 6.2.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { GENRES, GENRE_LABEL, avatarKey, agentLook, roleOf, personaOf, runsOf, ruleWords, metricWords, severityLabel } from '../model.js';

const { h, icon, Button, IconButton, Tabs, Switch, Chip, Avatar, EmptyState, PageHeader, Field, Input, Textarea, Select, GroupRow, openDialog, toast, confirmDialog, clock, dayLabel } = ui;

const TABS = [
  ['overview', 'Overview'],
  ['nodes', 'Nodes'],
  ['rules', 'Rules'],
  ['activity', 'Activity'],
  ['settings', 'Settings']
];

// Drafts survive re-renders (the page is re-rendered on every state change).
const drafts = { rule: {}, settings: {} };
const busy = { run: null, rule: false };

/* ---------- page ---------- */

export default {
  id: 'agents',
  title: 'Agents',
  icon: 'agents',

  render(ctx) {
    const { state, route } = ctx;
    if (!route.id) return emptyMain(ctx);

    const a = (state.agents || []).find((x) => x.id === route.id);
    if (!a) {
      return h('div', { class: 'page' },
        h('div', { class: 'scroll', style: { display: 'flex' } },
          h('div', { style: { margin: 'auto' } },
            EmptyState({
              icon: 'agents',
              title: 'That agent is gone',
              text: 'It may have been deleted. Pick another agent from the list.',
              action: Button({ label: 'Back to agents', variant: 'outline', size: 'sm', onClick: () => ctx.nav('#agents') })
            }))));
    }

    const tab = TABS.some((t) => t[0] === route.query.tab) ? route.query.tab : 'overview';
    const tabsBar = h('div', { class: 'agent-tabs', style: { padding: '8px 16px', borderBottom: '1px solid var(--border)' } },
      Tabs({
        label: 'Agent sections',
        items: TABS.map(([id, label]) => ({ id, label })),
        value: tab,
        onChange: (t) => ctx.nav('#agents/' + a.id + '?tab=' + t)
      }));

    let body;
    if (tab === 'overview') body = overviewTab(ctx, a);
    else if (tab === 'nodes') body = nodesTab(ctx, a);
    else if (tab === 'rules') body = rulesTab(ctx, a);
    else if (tab === 'activity') body = activityTab(ctx, a);
    else body = settingsTab(ctx, a);

    return h('div', { class: 'page', dataset: { agent: a.id, tab } },
      agentHeader(ctx, a, tab),
      tabsBar,
      h('div', { class: 'scroll' }, h('div', { class: 'col' }, body)));
  }
};

function page(node) {
  return h('div', { class: 'page' }, node);
}

function emptyMain(ctx) {
  const none = !(ctx.state.agents || []).length;
  return h('div', { class: 'page' },
    h('div', { class: 'scroll', style: { display: 'flex' } },
      h('div', { style: { margin: 'auto' } },
        EmptyState({
          icon: 'agents',
          title: none ? 'Create your first agent' : 'Choose an agent or create one.',
          text: none
            ? 'An agent watches one thing for your family, such as heat, a heart rate or medicine stock, and sends short alerts.'
            : 'Each agent watches one thing for your family and sends short alerts to the phones.',
          action: Button({ label: 'New agent', onClick: () => openNewAgentDialog() })
        }))));
}

function agentHeader(ctx, a, tab) {
  const { state } = ctx;
  const sub = [roleOf(state, a), GENRE_LABEL[a.genre], a.place && a.place.name].filter(Boolean).join(' · ');
  return PageHeader({
    avatar: Avatar({ key: avatarKey(state, a), look: agentLook(state, a), size: 28, asleep: !a.enabled }),
    title: a.name,
    sub,
    actions: [
      Chip({ label: a.enabled ? 'Awake' : 'Resting', tone: a.enabled ? 'ok' : 'muted' }),
      IconButton({
        icon: 'settings',
        label: 'Agent settings',
        active: tab === 'settings',
        onClick: () => ctx.nav('#agents/' + a.id + '?tab=settings')
      })
    ]
  });
}

/* ---------- shared bits ---------- */

function logRow(entry) {
  return h('div', { class: 'log-row ' + (entry.ok ? 'ok' : 'bad') },
    h('span', { class: 'log-time' }, clock(entry.at)),
    icon(entry.ok ? 'check' : 'alert', 14),
    h('span', null, entry.text));
}

/* ---------- Overview ---------- */

function overviewTab(ctx, a) {
  const { state } = ctx;
  const p = personaOf(state, a.personaId);
  const runs = runsOf(state, a.id).slice(0, 6);
  const running = busy.run === a.id;

  const persona = h('div', { class: 'card-box' },
    h('div', { class: 'row', style: { padding: '0', cursor: 'default' } },
      Avatar({ key: avatarKey(state, a), look: agentLook(state, a), size: 56, asleep: !a.enabled }),
      h('div', { class: 'row-text' },
        h('div', { class: 'row-title' }, h('span', { class: 'row-title-name', style: { fontSize: '16px' } }, a.name)),
        h('div', { class: 'row-sub' }, p ? p.role + ' · ' + p.tagline : 'Agent · ' + (GENRE_LABEL[a.genre] || 'custom')))),
    p ? h('p', { class: 'small', style: { margin: 0, color: 'var(--text-2)', lineHeight: '18px' } }, p.about) : null,
    p && p.skills && p.skills.length ? h('div', { class: 'row-inline' }, p.skills.slice(0, 5).map((s) => Chip({ label: s, tone: 'outline' }))) : null);

  const group = h('div', { class: 'group' },
    GroupRow({
      label: 'Awake',
      desc: a.enabled ? 'Checking and sending alerts' : 'Resting. No checks, no alerts.',
      control: Switch({ checked: !!a.enabled, label: 'Awake', onChange: () => toggleAwake(a) })
    }),
    GroupRow({ label: 'Checks every', value: a.everyMin + ' min' }),
    GroupRow({ label: 'Genre', value: GENRE_LABEL[a.genre] || 'Custom' }),
    GroupRow({ label: 'Place', value: a.place ? a.place.name : 'Not set' }),
    GroupRow({ label: 'Watches', value: (a.members || []).length ? a.members.join(', ') : 'Nobody yet' }),
    GroupRow({ label: 'Channels', value: (a.channels || []).length ? a.channels.join(', ') : 'None' }));

  const actions = h('div', { class: 'row-inline' },
    Button({ label: running ? 'Running' : 'Run now', icon: 'play', variant: 'outline', loading: running, onClick: () => runNow(a) }),
    Button({ label: 'Delete agent', icon: 'trash', variant: 'destructive', onClick: () => deleteAgentWithUndo(a) }));

  const log = h('section', { class: 'stack' },
    h('h3', { class: 'section-title' }, 'Last runs'),
    runs.length
      ? h('div', null, runs.map((r) => logRow({ at: r.at, ok: r.ok, text: r.message + (r.signals ? ' · ' + r.signals + ' signal' + (r.signals === 1 ? '' : 's') : '') })))
      : h('p', { class: 'small muted', style: { margin: 0 } }, 'No runs yet. Run it once to see what it finds.'));

  return h('div', { class: 'stack', style: { gap: '16px' } }, persona, group, actions, log);
}

async function toggleAwake(a) {
  const d = await api.post('/api/agents/' + a.id + '/toggle', {});
  if (!d) return;
  toast(a.enabled ? a.name + ' is resting' : a.name + ' is awake');
  store.refresh();
}

async function runNow(a) {
  busy.run = a.id;
  store.refresh();
  const d = await api.post('/api/agents/' + a.id + '/run', {});
  busy.run = null;
  if (d) {
    const n = d.signals || 0;
    toast(a.name + ' checked: ' + n + (n === 1 ? ' signal' : ' signals') + ', ' + (d.items || 0) + ' items', {
      kind: n ? 'info' : 'ok'
    });
  }
  store.refresh();
}

/* ---------- Nodes (slot for the nodes worker) ---------- */

function nodesTab(ctx, a) {
  const slot = h('div', { class: 'stack', 'data-focus-key': 'nodes-slot' },
    EmptyState({ icon: 'nodes', title: 'Nodes', text: 'Nodes page worker will fill this in' }));
  // The nodes module is optional until its worker lands. It must export renderNodes(agent, ctx).
  import('./nodes.js')
    .then((m) => {
      if (typeof m.renderNodes === 'function' && slot.isConnected) {
        slot.replaceChildren(m.renderNodes(a, ctx));
      }
    })
    .catch(() => { /* module missing: keep the placeholder */ });
  return slot;
}

/* ---------- Rules ---------- */

const SEV_TONE = { info: 'muted', watch: 'accent', warning: 'warn', severe: 'danger' };

function rulesTab(ctx, a) {
  const rules = a.rules || [];
  const draft = drafts.rule[a.id] || '';
  let addBtn = null;

  const input = Input({
    id: 'rule-input',
    value: draft,
    placeholder: 'For example: tell me when Maa heart rate is above 110',
    dataset: { focusKey: 'rule-input' },
    onInput: (v) => {
      drafts.rule[a.id] = v;
      if (addBtn) addBtn.disabled = !v.trim();
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRule(a);
      }
    }
  });

  addBtn = Button({ label: busy.rule ? 'Adding' : 'Add rule', variant: 'primary', loading: busy.rule, disabled: !draft.trim(), onClick: () => addRule(a) });

  const adder = h('div', { class: 'stack' },
    Field({ label: 'Add a rule', desc: 'Say it in plain words. Beacon turns it into a rule it can check.', id: 'rule-input' }, null),
    h('div', { class: 'input-row' }, input, addBtn));

  const list = rules.length
    ? h('div', { class: 'group' }, rules.map((r) => h('div', { class: 'group-row' },
        h('div', { class: 'group-row-main' },
          h('span', { class: 'group-row-label' }, r.name || 'Rule'),
          h('span', { class: 'group-row-desc' }, ruleWords(r) + ' Message: "' + (r.message || '') + '"')),
        Chip({ label: severityLabel(r.severity), tone: SEV_TONE[r.severity] || 'muted' }),
        IconButton({ icon: 'trash', label: 'Remove rule', danger: true, onClick: () => removeRule(a, r) }))))
    : EmptyState({
        compact: true,
        icon: 'check',
        title: 'No rules yet',
        text: 'Rules decide when this agent sends an alert. Add one above in plain words.'
      });

  return h('div', { class: 'stack', style: { gap: '16px' } },
    adder,
    h('section', { class: 'stack' },
      h('h3', { class: 'section-title' }, 'Rules this agent follows'),
      list),
    metricHint(a));
}

function metricHint(a) {
  const metrics = new Set();
  (a.rules || []).forEach((r) => (r.when && r.when.conditions || []).forEach((c) => metrics.add(c.metric)));
  if (!metrics.size) return null;
  return h('p', { class: 'small muted', style: { margin: 0 } },
    'Watching: ' + [...metrics].map(metricWords).join(', ') + '.');
}

async function addRule(a) {
  const text = (drafts.rule[a.id] || '').trim();
  if (!text || busy.rule) return;
  busy.rule = true;
  store.refresh();
  const d = await api.post('/api/agents/' + a.id + '/rules', { text });
  busy.rule = false;
  if (d) {
    drafts.rule[a.id] = '';
    toast('Rule added' + (d.via ? ' (' + d.via + ')' : ''), { title: d.rule && d.rule.name ? d.rule.name : undefined });
  }
  store.refresh();
}

async function removeRule(a, r) {
  const d = await api.del('/api/agents/' + a.id + '/rules/' + encodeURIComponent(r.id));
  if (d) {
    toast('Rule removed');
    store.refresh();
  }
}

/* ---------- Activity ---------- */

function activityTab(ctx, a) {
  const { state } = ctx;
  const items = runsOf(state, a.id).map((r) => ({ at: r.at, ok: r.ok, text: r.message }));
  (state.alerts || []).forEach((al) => {
    if ((al.signals || []).some((s) => s.agentId === a.id)) {
      items.push({ at: al.at, ok: al.status !== 'failed', text: al.title + ' (' + al.status + ')' });
    }
  });
  items.sort((x, y) => y.at - x.at);
  if (!items.length) {
    return EmptyState({ compact: true, icon: 'activity', title: 'No activity yet', text: 'Runs and alerts from this agent show here.' });
  }
  const groups = [];
  items.forEach((it) => {
    const day = dayLabel(it.at);
    let g = groups.find((x) => x.day === day);
    if (!g) {
      g = { day, list: [] };
      groups.push(g);
    }
    g.list.push(it);
  });
  return h('div', { class: 'stack', style: { gap: '4px' } },
    groups.map((g) => h('div', null,
      h('div', { class: 'day-title' }, g.day),
      g.list.map((it) => logRow(it)))));
}

/* ---------- Settings ---------- */

function settingsTab(ctx, a) {
  const d = drafts.settings[a.id] || (drafts.settings[a.id] = {
    name: a.name || '',
    placeName: a.place ? a.place.name : '',
    lat: a.place ? String(a.place.lat) : '',
    lon: a.place ? String(a.place.lon) : '',
    channels: [...(a.channels || [])],
    everyMin: String(a.everyMin || 30),
    members: (a.members || []).join(', '),
    notes: a.notes || ''
  });

  const toggleChannel = (name, on) => {
    const set = new Set(d.channels);
    if (on) set.add(name);
    else set.delete(name);
    d.channels = [...set];
  };

  return h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'stack' },
      Field({ label: 'Name', id: 'set-name' },
        Input({ id: 'set-name', value: d.name, onInput: (v) => { d.name = v; } })),
      h('div', { class: 'form-grid' },
        Field({ label: 'Place', id: 'set-place', desc: 'Used for weather, air and quake checks.' },
          Input({ id: 'set-place', value: d.placeName, placeholder: 'Kochi', onInput: (v) => { d.placeName = v; } })),
        h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr 1fr', gap: '8px' } },
          Field({ label: 'Latitude', id: 'set-lat' },
            Input({ id: 'set-lat', type: 'number', step: 'any', value: d.lat, onInput: (v) => { d.lat = v; } })),
          Field({ label: 'Longitude', id: 'set-lon' },
            Input({ id: 'set-lon', type: 'number', step: 'any', value: d.lon, onInput: (v) => { d.lon = v; } })))),
      Field({ label: 'Watches', id: 'set-members', desc: 'Family names as used in health readings, separated by commas.' },
        Input({ id: 'set-members', value: d.members, placeholder: 'Maa, Papa', onInput: (v) => { d.members = v; } })),
      Field({ label: 'Notes', id: 'set-notes', desc: 'For example: Maa takes BP tablets at 8am.' },
        Textarea({ id: 'set-notes', value: d.notes, rows: 3, onInput: (v) => { d.notes = v; } }))),
    h('div', { class: 'group' },
      GroupRow({
        label: 'Telegram',
        desc: 'Send alerts to the family Telegram group',
        control: Switch({ checked: d.channels.includes('telegram'), label: 'Telegram', onChange: (on) => toggleChannel('telegram', on) })
      }),
      GroupRow({
        label: 'Family phones',
        desc: 'Send alerts to paired phones',
        control: Switch({ checked: d.channels.includes('beacon'), label: 'Family phones', onChange: (on) => toggleChannel('beacon', on) })
      }),
      GroupRow({
        label: 'Check every',
        control: Select({
          id: 'set-every',
          value: d.everyMin,
          options: [5, 15, 30, 60, 180].map((n) => [String(n), n + ' minutes']),
          onChange: (v) => { d.everyMin = v; }
        })
      })),
    h('div', { class: 'row-inline' },
      Button({ label: 'Save changes', variant: 'primary', onClick: () => saveSettings(a, d) })),
    h('section', { class: 'stack' },
      h('h3', { class: 'section-title' }, 'Danger zone'),
      h('div', { class: 'group' },
        GroupRow({
          label: 'Delete agent',
          desc: 'You can undo for 5 seconds after deleting.',
          control: Button({ label: 'Delete', variant: 'destructive', size: 'sm', onClick: () => deleteAgentWithUndo(a) })
        }))));
}

async function saveSettings(a, d) {
  const hasPlace = d.placeName.trim() !== '';
  const lat = Number(d.lat);
  const lon = Number(d.lon);
  if (hasPlace && (!d.lat.trim() || !d.lon.trim() || !Number.isFinite(lat) || !Number.isFinite(lon))) {
    toast('Latitude and longitude must be numbers', { kind: 'err' });
    return;
  }
  const body = {
    name: d.name.trim() || a.name,
    everyMin: Number(d.everyMin) || 30,
    channels: d.channels,
    members: d.members.split(',').map((s) => s.trim()).filter(Boolean),
    notes: d.notes,
    place: hasPlace ? { name: d.placeName.trim(), lat, lon, state: a.place ? a.place.state : undefined } : null
  };
  const r = await api.put('/api/agents/' + a.id, body);
  if (r) {
    delete drafts.settings[a.id];
    toast('Saved');
    store.refresh();
  }
}

/* ---------- delete with undo ---------- */

/** Hides the agent, shows an undo toast for 5 seconds, then deletes it on the server. */
export function deleteAgentWithUndo(a) {
  let undone = false;
  store.hideAgent(a.id);
  if (location.hash.indexOf('#agents/' + a.id) === 0) location.hash = '#agents';
  toast('Deleted ' + a.name, {
    detail: 'You can undo this for 5 seconds.',
    avatar: { key: avatarKey(store.state || { personas: [] }, a), look: agentLook(store.state || { personas: [] }, a) },
    undo: {
      label: 'Undo',
      ms: 5000,
      onUndo: () => {
        undone = true;
        store.showAgent(a.id);
      },
      onExpire: () => {
        if (undone) return;
        api.del('/api/agents/' + a.id).then((d) => {
          if (!d) store.showAgent(a.id);
        });
      }
    }
  });
}

/* ---------- New agent ---------- */

/** Opens the New agent dialog: From the School, or a blank agent (name, genre, persona). */
export function openNewAgentDialog() {
  openDialog({
    title: 'New agent',
    description: 'Start from the School, or make a blank agent.',
    width: 460,
    body: (d) => chooser(d)
  });
}

function chooser(d) {
  d.setActions([{ label: 'Cancel', variant: 'outline' }]);
  return h('div', { class: 'stack' },
    choice('From the School', 'Pick a persona and one of its ready-made watches.', 'school', () => {
      d.close();
      location.hash = '#school';
    }),
    choice('Blank agent', 'Give it a name, a genre and a persona.', 'agents', () => {
      d.setBody(blankForm(d));
    }));
}

function choice(title, desc, iconName, onClick) {
  return h('button', {
    type: 'button',
    class: 'row',
    style: { border: '1px solid var(--border)', padding: '12px', background: 'var(--bg-surface)', borderRadius: 'var(--r-lg)' },
    onclick: onClick
  },
    h('span', { class: 'dialog-icon' }, icon(iconName, 18)),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title-name', style: { fontWeight: '600' } }, title),
      h('span', { class: 'row-sub' }, desc)));
}

function blankForm(d) {
  const state = store.state || {};
  const personas = state.personas || [];
  const first = personas[0] || null;
  const draft = { personaId: first ? first.id : '', name: first ? first.name : '', genre: 'news', touched: false };

  const nameInput = Input({
    id: 'new-name',
    value: draft.name,
    placeholder: 'Agent name',
    autofocus: true,
    onInput: (v) => { draft.name = v; draft.touched = true; }
  });
  const err = h('div', { class: 'field-error', role: 'alert' });

  const personaSel = Select({
    id: 'new-persona',
    value: draft.personaId,
    options: personas.map((p) => [p.id, p.name + ' · ' + p.role]),
    onChange: (v) => {
      draft.personaId = v;
      const p = personas.find((x) => x.id === v);
      if (p && !draft.touched) {
        draft.name = p.name;
        nameInput.value = p.name;
      }
    }
  });

  const genreSel = Select({
    id: 'new-genre',
    value: draft.genre,
    options: GENRES,
    onChange: (v) => { draft.genre = v; }
  });

  d.setActions([
    { label: 'Back', variant: 'ghost', keepOpen: true, onClick: () => d.setBody(chooser(d)) },
    {
      label: 'Create agent',
      variant: 'primary',
      primary: true,
      keepOpen: true,
      onClick: async () => {
        if (!draft.name.trim()) {
          err.textContent = 'Give the agent a name.';
          return;
        }
        if (!draft.personaId) {
          err.textContent = 'Pick a persona.';
          return;
        }
        err.textContent = '';
        const a = await api.post('/api/agents', { personaId: draft.personaId, name: draft.name.trim(), genre: draft.genre });
        if (!a) return;
        d.close();
        toast('Created ' + a.name);
        location.hash = '#agents/' + a.id;
        store.refresh();
      }
    }
  ]);

  return h('div', { class: 'stack', style: { gap: '12px' } },
    Field({ label: 'Persona', id: 'new-persona', desc: 'Sets the voice and the look of the agent.' }, personaSel),
    Field({ label: 'Name', id: 'new-name' }, nameInput),
    Field({ label: 'Genre', id: 'new-genre', desc: 'What the agent is about.' }, genreSel),
    err);
}
