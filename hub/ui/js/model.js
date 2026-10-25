// Read-only helpers over the hub state. Pure functions, no DOM.

// Sidebar pages after the agent list. Ids are the route names (#school, #vault, ...).
export const NAV = [
  { id: 'school', label: 'School', icon: 'school' },
  { id: 'vault', label: 'Vault', icon: 'vault' },
  { id: 'nodes', label: 'Nodes', icon: 'nodes' },
  { id: 'gateway', label: 'Gateway', icon: 'gateway' },
  { id: 'family', label: 'Family', icon: 'family' },
  { id: 'mcp', label: 'MCP', icon: 'mcp' },
  { id: 'health', label: 'Health', icon: 'health' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'connections', label: 'Connections', icon: 'plug' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
];

export const GENRES = [
  ['news', 'News'],
  ['weather', 'Weather'],
  ['wind', 'Wind'],
  ['quake', 'Earthquake'],
  ['flood', 'Flood'],
  ['health', 'Health'],
  ['supply', 'Supply'],
  ['community', 'Community'],
  ['custom', 'Custom']
];

export const GENRE_LABEL = Object.fromEntries(GENRES);

export const SITUATION = {
  calm: { label: 'Calm', tone: 'ok' },
  watch: { label: 'Watch', tone: 'warn' },
  alert: { label: 'Alert', tone: 'danger' },
  recovering: { label: 'Recovering', tone: 'accent' }
};

const OPS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '==': 'is', '!=': 'is not' };
const SEV_LABEL = { info: 'Info', watch: 'Watch', warning: 'Warning', severe: 'Severe' };

export const severityLabel = (s) => SEV_LABEL[s] || s;

export function personaOf(state, id) {
  return ((state && state.personas) || []).find((p) => p.id === id) || null;
}

/** Avatar cast key for an agent (falls back to the persona's, then 'sentinel'). */
export function avatarKey(state, a) {
  const p = personaOf(state, a.personaId);
  return a.avatar || (p && p.avatar) || 'sentinel';
}

/** The look the pixel person is drawn with: the agent's own, else its persona's. */
export function agentLook(state, a) {
  const p = personaOf(state, a.personaId);
  return a.look || (p && p.look) || undefined;
}

/** Short role line: persona role, else genre name. */
export function roleOf(state, a) {
  const p = personaOf(state, a.personaId);
  if (p) return p.role;
  return a.genre ? GENRE_LABEL[a.genre] || a.genre : 'Agent';
}

export function runsOf(state, id) {
  return ((state && state.runs) || []).filter((r) => r.agentId === id).sort((x, y) => y.at - x.at);
}

export function lastRun(state, id) {
  return runsOf(state, id)[0] || null;
}

/** True when an alert from this agent waits for the person's approval. */
export function needsYou(state, a) {
  return ((state && state.alerts) || []).some((al) =>
    al.status === 'pending-approval' && (al.signals || []).some((s) => s.agentId === a.id));
}

/** One of: waiting, bad, ok, asleep. */
export function agentStatus(state, a) {
  if (needsYou(state, a)) return 'waiting';
  const r = lastRun(state, a.id);
  if (r && !r.ok) return 'bad';
  return a.enabled ? 'ok' : 'asleep';
}

export function metricWords(m) {
  const hr = /^hr:(.+)$/.exec(m);
  if (hr) return hr[1] + ' heart rate';
  const sp = /^spo2:(.+)$/.exec(m);
  if (sp) return sp[1] + ' oxygen';
  const st = /^steps:(.+)$/.exec(m);
  if (st) return st[1] + ' steps';
  return m.replace(/_/g, ' ');
}

/** A rule in plain words: "All of: heat index above 41. Warning." */
export function ruleWords(r) {
  const conds = (r.when && r.when.conditions) || [];
  const parts = conds.map((c) => metricWords(c.metric) + ' ' + (OPS[c.op] || c.op) + ' ' + c.value);
  const join = r.when && r.when.mode === 'any' ? 'Any of' : 'All of';
  return join + ': ' + (parts.join('; ') || 'nothing set') + '.';
}

export function nameOf(state, id) {
  const a = ((state && state.agents) || []).find((x) => x.id === id);
  return a ? a.name : 'Agent';
}
