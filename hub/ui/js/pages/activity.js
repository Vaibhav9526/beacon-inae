// Activity page: alerts (expandable, with a CAP download), runs, the audit log of messages and the feed.
// The active tab lives in the hash (#activity?tab=runs), so it survives a reload. Spec 5.9.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { nameOf, severityLabel } from '../model.js';

const { h, icon, Chip, Tabs, EmptyState, PageHeader, relTime, clock } = ui;

const TABS = [
  { id: 'alerts', label: 'Alerts', icon: 'alert' },
  { id: 'runs', label: 'Runs', icon: 'play' },
  { id: 'messages', label: 'Messages', icon: 'chat' },
  { id: 'feed', label: 'Feed', icon: 'bell' }
];

const ALERT_STATUS = {
  'pending-approval': { label: 'Waiting for you', tone: 'warn' },
  sent: { label: 'Sent', tone: 'ok' },
  suppressed: { label: 'Held back', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' }
};

const SEVERITY_TONE = { info: 'muted', watch: 'accent', warning: 'warn', severe: 'danger' };

const KIND_LABEL = {
  news: 'News',
  weather: 'Weather',
  wind: 'Wind',
  quake: 'Earthquake',
  flood: 'Flood',
  alert: 'Alert',
  health: 'Health',
  supply: 'Supply',
  advisory: 'Advisory',
  chat: 'Chat',
  custom: 'Custom'
};

const empty = (title, text, iconName) => EmptyState({ icon: iconName, title, text, compact: true });

/* ---------- alerts ---------- */

function alertRow(a) {
  const st = ALERT_STATUS[a.status] || { label: a.status || 'Unknown', tone: '' };
  const signals = a.signals || [];
  const channels = (a.channels || []).map((c) => Chip({ label: c === 'beacon' ? 'Phones' : 'Telegram', tone: 'outline' }));
  return h('details', { class: 'act-row act-alert' },
    h('summary', { class: 'act-sum' },
      h('span', { class: 'act-time' }, relTime(a.at)),
      h('span', { class: 'act-title' }, a.title),
      h('span', { class: 'act-chips' },
        Chip({ label: severityLabel(a.severity), tone: SEVERITY_TONE[a.severity] || '' }),
        Chip({ label: st.label, tone: st.tone }))),
    h('div', { class: 'act-body' },
      h('p', { class: 'act-text' }, a.body),
      a.note ? h('p', { class: 'act-note' }, a.note) : null,
      h('div', { class: 'act-meta' }, channels),
      signals.length
        ? h('div', { class: 'act-block' },
            h('span', { class: 'field-label' }, 'Signals'),
            h('ul', { class: 'act-signals' }, signals.map((s) => h('li', null,
              h('span', { class: 'act-signal-agent' }, s.agentName || s.agentId),
              ': ',
              s.body || s.title))))
        : null,
      h('div', { class: 'act-actions' },
        h('a', {
          class: 'btn btn-outline btn-sm',
          href: '/api/cap/' + encodeURIComponent(a.id) + '?t=' + encodeURIComponent(api.token || ''),
          download: ''
        }, icon('external', 12), h('span', null, 'Download CAP')))));
}

/* ---------- runs ---------- */

function nodeLabel(state, agentId, nodeId) {
  const a = (state.agents || []).find((x) => x.id === agentId);
  const node = a && (a.pipeline || []).find((n) => n.id === nodeId);
  return node ? node.label : nodeId;
}

function runRow(state, r) {
  const results = Array.isArray(r.results) ? r.results : [];
  return h('div', { class: 'act-row act-run ' + (r.ok ? 'ok' : 'bad') },
    h('span', { class: 'dot ' + (r.ok ? 'ok' : 'bad'), 'aria-hidden': 'true' }),
    h('div', { class: 'act-main' },
      h('div', { class: 'act-line' },
        h('span', { class: 'act-title' }, nameOf(state, r.agentId)),
        h('span', { class: 'act-time' }, relTime(r.at))),
      h('p', { class: 'act-text' }, r.message),
      results.length
        ? h('ul', { class: 'act-results' }, results.map((res) => h('li', null,
            h('span', null, nodeLabel(state, r.agentId, res.nodeId)),
            ': ',
            res.ok ? (res.items + ' items in ' + res.ms + ' ms') : (res.error || 'failed'))))
        : null,
      r.signals ? h('span', { class: 'act-note' }, r.signals + (r.signals === 1 ? ' thing needs a look' : ' things need a look')) : null));
}

/* ---------- messages (audit log) ---------- */

function auditText(e) {
  if (typeof e === 'string') return e;
  return e.text || e.message || e.action || e.summary || JSON.stringify(e);
}

function auditRow(e) {
  const at = e && (e.at || e.time);
  const who = e && (e.actor || e.who || e.by);
  return h('div', { class: 'act-row act-audit' },
    h('span', { class: 'act-time' }, at ? clock(at) : ''),
    h('div', { class: 'act-main' },
      who ? h('span', { class: 'act-title' }, String(who)) : null,
      h('p', { class: 'act-text' }, auditText(e))));
}

/* ---------- feed ---------- */

function feedRow(it) {
  return h('article', { class: 'act-row act-feed' },
    h('div', { class: 'act-line' },
      Chip({ label: KIND_LABEL[it.kind] || it.kind, tone: 'outline' }),
      Chip({ label: severityLabel(it.severity), tone: SEVERITY_TONE[it.severity] || '' }),
      h('span', { class: 'act-meta-text' }, it.agentName + (it.place ? ' · ' + it.place : '')),
      h('span', { class: 'act-time' }, relTime(it.at))),
    h('h3', { class: 'act-feed-title' }, it.title),
    it.body ? h('p', { class: 'act-text' }, it.body) : null);
}

/* ---------- page ---------- */

function bodyFor(state, tab) {
  if (tab === 'runs') {
    const runs = (state.runs || []).slice().sort((x, y) => y.at - x.at);
    return runs.length
      ? h('div', { class: 'act-list' }, runs.map((r) => runRow(state, r)))
      : empty('No runs yet', 'When an agent checks its sources, the result shows up here.', 'play');
  }
  if (tab === 'messages') {
    const log = state.audit || [];
    return log.length
      ? h('div', { class: 'act-list' }, log.slice().reverse().map(auditRow))
      : empty('Nothing logged yet', 'Changes, alerts and approvals are written here as they happen.', 'chat');
  }
  if (tab === 'feed') {
    const feed = state.feed || [];
    return feed.length
      ? h('div', { class: 'act-list' }, feed.map(feedRow))
      : empty('The feed is quiet', 'Items from your agents appear here once they check their sources.', 'bell');
  }
  const alerts = state.alerts || [];
  return alerts.length
    ? h('div', { class: 'act-list' }, alerts.map(alertRow))
    : empty('No alerts', 'Nothing has needed the family yet. Calm is good.', 'alert');
}

export default {
  id: 'activity',
  title: 'Activity',
  icon: 'activity',

  render(ctx) {
    const tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'alerts';
    return h('div', { class: 'page activity-page' },
      PageHeader({ title: 'Activity', sub: 'Alerts, runs, messages and the feed, across every agent.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col activity-col' },
          Tabs({
            items: TABS,
            value: tab,
            label: 'Activity view',
            onChange: (id) => ctx.nav('#activity?tab=' + id)
          }),
          h('div', { class: 'tab-content', role: 'tabpanel', 'aria-label': TABS.find((t) => t.id === tab).label }, bodyFor(ctx.state, tab)))));
  }
};
