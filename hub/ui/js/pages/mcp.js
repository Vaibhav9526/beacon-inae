// MCP page: the tool servers this computer runs (add, test, edit, connect, remove), their tools,
// a 'Try it' form per tool and 'Use in an agent'. Spec 3.9 and docs/hub-v2-api.md (MCP servers).
// Route: #mcp, or #mcp/<server id> to show that server's tools.
import * as ui from '../ui.js';
import { api } from '../api.js';

const { h, icon, Button, IconButton, Tabs, Switch, Chip, Dot, Field, Input, Select, EmptyState, PageHeader, openDialog, toast, confirmDialog, Menu } = ui;

const PRESETS = [
  { label: 'Filesystem (npx @modelcontextprotocol/server-filesystem <folder>)', name: 'Filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<folder>'] },
  { label: 'Fetch (uvx mcp-server-fetch)', name: 'Fetch', command: 'uvx', args: ['mcp-server-fetch'] },
  { label: 'Weather (npx -y @dangahagan/weather-mcp)', name: 'Weather', command: 'npx', args: ['-y', '@dangahagan/weather-mcp'] }
];

// Module state that must survive re-renders.
const tryDraft = {};   // "<server>:<tool>" -> { field: value }
const tryResult = {};  // "<server>:<tool>" -> last result
const openTools = new Set();
let busyTool = null;
let selected = null;
let lastState = null;
let lastRoot = null;

const enc = (s) => encodeURIComponent(String(s));
const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

function statusOf(state, id) {
  return ((state.mcp && state.mcp.status) || []).find((x) => x.id === id) || null;
}

function toolsOf(state, id) {
  return ((state.mcp && state.mcp.tools) || []).filter((t) => t.server === id);
}

function toolCount(state, id) {
  const st = statusOf(state, id);
  if (st && typeof st.toolCount === 'number') return st.toolCount;
  return toolsOf(state, id).length;
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

/** "3 tools: a, b, c" from a tool list (names) or a bare count. */
function toolSummary(tools) {
  if (Array.isArray(tools)) {
    const names = tools.map((t) => (typeof t === 'string' ? t : t && t.name)).filter(Boolean);
    const count = plural(tools.length, 'tool', 'tools');
    if (!names.length) return count;
    return count + ': ' + names.slice(0, 8).join(', ') + (names.length > 8 ? ' and more' : '');
  }
  return plural(Number(tools) || 0, 'tool', 'tools');
}

/* ---------- page ---------- */

function build(ctx) {
  return h('div', { class: 'page mcp-page' },
    PageHeader({
      title: 'MCP servers',
      sub: 'Extra tools for Beacon. They run on this computer.',
      actions: [Button({ label: 'Add MCP server', icon: 'plus', variant: 'outline', size: 'sm', dataset: { focusKey: 'add-server' }, onClick: () => openServerDialog(null) })]
    }),
    h('div', { class: 'scroll' },
      h('div', { class: 'mcp-wrap' },
        h('div', { class: 'mcp-note', role: 'note' },
          icon('alert', 16),
          h('span', null, 'Only add servers you trust. They run on this computer with your permissions.')),
        h('div', { class: 'mcp-grid' },
          h('section', { class: 'mcp-col', 'aria-labelledby': 'mcp-h-servers' },
            h('h2', { class: 'mcp-h2', id: 'mcp-h-servers' }, 'Servers'),
            h('div', { class: 'mcp-slot', dataset: { slot: 'servers' } })),
          h('section', { class: 'mcp-col', 'aria-labelledby': 'mcp-h-tools' },
            h('h2', { class: 'mcp-h2', id: 'mcp-h-tools' }, 'Tools'),
            h('div', { class: 'mcp-slot', dataset: { slot: 'tools' } }))))));
}

function paint(root, ctx) {
  lastState = ctx.state;
  lastRoot = root;
  selected = ctx.route.id || null;
  const m = ctx.state.mcp || { servers: [], status: [], tools: [] };
  const slot = root.querySelector('[data-slot="servers"]');
  const sig = JSON.stringify([m.servers || [], m.status || [], selected]);
  if (slot && slot.__sig !== sig) {
    slot.__sig = sig;
    slot.replaceChildren(serversBlock(ctx.state));
  }
  paintTools(false, null);
}

export default {
  id: 'mcp',
  title: 'MCP',
  icon: 'mcp',

  render(ctx) {
    const root = build(ctx);
    paint(root, ctx);
    return root;
  },

  // Called by the shell on state refreshes. Only changed panels are rebuilt, so open forms keep their text.
  update(root, ctx) {
    paint(root, ctx);
  }
};

/* ---------- servers ---------- */

function serversBlock(state) {
  const servers = (state.mcp && state.mcp.servers) || [];
  if (!servers.length) {
    return EmptyState({
      icon: 'mcp',
      title: 'No MCP servers yet',
      text: 'Add a tool server, such as files or weather. Agents can then use its tools.',
      action: Button({ label: 'Add MCP server', icon: 'plus', variant: 'outline', size: 'sm', onClick: () => openServerDialog(null) })
    });
  }
  return h('ul', { class: 'mcp-list', 'aria-label': 'MCP servers' }, servers.map((s) => serverRow(state, s)));
}

function serverRow(state, s) {
  const st = statusOf(state, s.id);
  const connected = !!(st && st.connected);
  const tone = connected ? 'ok' : st && st.error ? 'bad' : 'asleep';
  const statusText = connected ? 'Connected' : st && st.error ? st.error : 'Not connected';
  const count = toolCount(state, s.id);
  const isSel = s.id === selected;
  return h('li', { class: 'mcp-server' + (isSel ? ' selected' : '') },
    h('button', {
      type: 'button',
      class: 'mcp-server-main',
      'aria-current': isSel ? 'true' : undefined,
      dataset: { focusKey: 'pick-' + safeId(s.id) },
      onclick: () => { location.hash = '#mcp/' + enc(s.id); }
    },
      h('span', { class: 'mcp-icon', 'aria-hidden': 'true' }, icon('mcp', 16)),
      h('span', { class: 'mcp-server-text' },
        h('span', { class: 'mcp-server-name' }, s.name),
        h('span', { class: 'mcp-server-sub' },
          Chip({ label: s.transport === 'http' ? 'HTTP' : 'STDIO', tone: 'outline' }),
          h('span', null, plural(count, 'tool', 'tools'))),
        h('span', { class: 'mcp-status ' + tone },
          Dot({ state: tone }),
          h('span', null, statusText)))),
    h('div', { class: 'mcp-server-end' },
      Switch({ checked: !!s.enabled, label: 'Enabled: ' + s.name, onChange: (on) => setEnabled(s, on) }),
      IconButton({
        icon: 'more',
        label: 'More actions for ' + s.name,
        dataset: { focusKey: 'menu-' + safeId(s.id) },
        onClick: (e) => serverMenu(e.currentTarget, s, connected)
      })));
}

async function setEnabled(s, on) {
  const r = await api.put('/api/mcp/' + enc(s.id), { enabled: on });
  if (r) toast(s.name + (on ? ' is on' : ' is off'));
}

function serverMenu(anchor, s, connected) {
  Menu({
    anchor,
    items: [
      connected
        ? { label: 'Disconnect', icon: 'close', onClick: () => disconnect(s) }
        : { label: 'Connect', icon: 'link', onClick: () => connect(s) },
      { label: 'Edit', icon: 'edit', onClick: () => openServerDialog(s) },
      '-',
      { label: 'Remove', icon: 'trash', danger: true, onClick: () => removeServer(s) }
    ]
  });
}

async function connect(s) {
  const r = await api.post('/api/mcp/' + enc(s.id) + '/connect');
  if (!r) return;
  if (r.ok) toast('Connected to ' + s.name, { title: toolSummary(r.tools) });
  else toast('Could not connect to ' + s.name, { kind: 'err', detail: r.error || 'Unknown error' });
}

async function disconnect(s) {
  // The engine has no separate disconnect call: turning a server off stops it.
  const r = await api.put('/api/mcp/' + enc(s.id), { enabled: false });
  if (r) toast('Disconnected ' + s.name);
}

async function removeServer(s) {
  const ok = await confirmDialog({
    title: 'Remove ' + s.name + '?',
    text: 'Agents that use its tools stop working until you add it back.',
    confirmLabel: 'Remove',
    danger: true,
    icon: 'trash'
  });
  if (!ok) return;
  const r = await api.del('/api/mcp/' + enc(s.id));
  if (r) {
    toast('Removed ' + s.name);
    if (selected === s.id) location.hash = '#mcp';
  }
}

/* ---------- tools panel ---------- */

function paintTools(force, focusKey) {
  if (!lastRoot || !lastState) return;
  const slot = lastRoot.querySelector('[data-slot="tools"]');
  if (!slot) return;
  const s = selected ? ((lastState.mcp && lastState.mcp.servers) || []).find((x) => x.id === selected) : null;
  const sig = JSON.stringify([
    selected,
    s || null,
    selected ? statusOf(lastState, selected) : null,
    selected ? toolsOf(lastState, selected) : null,
    [...openTools],
    busyTool
  ]);
  if (force) slot.__sig = null;
  if (slot.__sig === sig) return;
  slot.__sig = sig;
  slot.replaceChildren(toolsPanel(lastState, s));
  if (focusKey) {
    const el = slot.querySelector('[data-focus-key="' + focusKey + '"]');
    if (el) el.focus({ preventScroll: true });
  }
}

function toolsPanel(state, s) {
  if (!selected) {
    return EmptyState({ compact: true, icon: 'mcp', title: 'Pick a server', text: 'Choose a server on the left to see its tools and try them.' });
  }
  if (!s) {
    return EmptyState({
      compact: true,
      icon: 'alert',
      title: 'That server is gone',
      text: 'It may have been removed.',
      action: Button({ label: 'Back to servers', variant: 'outline', size: 'sm', onClick: () => { location.hash = '#mcp'; } })
    });
  }
  const st = statusOf(state, s.id);
  const connected = !!(st && st.connected);
  const tools = toolsOf(state, s.id);
  const agent = (state.agents || [])[0] || null;
  const head = h('div', { class: 'mcp-tools-head' },
    h('div', { class: 'mcp-tools-title' },
      h('span', { class: 'mcp-tools-name' }, s.name),
      h('span', { class: 'mcp-muted small' }, (s.transport === 'http' ? 'Streamable HTTP' : 'STDIO') + ' · ' + plural(tools.length, 'tool', 'tools'))),
    Button({
      label: 'Use in an agent',
      icon: 'arrow',
      variant: 'outline',
      size: 'sm',
      dataset: { focusKey: 'use-agent' },
      onClick: () => useInAgent(s, tools)
    }));

  if (!connected) {
    return h('div', { class: 'mcp-tools card-box' }, head,
      h('div', { class: 'mcp-connect-row' },
        h('p', { class: 'mcp-muted small' }, st && st.error ? 'Last error: ' + st.error : 'Connect this server to list and try its tools.'),
        Button({ label: 'Connect', icon: 'link', size: 'sm', dataset: { focusKey: 'connect-now' }, onClick: () => connect(s) })));
  }
  if (!tools.length) {
    return h('div', { class: 'mcp-tools card-box' }, head,
      h('p', { class: 'mcp-muted small' }, 'This server has no tools.'));
  }
  return h('div', { class: 'mcp-tools card-box' }, head,
    h('ul', { class: 'mcp-tool-list', 'aria-label': 'Tools of ' + s.name }, tools.map((t) => toolCard(s, t))));
}

function schemaProps(t) {
  const schema = (t && t.inputSchema) || {};
  return schema.properties && typeof schema.properties === 'object' ? schema.properties : null;
}

function toolCard(s, t) {
  const key = s.id + ':' + t.name;
  const props = schemaProps(t);
  const required = (t.inputSchema && Array.isArray(t.inputSchema.required)) ? t.inputSchema.required : [];
  const keys = props ? Object.keys(props) : [];
  const isOpen = openTools.has(key);
  return h('li', { class: 'mcp-tool' },
    h('div', { class: 'mcp-tool-head' },
      h('div', { class: 'mcp-tool-text' },
        h('code', { class: 'mcp-tool-name' }, t.name),
        t.description ? h('p', { class: 'mcp-muted small' }, t.description) : null),
      Button({
        label: isOpen ? 'Close' : 'Try it',
        variant: 'outline',
        size: 'sm',
        dataset: { focusKey: 'try-' + safeId(key) },
        onClick: () => {
          if (openTools.has(key)) openTools.delete(key);
          else openTools.add(key);
          paintTools(true, 'try-' + safeId(key));
        }
      })),
    h('div', { class: 'mcp-keys', 'aria-label': 'Inputs' },
      keys.length
        ? keys.map((k) => Chip({ label: required.includes(k) ? k + ' *' : k, tone: 'outline' }))
        : h('span', { class: 'mcp-muted small' }, 'No inputs')),
    isOpen ? tryForm(s, t, key, props, required) : null,
    tryResult[key] !== undefined
      ? h('pre', { class: 'mcp-code', tabindex: '0', 'aria-label': 'Result of ' + t.name }, formatResult(tryResult[key]))
      : null);
}

function formatResult(r) {
  if (typeof r === 'string') return r;
  try { return JSON.stringify(r, null, 2); } catch (e) { return String(r); }
}

function fieldFor(key, name, p, required, dr) {
  const type = p.type || (Array.isArray(p.enum) ? 'enum' : 'json');
  const id = 'try-' + safeId(key) + '-' + safeId(name);
  const label = (name === '__json' ? 'Arguments (JSON)' : name) + (required ? ' (required)' : '');
  const desc = p.description ? String(p.description) : undefined;
  if (type === 'boolean') {
    return h('div', { class: 'mcp-field mcp-field-row' },
      h('span', { class: 'field-label' }, label),
      Switch({ checked: !!dr[name], label: name, onChange: (on) => { dr[name] = on; } }));
  }
  let control;
  if (type === 'enum') {
    control = Select({
      id,
      value: dr[name] !== undefined ? String(dr[name]) : '',
      options: [['', 'Not set']].concat(p.enum.map((v) => [String(v), String(v)])),
      onChange: (v) => { dr[name] = v; }
    });
  } else if (type === 'number' || type === 'integer') {
    control = Input({ id, type: 'number', step: type === 'integer' ? '1' : 'any', value: dr[name] ?? '', placeholder: 'Number', dataset: { focusKey: id }, onInput: (v) => { dr[name] = v; } });
  } else if (type === 'string') {
    control = Input({ id, value: dr[name] ?? '', placeholder: p.default != null ? String(p.default) : '', dataset: { focusKey: id }, onInput: (v) => { dr[name] = v; } });
  } else {
    control = h('textarea', {
      id,
      class: 'textarea mcp-json',
      rows: 3,
      spellcheck: 'false',
      placeholder: '{}',
      dataset: { focusKey: id },
      oninput: (e) => { dr[name] = e.target.value; }
    }, dr[name] ?? '');
  }
  return Field({ label, id, desc, children: control });
}

function buildArgs(props, dr) {
  if (!props) {
    const raw = String(dr.__json || '').trim();
    if (!raw) return {};
    return parseJsonObject(raw, 'Arguments');
  }
  const args = {};
  Object.keys(props).forEach((k) => {
    const p = props[k] || {};
    const type = p.type || (Array.isArray(p.enum) ? 'enum' : 'json');
    const v = dr[k];
    if (type === 'boolean') {
      if (v !== undefined) args[k] = !!v;
      return;
    }
    if (v === undefined || v === null || v === '') return;
    if (type === 'number' || type === 'integer') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(k + ' needs a number');
      args[k] = type === 'integer' ? Math.trunc(n) : n;
      return;
    }
    if (type === 'string' || type === 'enum') {
      args[k] = String(v);
      return;
    }
    if (String(v).trim()) args[k] = parseJsonValue(String(v), k);
  });
  return args;
}

function parseJsonValue(raw, label) {
  try { return JSON.parse(raw); } catch (e) { throw new Error('Check the JSON in ' + label + '.'); }
}

function parseJsonObject(raw, label) {
  const v = parseJsonValue(raw, label);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(label + ' must be a JSON object.');
  return v;
}

function tryForm(s, t, key, props, required) {
  const dr = tryDraft[key] || (tryDraft[key] = {});
  const fields = props
    ? Object.keys(props).map((k) => fieldFor(key, k, props[k] || {}, required.includes(k), dr))
    : [fieldFor(key, '__json', { type: 'json', description: 'Arguments as a JSON object. Leave empty for none.' }, false, dr)];
  const callId = 'call-' + safeId(key);
  return h('div', { class: 'mcp-try' },
    h('div', { class: 'mcp-try-fields' }, fields),
    h('div', { class: 'row-inline' },
      Button({
        label: 'Call tool',
        icon: 'play',
        size: 'sm',
        loading: busyTool === key,
        dataset: { focusKey: callId },
        onClick: () => callTool(s, t, key)
      })));
}

async function callTool(s, t, key) {
  let args;
  try {
    args = buildArgs(schemaProps(t), tryDraft[key] || {});
  } catch (e) {
    toast(e.message || 'Check the values', { kind: 'err' });
    return;
  }
  busyTool = key;
  paintTools(true, 'call-' + safeId(key));
  const r = await api.post('/api/mcp/' + enc(s.id) + '/call', { tool: t.name, args });
  busyTool = null;
  if (r) tryResult[key] = r.result !== undefined ? r.result : r;
  paintTools(true, 'call-' + safeId(key));
}

/** Copies a ready mcp-tool node for the first tool, then opens the first agent's Nodes tab. */
async function useInAgent(s, tools) {
  const open = [...openTools].find((k) => k.indexOf(s.id + ':') === 0);
  const tool = (open && tools.find((t) => s.id + ':' + t.name === open)) || tools[0];
  if (!tool) {
    toast('This server has no tools to use yet.', { kind: 'err' });
    return;
  }
  const node = { kind: 'mcp-tool', label: s.name + ': ' + tool.name, config: { server: s.id, tool: tool.name, args: {} }, enabled: true };
  const json = JSON.stringify(node, null, 2);
  let copied = false;
  try {
    await navigator.clipboard.writeText(json);
    copied = true;
  } catch (e) {
    copied = false;
  }
  const agent = ((lastState && lastState.agents) || [])[0] || null;
  if (copied) toast('Node copied', { title: 'Paste it into an agent in Nodes.', detail: 'mcp-tool: ' + tool.name });
  else toast('Could not copy the node', { kind: 'err', detail: 'Copy it from the next dialog.' });
  if (!agent) {
    toast('Make an agent first, then add this node.', { kind: 'info' });
    location.hash = '#agents';
    return;
  }
  location.hash = '#agents/' + enc(agent.id) + '?tab=nodes';
}

/* ---------- add and edit dialog ---------- */

function kvLines(text, sep) {
  const out = {};
  let bad = 0;
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.indexOf(sep);
    if (at < 1) { bad = bad || i + 1; return; }
    out[line.slice(0, at).trim()] = line.slice(at + sep.length).trim();
  });
  return { obj: out, bad };
}

function lineList(text) {
  return String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
}

function specOf(d, server) {
  const base = { name: d.name.trim(), transport: d.transport, enabled: server ? !!server.enabled : true };
  if (d.transport === 'stdio') {
    return Object.assign(base, { command: d.command.trim(), args: lineList(d.args), env: kvLines(d.env, '=').obj });
  }
  return Object.assign(base, { url: d.url.trim(), headers: kvLines(d.headers, ':').obj });
}

function validate(d) {
  if (!d.name.trim()) return 'Give the server a name.';
  if (d.transport === 'stdio') {
    if (!d.command.trim()) return 'Add the command that starts the server, for example npx.';
    const env = kvLines(d.env, '=');
    if (env.bad) return 'Environment line ' + env.bad + ' needs KEY=VALUE.';
  } else {
    if (!/^https?:\/\//i.test(d.url.trim())) return 'The server address starts with http:// or https://';
    const hd = kvLines(d.headers, ':');
    if (hd.bad) return 'Header line ' + hd.bad + ' needs KEY: VALUE.';
  }
  return '';
}

/** Add (server null) or edit a server. Test, Save, presets and the secret toggle live in the dialog. */
function openServerDialog(server) {
  const editing = !!server;
  const d = {
    name: server ? server.name : '',
    transport: server && server.transport === 'http' ? 'http' : 'stdio',
    command: server && server.command ? server.command : '',
    args: server && server.args ? server.args.join('\n') : '',
    env: server && server.env ? Object.entries(server.env).map(([k, v]) => k + '=' + v).join('\n') : '',
    url: server && server.url ? server.url : '',
    headers: server && server.headers ? Object.entries(server.headers).map(([k, v]) => k + ': ' + v).join('\n') : ''
  };
  let showSecrets = false;
  let testing = false;
  let testResult = null; // { key, ok, tools, error }
  let formError = '';
  let dlg = null;
  const container = h('div', { class: 'mcp-form' });

  const specKey = () => JSON.stringify(specOf(d, server));

  function paintBody(focusKey) {
    const tabs = Tabs({
      label: 'Transport',
      block: true,
      items: [{ id: 'stdio', label: 'STDIO' }, { id: 'http', label: 'Streamable HTTP' }],
      value: d.transport,
      onChange: (id) => {
        d.transport = id;
        testResult = null;
        paintBody('tab-' + id);
      }
    });
    const nameIn = Input({ id: 'srv-name', value: d.name, placeholder: 'For example, Weather', autofocus: true, onInput: (v) => { d.name = v; formError = ''; } });

    const presets = d.transport === 'stdio'
      ? h('div', { class: 'mcp-presets', role: 'group', 'aria-label': 'Presets' },
          PRESETS.map((p, i) => Button({
            label: p.label,
            variant: 'outline',
            size: 'xs',
            dataset: { focusKey: 'preset-' + i },
            onClick: () => {
              d.transport = 'stdio';
              d.name = p.name;
              d.command = p.command;
              d.args = p.args.join('\n');
              testResult = null;
              formError = '';
              paintBody('srv-name');
            }
          })))
      : null;

    const secretsToggle = Button({
      label: showSecrets ? 'Hide values' : 'Show values',
      icon: showSecrets ? 'lock' : 'user',
      variant: 'ghost',
      size: 'xs',
      dataset: { focusKey: 'secrets' },
      onClick: () => { showSecrets = !showSecrets; paintBody('secrets'); }
    });
    secretsToggle.setAttribute('aria-pressed', showSecrets ? 'true' : 'false');

    let fields;
    if (d.transport === 'stdio') {
      const cmd = Input({
        id: 'srv-cmd',
        value: d.command,
        placeholder: 'npx',
        dataset: { focusKey: 'srv-cmd' },
        onInput: (v) => {
          // A pasted address is a web server: switch to Streamable HTTP and keep the address.
          if (/^https?:\/\//i.test(v.trim())) {
            d.transport = 'http';
            d.url = v.trim();
            testResult = null;
            paintBody('srv-url');
            return;
          }
          d.command = v;
          testResult = null;
        }
      });
      fields = [
        Field({ label: 'Command', id: 'srv-cmd', desc: 'The program that starts the server.', children: cmd }),
        h('div', { class: 'field' },
          h('label', { class: 'field-label', for: 'srv-args' }, 'Arguments'),
          h('textarea', { id: 'srv-args', class: 'textarea mcp-lines', rows: 3, spellcheck: 'false', placeholder: 'One argument per line', oninput: (e) => { d.args = e.target.value; testResult = null; } }, d.args),
          h('span', { class: 'field-desc' }, 'One argument per line.')),
        h('div', { class: 'field' },
          h('div', { class: 'mcp-label-row' },
            h('label', { class: 'field-label', for: 'srv-env' }, 'Environment variables'),
            secretsToggle),
          h('textarea', { id: 'srv-env', class: 'textarea mcp-lines mcp-secret' + (showSecrets ? '' : ' masked'), rows: 3, spellcheck: 'false', placeholder: 'KEY=VALUE, one per line', oninput: (e) => { d.env = e.target.value; testResult = null; } }, d.env),
          h('span', { class: 'field-desc' }, 'KEY=VALUE, one per line. Values are hidden unless you show them.'))
      ];
    } else {
      fields = [
        Field({ label: 'Server URL', id: 'srv-url', desc: 'The address of the Streamable HTTP server.', children: Input({ id: 'srv-url', value: d.url, placeholder: 'https://', dataset: { focusKey: 'srv-url' }, onInput: (v) => { d.url = v; testResult = null; } }) }),
        h('div', { class: 'field' },
          h('div', { class: 'mcp-label-row' },
            h('label', { class: 'field-label', for: 'srv-headers' }, 'Headers'),
            secretsToggle),
          h('textarea', { id: 'srv-headers', class: 'textarea mcp-lines mcp-secret' + (showSecrets ? '' : ' masked'), rows: 3, spellcheck: 'false', placeholder: 'KEY: VALUE, one per line', oninput: (e) => { d.headers = e.target.value; testResult = null; } }, d.headers),
          h('span', { class: 'field-desc' }, 'KEY: VALUE, one per line. Values are hidden unless you show them.'))
      ];
    }

    const testLine = testResult
      ? h('p', { class: 'mcp-test ' + (testResult.ok ? 'ok' : 'bad'), role: 'status' },
          testResult.ok ? 'Connected · ' + toolSummary(testResult.tools) : 'Could not connect: ' + (testResult.error || 'unknown error'))
      : h('p', { class: 'mcp-test muted', role: 'status' }, 'Not tested yet.');

    const testRow = h('div', { class: 'mcp-test-row' },
      Button({ label: 'Test connection', icon: 'refresh', variant: 'outline', size: 'sm', loading: testing, dataset: { focusKey: 'mcp-test' }, onClick: runTest }),
      testLine);

    const err = h('div', { class: 'field-error', role: 'alert' }, formError);

    container.replaceChildren(...[
      Field({ label: 'Name', id: 'srv-name', children: nameIn }),
      h('div', { class: 'field' },
        h('span', { class: 'field-label', id: 'srv-transport-label' }, 'Transport'),
        tabs),
      presets,
      ...fields,
      testRow,
      err
    ].filter(Boolean));

    if (focusKey) {
      const el = focusKey.indexOf('tab-') === 0
        ? container.querySelector('[data-tab="' + focusKey.slice(4) + '"]')
        : container.querySelector('[data-focus-key="' + focusKey + '"]') || container.querySelector('#' + focusKey);
      if (el) el.focus({ preventScroll: true });
    }
  }

  async function runTest() {
    const problem = validate(d);
    if (problem) {
      testResult = { key: specKey(), ok: false, error: problem };
      paintBody('mcp-test');
      return;
    }
    testing = true;
    paintBody('mcp-test');
    const spec = specOf(d, server);
    const r = await api.post('/api/mcp/test', { spec });
    testing = false;
    testResult = r
      ? { key: JSON.stringify(spec), ok: !!r.ok, tools: r.tools, error: r.error }
      : { key: JSON.stringify(spec), ok: false, error: 'The hub did not answer the test.' };
    paintBody('mcp-test');
  }

  async function save() {
    const problem = validate(d);
    if (problem) {
      formError = problem;
      paintBody('srv-name');
      return;
    }
    const spec = specOf(d, server);
    let res = testResult && testResult.key === JSON.stringify(spec) ? testResult : null;
    if (!res) {
      // Save runs a test first when none has passed for this exact setup.
      const t = await api.post('/api/mcp/test', { spec });
      res = t ? { ok: !!t.ok, tools: t.tools, error: t.error } : null;
    }
    const saved = editing
      ? await api.put('/api/mcp/' + enc(server.id), spec)
      : await api.post('/api/mcp', spec);
    if (!saved) return;
    dlg.close();
    if (res && res.ok) toast('Saved ' + spec.name, { title: toolSummary(res.tools) });
    else toast('Saved ' + spec.name, { kind: 'info', title: 'It did not connect yet', detail: res ? res.error : undefined });
  }

  dlg = openDialog({
    title: editing ? 'Edit ' + server.name : 'Add MCP server',
    description: 'Connect a tool server that runs on this computer.',
    width: 460,
    body: () => { paintBody(null); return container; },
    actions: [
      { label: 'Cancel', variant: 'outline' },
      { label: editing ? 'Save changes' : 'Save', variant: 'primary', primary: true, keepOpen: true, onClick: save }
    ]
  });
}
