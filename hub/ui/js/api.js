// Fetch wrapper for the hub's local API, plus the SSE subscription.
// Every call resolves to the JSON body, or null after an error toast (unless { throws: true }).
import { toast } from './ui.js';

const subscribers = new Set();
const statusListeners = new Set();
let timer = null;
let es = null;
let demoModule = null;

export const api = {
  token: '',
  demo: false,
  /** true after the last /api/state call worked, false when it failed, null before the first try */
  online: null,

  /** Core request. method GET | POST | PUT | DELETE. opts: { silent, throws }. */
  async request(method, path, body, opts = {}) {
    try {
      let data;
      if (api.demo) {
        if (!demoModule) demoModule = await import('./demo.js');
        data = await demoModule.handle(method, path, body);
      } else {
        const init = { method, headers: { 'x-hub-token': api.token } };
        if (body !== undefined && body !== null) {
          init.headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        let r;
        try {
          r = await fetch(path, init);
        } catch (e) {
          throw new Error("Can't reach the hub. Is the server running?");
        }
        const txt = await r.text();
        let parsed = null;
        try { parsed = txt ? JSON.parse(txt) : null; } catch (e) { parsed = null; }
        if (!r.ok) throw new Error((parsed && (parsed.error || parsed.message)) || 'Request failed (' + r.status + ')');
        data = parsed || {};
      }
      if (method !== 'GET') notify('mutation');
      return data;
    } catch (err) {
      if (opts.throws) throw err;
      if (!opts.silent) toast(err.message || 'Something went wrong', { kind: 'err' });
      return null;
    }
  },

  get(path, opts) { return api.request('GET', path, undefined, opts); },
  post(path, body, opts) { return api.request('POST', path, body === undefined ? {} : body, opts); },
  put(path, body, opts) { return api.request('PUT', path, body === undefined ? {} : body, opts); },
  del(path, opts) { return api.request('DELETE', path, undefined, opts); },

  /** Listen for hub events (debounced 150 ms). fn(type). Returns unsubscribe. */
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  /** Track reachability. fn(online). */
  onStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },

  setOnline(v) {
    if (api.online === v) return;
    api.online = v;
    statusListeners.forEach((fn) => fn(v));
  },

  /** Opens the EventSource for hub events. Does nothing in demo mode. */
  connect() {
    if (api.demo || !window.EventSource || es) return;
    es = new EventSource('/api/events?t=' + encodeURIComponent(api.token));
    es.onmessage = (ev) => {
      let type = 'message';
      try { type = JSON.parse(ev.data).type || type; } catch (e) { /* plain ping */ }
      notify(type);
    };
    es.onerror = () => {
      // EventSource retries on its own; the next state refresh tells the UI the hub is back.
    };
  },
};

function notify(type) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    subscribers.forEach((fn) => {
      try { fn(type); } catch (e) { console.error(e); }
    });
  }, 150);
}

export { notify };
