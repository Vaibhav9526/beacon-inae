// The hub state snapshot (GET /api/state) and its subscribers.
// store.state is null until the first successful refresh.
import { api } from './api.js';

const subs = new Set();
const hidden = new Set(); // agent ids hidden while an undo toast is open

export const store = {
  state: null,
  /** The last raw snapshot, before agents hidden for undo are removed. */
  raw: null,

  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },

  /** Replaces the snapshot and tells every subscriber. */
  set(snapshot) {
    store.raw = snapshot;
    store.state = applyHidden(snapshot);
    subs.forEach((fn) => {
      try { fn(store.state); } catch (e) { console.error(e); }
    });
  },

  /** Fetches /api/state. Resolves with the snapshot or null. */
  async refresh() {
    const s = await api.get('/api/state', { silent: true });
    if (s) {
      api.setOnline(true);
      store.set(s);
      return s;
    }
    api.setOnline(false);
    return null;
  },

  /** Hide an agent from the snapshot (used while its delete can still be undone). */
  hideAgent(id) {
    hidden.add(id);
    if (store.raw) store.set(store.raw);
  },

  showAgent(id) {
    hidden.delete(id);
    if (store.raw) store.set(store.raw);
  },

  /** Wire the SSE / mutation events to a debounced refresh. */
  init() {
    api.subscribe(() => { store.refresh(); });
  },
};

function applyHidden(s) {
  if (!s || !hidden.size || !Array.isArray(s.agents)) return s;
  return { ...s, agents: s.agents.filter((a) => !hidden.has(a.id)) };
}
