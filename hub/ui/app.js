/* Beacon Hub desktop UI. Plain browser JS, no build step.
 * Add ?demo=1 to the page URL to run against a built-in fake /api/state. */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  var TOKEN = readToken();

  var PASTELS = ['pink', 'yellow', 'blue', 'green', 'lilac', 'peach'];
  var ROUTES = [
    { id: 'agents', label: 'Agents' },
    { id: 'vault', label: 'Vault' },
    { id: 'activity', label: 'Activity' },
    { id: 'health', label: 'Health' },
    { id: 'connections', label: 'Connections' }
  ];
  var OPS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '==': 'is', '=': 'is' };
  var BRAINS = [
    ['none', 'Off'],
    ['claude', 'Claude'],
    ['codex', 'Codex'],
    ['gemini', 'Gemini'],
    ['api', 'API key']
  ];

  var ICON_PATHS = {
    agents: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.6 3.6-5.5 7-5.5s6 1.9 7 5.5"/>',
    vault: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8v-1.1M12 16.3v-1.1M8.8 12H7.7M16.3 12h-1.1"/>',
    send: '<path d="M21 4L3.5 11l7 2.5L13 20.5 21 4z"/><path d="M10.5 13.5L21 4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
    health: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    connections: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    zap: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>'
  };

  var state = null;
  var enterNext = true;
  var busy = {};
  var drafts = {};
  var healthMember = null;
  var csvText = '';
  var tgPair = null;
  var beaconPair = null;
  var brainPick = null;
  var brainKey = '';
  var toastTimer = null;
  var vault = { q: '', group: 'all', level: 'all' };
  var adding = {};
  var drawerId = null;
  var drawerReturn = null;

  var view = document.getElementById('view');
  var nav = document.getElementById('nav');
  var sheet = document.getElementById('sheet');
  var toastEl = document.getElementById('toast');

  /* ---------- helpers ---------- */

  function readToken() {
    var t = params.get('t');
    try {
      if (t) sessionStorage.setItem('beaconHubToken', t);
      else t = sessionStorage.getItem('beaconHubToken') || '';
    } catch (e) {
      t = t || '';
    }
    return t || '';
  }

  function icon(name) {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[name] || '') + '</svg>';
  }

  // Small DOM builder. Text children are inserted as text nodes (safe).
  // Only the `html` prop injects markup, and it is used for the icons above.
  function h(tag, props, kids) {
    var n = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'value') n.value = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    add(kids);
    return n;
  }

  function btn(label, o) {
    o = o || {};
    var kids = [];
    if (o.icon) kids.push(h('span', { class: 'bi', html: icon(o.icon) }));
    if (label) kids.push(label);
    return h('button', {
      type: 'button',
      class: 'btn' + (o.kind ? ' ' + o.kind : '') + (o.sm ? ' sm' : '') + (o.quiet ? ' quiet' : ''),
      title: o.title,
      'aria-label': o.aria,
      disabled: o.disabled,
      onclick: o.onclick
    }, kids);
  }

  function anim(node, i) {
    if (enterNext) {
      node.classList.add('rise');
      node.style.setProperty('--d', Math.min(i, 12) * 40 + 'ms');
    }
    return node;
  }

  function head(title, sub, actions) {
    return h('header', { class: 'head' }, [
      h('div', null, [h('h1', null, title), h('p', { class: 'muted' }, sub)]),
      h('div', { class: 'actions' }, actions || [])
    ]);
  }

  function empty(title, text, action) {
    return h('div', { class: 'empty rise' }, [
      h('h2', null, title),
      h('p', null, text),
      action || null
    ]);
  }

  function badge(text, on) {
    return h('span', { class: 'badge' + (on ? ' on' : '') }, text);
  }

  function when(v) {
    var d = new Date(v);
    if (!v || isNaN(d.getTime())) return '';
    var s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function sevClass(s) {
    s = String(s || '').toLowerCase();
    if (/high|urgent|critical|red/.test(s)) return 'high';
    if (/med|warn|amber|yellow/.test(s)) return 'medium';
    return 'low';
  }

  function ruleLabel(r) {
    if (r.name) return r.name;
    var when_ = r.when || {};
    var conds = when_.conditions || [];
    var parts = conds.map(function (c) {
      return c.metric + ' ' + (OPS[c.op] || c.op) + ' ' + c.value;
    });
    var joiner = when_.mode === 'any' ? ' or ' : ' and ';
    return parts.join(joiner) || r.message || 'Rule';
  }

  function agentName(id) {
    var a = ((state && state.agents) || []).filter(function (x) { return x.id === id; })[0];
    return a ? a.name : id;
  }

  function lastRun(id) {
    var best = null;
    var bestT = -1;
    ((state && state.runs) || []).forEach(function (r) {
      if ((r.agentId || r.agent) !== id) return;
      var t = new Date(r.at).getTime() || 0;
      if (t >= bestT) { best = r; bestT = t; }
    });
    return best;
  }

  /* ---------- toast, api, state ---------- */

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 3200);
  }

  function api(method, path, body) {
    if (DEMO) return mock(method, path, body);
    var opts = { method: method, headers: { 'x-hub-token': TOKEN } };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          throw new Error((data && (data.error || data.message)) || ('Request failed (' + r.status + ')'));
        }
        return data || {};
      });
    }, function () {
      throw new Error("Can't reach the hub. Is the server running?");
    });
  }

  // Resolves with the data, or null after showing an error toast.
  function ask(method, path, body) {
    return api(method, path, body).catch(function (e) {
      toast(e.message, true);
      return null;
    });
  }

  // Like ask, then shows a success message and refreshes state.
  function act(method, path, body, okMsg) {
    return ask(method, path, body).then(function (d) {
      if (d === null) return null;
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(d) : okMsg);
      refresh();
      return d;
    });
  }

  function refresh() {
    return api('GET', '/api/state').then(function (s) {
      state = s;
      render();
    }, function (e) {
      toast(e.message, true);
    });
  }

  function listen() {
    if (DEMO || !window.EventSource) return;
    var es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
    es.onmessage = function () { refresh(); };
  }

  /* ---------- routing and render ---------- */

  function currentRoute() {
    var r = (location.hash || '').replace(/^#\/?/, '');
    return ROUTES.some(function (x) { return x.id === r; }) ? r : 'agents';
  }

  function go(r) {
    enterNext = true;
    if (location.hash === '#' + r) render();
    else location.hash = r;
  }

  function buildNav() {
    nav.replaceChildren.apply(nav, ROUTES.map(function (r) {
      return h('a', { class: 'nav-link', href: '#' + r.id, 'data-route': r.id }, [
        h('span', { class: 'nav-ico', html: icon(r.id) }),
        r.label
      ]);
    }));
  }

  function render() {
    if (!state) return;
    var r = currentRoute();
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      if (a.getAttribute('data-route') === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var pages = {
      agents: agentsPage,
      vault: vaultPage,
      activity: activityPage,
      health: healthPage,
      connections: connectionsPage
    };
    view.replaceChildren(pages[r]());
    if (r === 'vault') paintVault();
    renderSheet();
    renderDrawer();
    enterNext = false;
  }

  /* ---------- Agents ---------- */

  function tickNow() {
    act('POST', '/api/tick', null, function (d) {
      var n = (d && d.alerts) || 0;
      return n ? n + ' new alert' + (n === 1 ? '' : 's') : 'Checked. Nothing to report.';
    });
  }

  function agentsPage() {
    var agents = state.agents || [];
    var page = h('section', null, [
      head('Agents', 'Watchers that keep an eye on your family and speak up when it matters.', [
        btn('Check now', { kind: 'ghost', icon: 'zap', onclick: tickNow }),
        btn('Add agent', { icon: 'vault', onclick: function () { go('vault'); } })
      ])
    ]);
    if (!agents.length) {
      page.appendChild(empty('No agents yet',
        'Pick a ready agent from the vault to start watching something, like heat at home or a school run.',
        btn('Open the vault', { icon: 'vault', onclick: function () { go('vault'); } })));
      return page;
    }
    var grid = h('div', { class: 'grid' });
    agents.forEach(function (a, i) {
      grid.appendChild(anim(agentCard(a, i), i));
    });
    page.appendChild(grid);
    return page;
  }

  function runAgent(a) {
    busy[a.id] = true;
    render();
    ask('POST', '/api/agents/' + a.id + '/run').then(function (d) {
      delete busy[a.id];
      if (d) {
        var n = d.signals || 0;
        toast(a.name + ': ' + n + ' signal' + (n === 1 ? '' : 's'));
      }
      refresh();
    });
  }

  function agentCard(a, i) {
    var last = lastRun(a.id);
    var isBusy = !!busy[a.id];
    var dot = isBusy ? ['run', 'Checking now'] : (a.enabled ? ['ok', 'Watching, every ' + (a.everyMin || 5) + ' min'] : ['', 'Paused']);
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, a.avatar);

    var rules = a.rules || [];
    var chips = rules.length
      ? h('div', { class: 'rules' }, rules.map(function (r) {
          return h('span', { class: 'chip' }, [
            h('span', { class: 'chip-text' }, ruleLabel(r)),
            h('button', {
              type: 'button',
              title: 'Remove rule',
              'aria-label': 'Remove rule',
              onclick: function () { act('DELETE', '/api/agents/' + a.id + '/rules/' + r.id, null, 'Rule removed'); },
              html: icon('x')
            })
          ]);
        }))
      : h('p', { class: 'small muted', style: 'margin-top:10px' }, 'No rules yet. Say one below.');

    var input = h('input', {
      type: 'text',
      placeholder: 'Add a rule in plain words',
      'aria-label': 'Add a rule for ' + a.name,
      value: drafts[a.id] || '',
      oninput: function () { drafts[a.id] = this.value; }
    });
    var submit = function () {
      var text = (input.value || '').trim();
      if (!text) return;
      ask('POST', '/api/agents/' + a.id + '/rules', { text: text }).then(function (d) {
        if (!d) return;
        drafts[a.id] = '';
        toast('Rule added' + (d.via === 'haiku' ? ' (read by Haiku)' : ''));
        refresh();
      });
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    var place = [a.place && a.place.name, (a.watch || []).join(', ')].filter(Boolean).join(' · ');

    return h('article', { class: 'card p-' + PASTELS[i % PASTELS.length] }, [
      h('div', { class: 'agent-top' }, [
        h('div', { class: 'av' }, canvas),
        h('div', { class: 'grow' }, [
          h('h3', { class: 'name' }, a.name),
          h('div', { class: 'status' }, [h('span', { class: 'dot ' + dot[0] }), dot[1]])
        ]),
        h('button', {
          type: 'button',
          class: 'switch',
          role: 'switch',
          'aria-checked': a.enabled ? 'true' : 'false',
          'aria-label': (a.enabled ? 'Pause ' : 'Start ') + a.name,
          onclick: function () {
            act('POST', '/api/agents/' + a.id + '/toggle', null, (a.enabled ? 'Paused ' : 'Watching ') + a.name);
          }
        })
      ]),
      place ? h('div', { class: 'place' }, place) : null,
      chips,
      h('div', { class: 'field' }, [input, btn('Add', { kind: 'ghost', icon: 'plus', onclick: submit })]),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, last ? 'Last run ' + when(last.at) : 'Not run yet'),
        h('div', { class: 'actions' }, [
          btn(isBusy ? 'Checking' : 'Run now', { kind: 'ghost', sm: true, icon: 'play', disabled: isBusy, onclick: function () { runAgent(a); } }),
          btn('', {
            kind: 'ghost', sm: true, quiet: true, icon: 'trash', title: 'Delete', aria: 'Delete ' + a.name,
            onclick: function () {
              if (window.confirm('Delete ' + a.name + '?')) act('DELETE', '/api/agents/' + a.id, null, 'Deleted ' + a.name);
            }
          })
        ])
      ])
    ]);
  }

  /* ---------- Vault ---------- */

  var VAULT_GROUPS = [['all', 'All'], ['disaster', 'Disaster'], ['help', 'Help'], ['medicine', 'Medicine'], ['child', 'Child'], ['prepare', 'Prepare']];
  var VAULT_LEVELS = [['all', 'Any level'], ['starter', 'Starter'], ['guardian', 'Guardian'], ['expert', 'Expert']];
  var GROUP_TINT = { disaster: 'blue', help: 'pink', medicine: 'green', child: 'yellow', prepare: 'lilac' };
  var LEVEL_WORDS = { starter: 'Starter', guardian: 'Guardian', expert: 'Expert' };
  var NEED_ICON = { health: 'health', telegram: 'send', phone: 'phone' };
  var NEED_WORDS = { health: 'Needs health readings', telegram: 'Needs the Telegram group', phone: 'Needs a paired phone' };
  var OP_WORDS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '==': 'is', '!=': 'is not', '=': 'is' };
  var METRIC_WORDS = {
    temp_c: 'temperature', feels_like_c: 'feels-like temperature', humidity_pct: 'humidity',
    heat_index_c: 'heat index', wind_kmh: 'wind speed', wind_gust_kmh: 'wind gusts',
    rain_mm_24h: 'rain in 24 hours', rain_mm_now: 'rain right now', uv_index: 'UV index',
    aqi: 'air quality index', pm25: 'PM2.5 fine dust',
    quake_max_mag: 'largest quake magnitude', quake_nearest_km: 'nearest quake (km)', quake_count: 'number of quakes',
    official_alert_count: 'active official alerts', official_alert_max: 'official alert level',
    water_days: 'water stock (days)', food_days: 'food stock (days)', medicine_days: 'medicine stock (days)'
  };
  var STATUS_WORDS = ['ok', 'needs attention', 'urgent'];
  var ALERT_WORDS = ['info', 'watch', 'warning', 'severe'];
  var SEVERITY_WORDS = { info: 'a note', watch: 'a watch note', warning: 'a warning', severe: 'a severe alert' };

  function findTpl(id) {
    return ((state && state.templates) || []).filter(function (x) { return x.id === id; })[0];
  }

  function isAdded(id) {
    return ((state && state.agents) || []).some(function (a) { return a.templateId === id; });
  }

  function tintOf(t) {
    return GROUP_TINT[String(t.group || '').toLowerCase()] || 'blue';
  }

  // "hr:Maa" -> "Maa's heart rate"; plain metrics get a readable name.
  function metricWords(m) {
    var i = m.indexOf(':');
    if (i > 0) {
      var kind = m.slice(0, i);
      var who = m.slice(i + 1);
      var poss = who + "'s";
      if (kind === 'hr') return poss + ' heart rate';
      if (kind === 'spo2') return poss + ' oxygen (SpO2)';
      if (kind === 'steps') return poss + ' steps';
      if (kind === 'sleep_h') return poss + ' sleep (hours)';
      if (kind === 'health_status') return poss + ' health status';
      if (kind === 'minutes_to_dose') return 'minutes until the ' + who + ' dose';
    }
    return METRIC_WORDS[m] || m.replace(/_/g, ' ');
  }

  function condWords(c) {
    var m = c.metric;
    var value = String(c.value);
    if (m.indexOf('health_status:') === 0) value = STATUS_WORDS[c.value] || value;
    if (m.indexOf('official_alert_max') === 0) value = ALERT_WORDS[c.value] || value;
    return metricWords(m) + ' ' + (OP_WORDS[c.op] || c.op) + ' ' + value;
  }

  // Rules in plain words, e.g. "When heat index above 41 and Maa's heart rate above 110, send a severe alert."
  function ruleWords(r) {
    var w = r.when || {};
    var joined = (w.conditions || []).map(condWords).join(w.mode === 'any' ? ' or ' : ' and ');
    if (!joined) return r.message || '';
    return 'When ' + joined + ', send ' + (SEVERITY_WORDS[r.severity] || 'an alert') + '.';
  }

  function needIcon(n) {
    return icon(NEED_ICON[n] || 'zap');
  }

  function vaultMatches(t) {
    if (vault.group !== 'all' && String(t.group).toLowerCase() !== vault.group) return false;
    if (vault.level !== 'all' && t.level !== vault.level) return false;
    var q = vault.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [t.name, t.summary, t.about, t.who, (t.watches || []).join(' '), (t.sources || []).join(' ')]
      .join(' ').toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function vaultPage() {
    var page = h('section', { class: 'vault' }, [
      h('header', { class: 'head vault-head' }, [
        h('div', null, [
          h('h1', null, 'Vault'),
          h('p', { class: 'muted' }, 'Ready agents, each one explained. Open one to see what it watches and what it would tell you.')
        ]),
        h('div', { class: 'vault-door', 'aria-hidden': 'true', html: VAULT_DOOR_SVG })
      ])
    ]);
    if (!state.templates || !state.templates.length) {
      page.appendChild(empty('The vault is empty', 'Ready agents ship with the hub. Check that the hub installed correctly.'));
      return page;
    }
    function chipRow(label, list, key) {
      return h('div', { class: 'vchips', role: 'group', 'aria-label': label }, list.map(function (x) {
        var on = vault[key] === x[0];
        return h('button', {
          type: 'button', class: 'vchip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () { vault[key] = x[0]; render(); }
        }, x[1]);
      }));
    }
    page.appendChild(h('div', { class: 'vault-tools' }, [
      h('input', {
        type: 'search', class: 'vsearch', placeholder: 'Search by name, what it watches, or who it helps',
        'aria-label': 'Search the vault', value: vault.q,
        oninput: function () { vault.q = this.value; paintVault(); }
      }),
      chipRow('Group', VAULT_GROUPS, 'group'),
      chipRow('Level', VAULT_LEVELS, 'level')
    ]));
    page.appendChild(h('p', { class: 'small muted vcount', id: 'vaultCount' }, ''));
    page.appendChild(h('div', { class: 'grid', id: 'vaultGrid' }));
    return page;
  }

  function paintVault() {
    var grid = document.getElementById('vaultGrid');
    var count = document.getElementById('vaultCount');
    if (!grid || !state) return;
    var all = state.templates || [];
    var list = all.filter(vaultMatches);
    if (count) {
      count.textContent = list.length === all.length
        ? all.length + ' ready agents'
        : 'Showing ' + list.length + ' of ' + all.length;
    }
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'empty' }, [
        h('h2', null, 'Nothing matches'),
        h('p', null, 'Try another word, or clear the filters.')
      ]));
      return;
    }
    grid.replaceChildren.apply(grid, list.map(function (t, i) {
      return anim(vaultCard(t, i, isAdded(t.id)), i);
    }));
  }

  function vaultCard(t, i, added) {
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, t.avatar);
    var level = t.level || 'starter';
    var needs = (t.needs || []).map(function (n) {
      return h('span', { class: 'need', title: NEED_WORDS[n] || n, 'aria-label': NEED_WORDS[n] || n, html: needIcon(n) });
    });
    return h('article', {
      class: 'card vault-card p-' + tintOf(t),
      role: 'button',
      tabindex: '0',
      'aria-label': 'Open ' + t.name,
      onclick: function () { openDrawer(t.id); },
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(t.id); }
      }
    }, [
      h('div', { class: 'agent-top' }, [
        h('div', { class: 'av' }, canvas),
        h('div', { class: 'grow' }, [h('h3', { class: 'name' }, t.name)])
      ]),
      h('p', { class: 'small vsum' }, t.summary || ''),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'needs' }, needs),
        h('span', { class: 'row-inline-sm' }, [
          added ? badge('In my agents', true) : null,
          h('span', { class: 'badge lvl' }, LEVEL_WORDS[level] || 'Starter')
        ])
      ])
    ]);
  }

  /* ---------- Vault drawer ---------- */

  function openDrawer(id) {
    var d = document.getElementById('drawer');
    if (!d || !findTpl(id)) return;
    drawerReturn = document.activeElement;
    drawerId = id;
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    renderDrawer();
    var close = d.querySelector('.drawer-close');
    if (close) close.focus();
  }

  function closeDrawer() {
    var d = document.getElementById('drawer');
    if (!d || !d.classList.contains('open')) return;
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    drawerId = null;
    if (drawerReturn && drawerReturn.focus) drawerReturn.focus();
    drawerReturn = null;
  }

  function renderDrawer() {
    var d = document.getElementById('drawer');
    if (!d || !d.classList.contains('open') || !drawerId) return;
    var t = findTpl(drawerId);
    if (!t) { closeDrawer(); return; }
    var panel = d.querySelector('.drawer-panel');
    if (panel.getAttribute('data-id') !== t.id) {
      panel.setAttribute('data-id', t.id);
      panel.replaceChildren.apply(panel, drawerBody(t));
    }
    paintDrawerAct();
  }

  function vsec(title, kids) {
    return h('section', { class: 'vsec' }, [h('h3', { class: 'vsec-title' }, title), kids]);
  }

  function drawerBody(t) {
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, t.avatar);
    var level = t.level || 'starter';
    var needs = (t.needs || []).map(function (n) {
      return h('span', { class: 'need', title: NEED_WORDS[n] || n, 'aria-label': NEED_WORDS[n] || n, html: needIcon(n) });
    });
    var rules = t.agent && t.agent.rules ? t.agent.rules : [];
    return [
      h('div', { class: 'drawer-top' }, [
        h('span', { class: 'small muted' }, 'Vault · ' + (t.group ? String(t.group).charAt(0).toUpperCase() + String(t.group).slice(1) : 'Agent')),
        h('button', { type: 'button', class: 'drawer-close', title: 'Close', 'aria-label': 'Close', onclick: closeDrawer, html: icon('x') })
      ]),
      h('div', { class: 'drawer-hero p-' + tintOf(t) }, [
        h('div', { class: 'av big' }, canvas),
        h('div', { class: 'grow' }, [
          h('h2', { id: 'drawerTitle', class: 'drawer-title' }, t.name),
          h('p', { class: 'small' }, t.summary || ''),
          h('div', { class: 'hero-meta' }, [h('span', { class: 'badge lvl' }, LEVEL_WORDS[level] || 'Starter'), h('span', { class: 'needs' }, needs)])
        ])
      ]),
      vsec('About', h('p', { class: 'vtext' }, t.about || '')),
      vsec('Watches', h('div', { class: 'vchips-static' }, (t.watches || []).map(function (w) {
        return h('span', { class: 'chip' }, w);
      }))),
      vsec('Data sources', h('ul', { class: 'vlist' }, (t.sources || []).map(function (s) { return h('li', null, s); }))),
      vsec('Who it helps', h('p', { class: 'vtext' }, t.who || '')),
      vsec('Example alert', h('blockquote', { class: 'quote vquote' }, t.example || '')),
      rules.length ? vsec('Rules in plain words', h('ol', { class: 'vrules' }, rules.map(function (r) {
        return h('li', null, [
          h('strong', null, r.name || 'Rule'),
          h('span', { class: 'small muted vrule-text' }, ruleWords(r))
        ]);
      }))) : null,
      h('div', { class: 'drawer-act' })
    ].filter(Boolean);
  }

  function addFromDrawer(t) {
    if (adding[t.id]) return;
    adding[t.id] = true;
    paintDrawerAct();
    ask('POST', '/api/agents', { templateId: t.id }).then(function (d) {
      delete adding[t.id];
      if (d) {
        toast('Added ' + t.name);
        refresh();
      } else {
        paintDrawerAct();
      }
    });
  }

  function paintDrawerAct() {
    var panel = document.querySelector('#drawer .drawer-panel');
    var t = drawerId && findTpl(drawerId);
    var slot = panel && panel.querySelector('.drawer-act');
    if (!t || !slot) return;
    var kids;
    if (isAdded(t.id)) {
      kids = [
        h('span', { class: 'added-note' }, [icon('check'), ' Added']),
        h('a', { class: 'vlink', href: '#agents', onclick: closeDrawer }, 'Go to Agents')
      ];
    } else {
      kids = [
        h('button', {
          type: 'button', class: 'pill', disabled: !!adding[t.id],
          onclick: function () { addFromDrawer(t); }
        }, adding[t.id] ? 'Adding...' : 'Add to my agents')
      ];
    }
    slot.replaceChildren.apply(slot, kids);
  }

  var VAULT_DOOR_SVG =
    '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
    '<rect x="6" y="6" width="52" height="52" rx="14"/>' +
    '<rect x="12" y="12" width="40" height="40" rx="10" opacity=".4"/>' +
    '<g class="dial"><circle cx="32" cy="32" r="11"/><path d="M32 22.5v3M32 38.5v3M22.5 32h3M38.5 32h3"/>' +
    '<circle cx="32" cy="32" r="2" fill="currentColor"/></g></svg>';

  /* ---------- Activity ---------- */

  function activityPage() {
    var alerts = state.alerts || [];
    var runs = state.runs || [];
    var audit = state.audit || [];

    var alertRows = alerts.length
      ? alerts.map(function (a) {
          return h('div', { class: 'row' }, [
            h('span', { class: 'sev ' + sevClass(a.severity) }),
            h('div', null, [
              h('div', { class: 'row-title' }, a.title || 'Alert'),
              a.body ? h('div', { class: 'row-sub' }, a.body) : null,
              a.note ? h('div', { class: 'row-sub' }, 'Note: ' + a.note) : null,
              h('div', { class: 'row-meta' }, [
                (a.channels || []).join(', '),
                a.status ? ' · ' + a.status : '',
                ' · ' + when(a.at)
              ].join(''))
            ])
          ]);
        })
      : [h('p', { class: 'muted' }, 'Nothing has come up. Quiet is good.')];

    var runRows = runs.length
      ? runs.slice().reverse().map(function (r) {
          var n = r.signals || 0;
          return h('div', { class: 'row row-quiet' }, [
            h('div', { class: 'row-title' }, [
              (r.agentName || agentName(r.agentId || r.agent)) + ' · ',
              h('span', { class: 'muted' }, n + ' signal' + (n === 1 ? '' : 's') + ' · ' + when(r.at))
            ])
          ]);
        })
      : [h('p', { class: 'muted' }, 'No runs yet. Use Run now on an agent to try one.')];

    var auditRows = audit.length
      ? audit.slice().reverse().map(function (x) {
          return h('div', { class: 'row row-quiet' }, [
            h('div', null, [
              h('div', { class: 'row-title' }, [
                x.event || 'event',
                h('span', { class: 'muted' }, ' · ' + (x.channel || '') + ' · ' + when(x.at))
              ]),
              x.text ? h('div', { class: 'row-sub' }, x.text) : null,
              x.error ? h('div', { class: 'row-sub err-text' }, x.error) : null
            ])
          ]);
        })
      : [h('p', { class: 'muted' }, 'Messages sent from the hub will be logged here.')];

    return h('section', null, [
      head('Activity', 'What the hub noticed, ran, and sent.', [
        btn('Check now', { kind: 'ghost', icon: 'zap', onclick: tickNow })
      ]),
      h('div', { class: 'section' }, [h('h2', null, 'Alerts'), h('div', null, alertRows)]),
      h('div', { class: 'section' }, [h('h2', null, 'Runs'), h('div', null, runRows)]),
      h('div', { class: 'section' }, [h('h2', null, 'Audit'), h('div', null, auditRows)])
    ]);
  }

  /* ---------- Health ---------- */

  function healthPage() {
    var members = state.members || [];
    var page = h('section', null, [
      head('Health', 'Readings for family members. They feed the agents and never leave this computer.')
    ]);
    if (!members.length) {
      page.appendChild(empty('No family members yet', 'Add people in Beacon and they will show up here.'));
      return page;
    }
    if (!healthMember || members.indexOf(healthMember) < 0) healthMember = members[0];

    var picker = h('label', { class: 'flabel', style: 'max-width:240px;margin-bottom:14px' }, [
      h('span', null, 'Family member'),
      h('select', {
        'aria-label': 'Family member',
        onchange: function () { healthMember = this.value; render(); }
      }, members.map(function (m) {
        return h('option', { value: m, selected: m === healthMember }, m);
      }))
    ]);

    var fields = {};
    var defs = [
      ['hr', 'Heart rate (bpm)', '1'],
      ['spo2', 'SpO2 (%)', '1'],
      ['steps', 'Steps', '1'],
      ['sleepHours', 'Sleep (hours)', '0.1']
    ];
    var formGrid = h('div', { class: 'form-grid' }, defs.map(function (d) {
      fields[d[0]] = h('input', { type: 'number', min: '0', step: d[2], inputmode: 'decimal' });
      return h('label', { class: 'flabel' }, [h('span', null, d[1]), fields[d[0]]]);
    }));

    function saveReading() {
      var body = { member: healthMember };
      var any = false;
      Object.keys(fields).forEach(function (k) {
        var v = fields[k].value;
        if (v !== '') { body[k] = Number(v); any = true; }
      });
      if (!any) { toast('Type at least one number first', true); return; }
      act('POST', '/api/health/reading', body, 'Saved a reading for ' + healthMember);
    }

    var manual = h('div', { class: 'card' }, [
      h('h2', { class: 'card-title' }, 'Add a reading'),
      formGrid,
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, 'Health data stays on this computer; only the short approved alert text is ever sent.'),
        btn('Save reading', { icon: 'check', onclick: saveReading })
      ])
    ]);

    function pickCsv(e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        csvText = String(reader.result || '');
        toast('Loaded ' + f.name);
      };
      reader.onerror = function () { toast('Could not read that file', true); };
      reader.readAsText(f);
    }

    function importCsv() {
      if (!csvText) { toast('Choose a CSV file first', true); return; }
      var member = healthMember;
      act('POST', '/api/health/csv', { text: csvText, member: member }, 'CSV imported for ' + member).then(function (d) {
        if (d) csvText = '';
      });
    }

    var csv = h('div', { class: 'card' }, [
      h('h2', { class: 'card-title' }, 'Import a CSV'),
      h('p', { class: 'small muted' }, 'Pick an export from a watch or health app. It is read here and stored locally.'),
      h('div', { style: 'margin-top:12px' }, [h('input', { type: 'file', accept: '.csv,text/csv', onchange: pickCsv })]),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, 'For ' + healthMember),
        btn('Import', { kind: 'ghost', icon: 'plus', onclick: importCsv })
      ])
    ]);

    page.appendChild(picker);
    page.appendChild(h('div', { class: 'two' }, [anim(manual, 0), anim(csv, 1)]));
    return page;
  }

  /* ---------- Connections ---------- */

  function connectionsPage() {
    var c = state.connections || {};
    var tg = c.telegram || {};
    var bc = c.beacon || {};
    var br = c.brain || {};
    var kind = brainPick || br.kind || 'none';

    var tokenInput = h('input', {
      type: 'password', placeholder: 'Bot token from BotFather', autocomplete: 'off', 'aria-label': 'Telegram bot token'
    });
    var telegram = h('div', { class: 'card' }, [
      h('div', { class: 'card-top' }, [
        h('h2', { class: 'card-title' }, 'Telegram'),
        badge(tg.connected ? 'Connected' : 'Not connected', tg.connected)
      ]),
      h('p', { class: 'small muted' },
        tg.connected
          ? (tg.paired || 0) + ' paired' + (tg.bot ? ' · @' + String(tg.bot).replace(/^@/, '') : '')
          : 'Create a bot with BotFather, paste its token, then pair your family group.'),
      h('div', { class: 'field' }, [
        tokenInput,
        btn('Save token', {
          kind: 'ghost', onclick: function () {
            var t = tokenInput.value.trim();
            if (!t) { toast('Paste the bot token first', true); return; }
            act('POST', '/api/telegram/token', { token: t }, 'Token saved');
          }
        })
      ]),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, 'Pairing links the group chat to this hub.'),
        btn('Get pairing code', {
          sm: true, icon: 'plus', onclick: function () {
            ask('POST', '/api/telegram/pair').then(function (d) {
              if (d) { tgPair = d; render(); }
            });
          }
        })
      ]),
      tgPair ? h('div', { style: 'margin-top:12px' }, [
        h('span', { class: 'code' }, tgPair.code),
        h('p', { class: 'small muted', style: 'margin-top:8px' },
          'Send /start ' + tgPair.code + ' in the family group to @' + String(tgPair.bot || '').replace(/^@/, '') + '.')
      ]) : null
    ]);

    var beacon = h('div', { class: 'card' }, [
      h('div', { class: 'card-top' }, [
        h('h2', { class: 'card-title' }, 'Beacon phone'),
        badge((bc.paired || 0) ? (bc.paired + ' paired') : 'Not paired', (bc.paired || 0) > 0)
      ]),
      h('p', { class: 'small muted' }, 'Pair the Beacon app on a phone to receive alerts there.'),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, ''),
        btn('Pair a phone', {
          sm: true, icon: 'plus', onclick: function () {
            ask('POST', '/api/beacon/pair').then(function (d) {
              if (d) { beaconPair = d; render(); }
            });
          }
        })
      ]),
      beaconPair ? h('div', null, [
        h('img', { class: 'qr', src: beaconPair.qr, alt: 'Beacon pairing QR code', width: 180, height: 180 }),
        h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Open Beacon > Settings > Desktop hub > Scan'),
        beaconPair.payload ? h('details', null, [
          h('summary', null, 'Show code as text'),
          h('code', { class: 'mono small' }, beaconPair.payload)
        ]) : null
      ]) : null
    ]);

    var brainOptions = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Brain' }, BRAINS.map(function (b) {
      return h('label', null, [
        h('input', {
          type: 'radio', name: 'brain', value: b[0], checked: kind === b[0],
          onchange: function () { brainPick = this.value; render(); }
        }),
        h('span', null, b[1])
      ]);
    }));

    var keyInput = h('input', {
      type: 'password', placeholder: 'API key', autocomplete: 'off', 'aria-label': 'API key',
      value: brainKey,
      oninput: function () { brainKey = this.value; }
    });

    var brain = h('div', { class: 'card' }, [
      h('div', { class: 'card-top' }, [
        h('h2', { class: 'card-title' }, 'Brain'),
        badge(br.ok ? 'Working' : 'Not reachable', br.ok)
      ]),
      h('p', { class: 'small muted' }, 'Which model reads plain-words rules and writes the short alert text.'),
      h('div', { class: 'row-inline' }, [brainOptions]),
      kind === 'api' ? h('div', { class: 'field', style: 'margin-top:4px' }, [keyInput]) : null,
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' },
          c.haiku ? 'Haiku is ready for plain-words rules.' : 'Plain-words rules use the built-in parser.'),
        btn('Save', {
          kind: 'ghost', sm: true, icon: 'check', onclick: function () {
            var k = brainPick || kind;
            act('POST', '/api/brain', { kind: k, apiKey: k === 'api' ? brainKey : undefined }, 'Brain set to ' + (BRAINS.filter(function (b) { return b[0] === k; })[0] || [k, k])[1]);
          }
        })
      ])
    ]);

    return h('section', null, [
      head('Connections', 'Telegram for the family group, Beacon for phones, and the brain that reads your words.'),
      h('div', { class: 'stack' }, [anim(telegram, 0), anim(beacon, 1), anim(brain, 2)])
    ]);
  }

  /* ---------- approval sheet ---------- */

  function renderSheet() {
    var p = state && state.pending;
    if (!p) {
      sheet.hidden = true;
      sheet.removeAttribute('data-id');
      sheet.replaceChildren();
      return;
    }
    if (sheet.getAttribute('data-id') === String(p.id)) return;
    sheet.setAttribute('data-id', String(p.id));

    var buttons = [
      h('button', { type: 'button', class: 'btn', onclick: function () { answer(p.id, 'once'); } }, 'Send once'),
      h('button', { type: 'button', class: 'btn ghost', onclick: function () { answer(p.id, 'always'); } }, 'Always allow'),
      h('button', { type: 'button', class: 'btn ghost', onclick: function () { answer(p.id, 'no'); } }, "Don't send")
    ];

    var card = h('div', { class: 'sheet-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheetTitle' }, [
      h('h2', { id: 'sheetTitle' }, 'Send this message?'),
      h('p', { class: 'small muted' }, 'Beacon wants to send this short alert to your family channels.'),
      h('blockquote', { class: 'quote' }, p.text),
      h('div', { class: 'row-inline' }, [
        h('span', { class: 'label small muted' }, 'Goes to'),
        (p.channels || []).map(function (c) { return h('span', { class: 'chip' }, c); })
      ]),
      h('div', { class: 'sheet-actions' }, buttons)
    ]);
    sheet.replaceChildren(card);
    sheet.hidden = false;
    buttons[0].focus();
  }

  function answer(id, ans) {
    var buttons = sheet.querySelectorAll('button');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    ask('POST', '/api/approve', { id: id, answer: ans }).then(function (d) {
      if (!d) {
        Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
        return;
      }
      toast(ans === 'no' ? 'Not sent' : ans === 'always' ? 'Sent, and always allowed' : 'Sent');
      refresh();
    });
  }

  /* ---------- init ---------- */

  document.getElementById('drawer').addEventListener('click', function (e) {
    if (e.target && e.target.getAttribute && e.target.getAttribute('data-close')) closeDrawer();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  function init() {
    buildNav();
    if (!DEMO && !TOKEN) {
      view.replaceChildren(empty('Open the hub from its link',
        'The address printed by the Beacon Hub server includes your access token.'));
      return;
    }
    view.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
    refresh();
    listen();
  }

  window.addEventListener('hashchange', function () {
    enterNext = true;
    render();
  });

  /* ---------- demo mode (?demo=1) ---------- */

  var demoState = null;

  function ago(ms) { return new Date(Date.now() - ms).toISOString(); }

  function demoData(withPending) {
    return {
      agents: [
        {
          id: 'ag1', name: 'Heat watch', avatar: 'sentinel', templateId: 'tpl-heat', enabled: true,
          watch: ['heat index', 'Maa heart rate'], place: { name: 'Home', lat: 0, lon: 0 }, members: ['Maa'], everyMin: 5,
          rules: [{
            id: 'ru1', name: 'Heat index above 41 and Maa heart rate above 110',
            when: { mode: 'all', conditions: [{ metric: 'heat', op: '>', value: 41 }, { metric: 'hr', op: '>', value: 110 }] },
            severity: 'high', message: 'Heat and heart rate are both high. Please check on Maa.'
          }],
          channels: ['telegram'], createdAt: ago(0)
        },
        {
          id: 'ag2', name: 'Medic on call', avatar: 'medic', templateId: 'tpl-med', enabled: false,
          watch: ['SpO2'], place: null, members: ['Papa'], everyMin: 10,
          rules: [{
            id: 'ru2', name: 'SpO2 below 92',
            when: { mode: 'all', conditions: [{ metric: 'spo2', op: '<', value: 92 }] },
            severity: 'high', message: 'Oxygen is low. Check on Papa now.'
          }],
          channels: ['telegram', 'beacon'], createdAt: ago(0)
        },
        {
          id: 'ag3', name: 'School run', avatar: 'guardian', templateId: 'tpl-child', enabled: true,
          watch: ['steps'], place: { name: 'School', lat: 0, lon: 0 }, members: ['Kiara'], everyMin: 15,
          rules: [], channels: ['beacon'], createdAt: ago(0)
        }
      ],
      templates: [
        {
          id: 'tpl-heat', name: 'Heatwave Guardian', summary: 'Combines heat and heart rate to protect older family members.',
          group: 'disaster', avatar: 'guardian', level: 'guardian', needs: ['health', 'phone'],
          about: 'Combines the heat index at home with an elder\'s heart rate, so a hot day and a racing heart are seen together. Heat is most dangerous for older people, and this agent suggests a cooler room before it becomes an emergency.',
          watches: ['Heat index', "Maa's heart rate", 'Temperature'],
          sources: ['Open-Meteo', 'Your health data (stays on this computer)'],
          example: 'Maa: heart rate 118, heatwave at 42 C. Move to a cooler room and call Dr. Asha.',
          who: 'Elders, people on heart medicine, outdoor workers',
          agent: { rules: [{ id: 'd1', name: 'Heat with high heart rate', severity: 'severe', message: '', when: { mode: 'all', conditions: [
            { metric: 'heat_index_c', op: '>', value: 41 }, { metric: 'hr:Maa', op: '>', value: 110 }] } }] }
        },
        {
          id: 'tpl-flood', name: 'Flood Watcher', summary: 'Follows rain for low-lying homes and says when to move to higher ground.',
          group: 'disaster', avatar: 'rescue', level: 'guardian', needs: ['phone'],
          about: 'Follows rain over the last hours and the day, and warns when water could start to rise near your home. Floods can come quicker than expected, so the advice is to move early to higher ground and keep to official instructions.',
          watches: ['Rain right now', 'Rain in the last 24 hours'],
          sources: ['Open-Meteo'],
          example: 'Extreme rain: 160 mm in 24 hours. Move to higher ground now if water is rising, and follow local instructions.',
          who: 'Homes near rivers, nallahs and basements, and the families who live there',
          agent: { rules: [{ id: 'd2', name: 'Move to higher ground', severity: 'severe', message: '', when: { mode: 'all', conditions: [
            { metric: 'rain_mm_24h', op: '>', value: 150 }] } }] }
        },
        {
          id: 'tpl-sos', name: 'Neighbour Helper', summary: 'Passes on help requests from the community to the family group.',
          group: 'help', avatar: 'rescue', level: 'guardian', needs: ['telegram'],
          about: 'Passes on help requests from the community, such as a neighbour who needs water or a ride, so the family group sees them in one place. It shares only the short request text and never sends health details.',
          watches: ['Official alerts near you', 'Strong earthquake nearby'],
          sources: ['NDMA SACHET', 'USGS'],
          example: 'Help request from the lane behind you: an elderly neighbour needs water. Can someone check?',
          who: 'Neighbourhood groups, apartment associations, families who help each other',
          agent: { rules: [{ id: 'd3', name: 'Quake, check on neighbours', severity: 'warning', message: '', when: { mode: 'all', conditions: [
            { metric: 'quake_max_mag', op: '>=', value: 4.5 }] } }] }
        },
        {
          id: 'tpl-med', name: 'Medicine Reminder', summary: 'Reminds before a dose and warns when stock runs low.',
          group: 'medicine', avatar: 'medic', level: 'starter', needs: ['health', 'phone'],
          about: 'Gives a heads-up shortly before a scheduled dose and warns when the medicine stock is running low. Missed doses and empty shelves are easy to avoid with a reminder a few minutes early.',
          watches: ['Minutes until the BP tablet dose', 'Medicine stock in days'],
          sources: ['Your medicine schedule', 'Your stock count (entered in Beacon)'],
          example: 'Maa: BP tablet due in 15 minutes. Medicine stock: 4 days left. Order a refill.',
          who: 'Anyone on daily medicine, and the family member who manages it',
          agent: { rules: [{ id: 'd4', name: 'Dose due soon', severity: 'watch', message: '', when: { mode: 'all', conditions: [
            { metric: 'minutes_to_dose:BP tablet', op: '<=', value: 15 }] } }] }
        },
        {
          id: 'tpl-child', name: 'Child Play Guardian', summary: 'Says when it is too hot, too smoggy or too strong in the sun to play outside.',
          group: 'child', avatar: 'guardian', level: 'starter', needs: ['phone'],
          about: 'Decides whether it is a good day for children to play outside, looking at the sun, the air and the heat. Children are more sensitive to heat and smog, so a plain "stay in today" is often the kindest advice.',
          watches: ['UV index', 'Air quality index (AQI)', 'Heat index'],
          sources: ['Open-Meteo'],
          example: 'UV index 9. Play in shade and keep a hat and water handy.',
          who: 'Children, and the adults who look after them at school or the park',
          agent: { rules: [{ id: 'd5', name: 'Strong sun', severity: 'warning', message: '', when: { mode: 'all', conditions: [
            { metric: 'uv_index', op: '>=', value: 8 }] } }] }
        },
        {
          id: 'tpl-kit', name: 'Preparedness Coach', summary: 'Nudges you to keep a week of water, food and medicine at home.',
          group: 'prepare', avatar: 'coach', level: 'starter', needs: ['phone'],
          about: 'Keeps a gentle count of water, food and medicine at home and nudges you when any of them falls under a week. Most emergencies are easier to handle when the cupboard is already stocked, so this agent helps you plan ahead.',
          watches: ['Water stock in days', 'Food stock in days', 'Medicine stock in days'],
          sources: ['Your stock count (entered in Beacon)'],
          example: 'Water stock is 5 days. Aim for 7 days at home.',
          who: 'Every household, especially before monsoon and summer',
          agent: { rules: [{ id: 'd6', name: 'Water under a week', severity: 'watch', message: '', when: { mode: 'all', conditions: [
            { metric: 'water_days', op: '<', value: 7 }] } }] }
        }
      ],
      runs: [
        { agentId: 'ag1', at: ago(4 * 60000), signals: 1 },
        { agentId: 'ag3', at: ago(3600000), signals: 0 }
      ],
      alerts: [
        { id: 'al1', severity: 'high', title: 'Heat and heart rate are high', body: 'Heat index 43. Maa heart rate 118.', channels: ['telegram'], at: ago(9 * 60000), status: 'sent', note: 'Maa is cooling down.' },
        { id: 'al2', severity: 'low', title: 'Steps goal reached', body: 'Kiara walked 8,200 steps today.', channels: ['beacon'], at: ago(5 * 3600000), status: 'sent' }
      ],
      audit: [
        { at: ago(9 * 60000), alertId: 'al1', channel: 'telegram', event: 'sent', text: 'Heat and heart rate are high. Maa heart rate 118.' },
        { at: ago(5 * 3600000), alertId: 'al2', channel: 'beacon', event: 'sent', text: 'Kiara walked 8,200 steps today.' },
        { at: ago(7200000), alertId: 'al0', channel: 'telegram', event: 'failed', text: 'Heat check', error: 'Chat not reachable' }
      ],
      connections: {
        telegram: { connected: true, paired: 3, bot: 'beacon_family_bot' },
        beacon: { paired: 2 },
        brain: { kind: 'claude', ok: true },
        haiku: true
      },
      pending: withPending ? {
        id: 'p1', alertId: 'al3',
        text: 'Heat index 43 at home. Maa heart rate 118. Please check on her now.',
        channels: ['telegram', 'beacon']
      } : null,
      members: ['Maa', 'Papa', 'Kiara']
    };
  }

  function qrDataUrl() {
    var cells = '';
    for (var y = 0; y < 21; y++) {
      for (var x = 0; x < 21; x++) {
        if (((x * 7 + y * 13 + x * y) % 5) < 2) cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges">' +
      '<rect width="21" height="21" fill="#fff"/><g fill="#111">' + cells + '</g></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function mock(method, path, body) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(mockRoute(method, path, body || {})); } catch (e) { reject(e); }
      }, 160);
    });
  }

  function mockRoute(m, p, b) {
    if (!demoState) demoState = demoData(params.get('pending') === '1');
    var S = demoState;
    var mm;
    function findAgent(id) {
      return S.agents.filter(function (x) { return x.id === id; })[0];
    }

    if (m === 'GET' && p === '/api/state') return JSON.parse(JSON.stringify(S));

    if (m === 'POST' && p === '/api/agents') {
      var t = S.templates.filter(function (x) { return x.id === b.templateId; })[0];
      if (!t) throw new Error('Template not found');
      S.agents.push({
        id: 'ag' + Date.now(), name: t.name, avatar: t.avatar, templateId: t.id, enabled: true,
        watch: [], place: null, members: [], everyMin: 5, rules: [], channels: ['telegram'], createdAt: new Date().toISOString()
      });
      return { ok: true };
    }
    if ((mm = p.match(/^\/api\/agents\/([^/]+)\/rules\/([^/]+)$/)) && m === 'DELETE') {
      var ar = findAgent(mm[1]);
      ar.rules = ar.rules.filter(function (r) { return r.id !== mm[2]; });
      return { ok: true };
    }
    if ((mm = p.match(/^\/api\/agents\/([^/]+)\/rules$/)) && m === 'POST') {
      var ag = findAgent(mm[1]);
      var rule = { id: 'ru' + Date.now(), name: b.text, when: { mode: 'all', conditions: [] }, severity: 'medium', message: b.text };
      ag.rules.push(rule);
      return { rule: rule, via: b.text.length > 40 ? 'haiku' : 'parser' };
    }
    if ((mm = p.match(/^\/api\/agents\/([^/]+)\/toggle$/)) && m === 'POST') {
      var at = findAgent(mm[1]);
      at.enabled = !at.enabled;
      return { ok: true };
    }
    if ((mm = p.match(/^\/api\/agents\/([^/]+)\/run$/)) && m === 'POST') {
      return { signals: 1 };
    }
    if ((mm = p.match(/^\/api\/agents\/([^/]+)$/))) {
      if (m === 'DELETE') {
        S.agents = S.agents.filter(function (x) { return x.id !== mm[1]; });
        return { ok: true };
      }
      if (m === 'PUT') {
        Object.assign(findAgent(mm[1]), b);
        return { ok: true };
      }
    }
    if (m === 'POST' && p === '/api/tick') return { alerts: 0 };
    if (m === 'POST' && p === '/api/approve') { S.pending = null; return { ok: true }; }
    if (m === 'POST' && (p === '/api/health/csv' || p === '/api/health/reading' || p === '/api/telegram/token')) return { ok: true };
    if (m === 'POST' && p === '/api/telegram/pair') return { code: 'LION-42', bot: 'beacon_family_bot' };
    if (m === 'POST' && p === '/api/beacon/pair') {
      S.connections.beacon.paired = S.connections.beacon.paired || 0;
      return { qr: qrDataUrl(), payload: 'beacon-hub://pair/DEMO-1234' };
    }
    if (m === 'POST' && p === '/api/brain') {
      S.connections.brain = { kind: b.kind, ok: b.kind !== 'none' };
      return { ok: true };
    }
    throw new Error('Demo: no route for ' + m + ' ' + p);
  }

  init();
})();
