/* Beacon Hub desktop UI. Plain browser JS, no build step.
 * Add ?demo=1 to the page URL to run against a built-in fake /api/state. */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  var TOKEN = readToken();

  var PASTELS = ['pink', 'yellow', 'blue', 'green', 'lilac', 'peach'];
  var LOOK_COLORS = ['#E0482F', '#FDB155', '#FFD85E', '#9EE6A0', '#2F9FB5', '#8FA1FB', '#B9A0FB', '#F670C4'];
  var CITIES = [
    ['Delhi', 28.6139, 77.2090],
    ['Mumbai', 19.0760, 72.8777],
    ['Chennai', 13.0827, 80.2707],
    ['Kolkata', 22.5726, 88.3639],
    ['Bengaluru', 12.9716, 77.5946],
    ['Hyderabad', 17.3850, 78.4867],
    ['Guwahati', 26.1445, 91.7362],
    ['Kochi', 9.9312, 76.2673]
  ];
  var ROUTES = [
    { id: 'agents', label: 'Agents' },
    { id: 'vault', label: 'Vault' },
    { id: 'school', label: 'School' },
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
    school: '<path d="M12 4L3 8.5 12 13l9-4.5L12 4z"/><path d="M6.5 10.5V15c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.5"/><path d="M21 8.5V14"/>',
    left: '<path d="M14.5 6.5L9 12l5.5 5.5"/>',
    right: '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
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
  var drawerMode = null;
  var wizard = null;
  var waking = false;
  var focusAgentId = null;

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

  function personaOf(id) {
    return ((state && state.personas) || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function roleOf(a) {
    var p = personaOf(a && a.personaId);
    return p ? p.role : '';
  }

  function avatarCanvas(a) {
    var c = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(c, a.avatar, a.look);
    return c;
  }

  function personaCanvas(p) {
    var c = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(c, p.avatar, p.look);
    return c;
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

  var SIT_WORDS = { calm: 'Calm', watch: 'Watch', alert: 'Alert', recovering: 'Recovering' };

  // Header chip: coloured dot, the phase word, and the headline as a second line and tooltip.
  function renderSituation() {
    var el = document.getElementById('situation');
    if (!el) return;
    var s = state && state.situation;
    if (!s || !SIT_WORDS[s.phase]) { el.hidden = true; return; }
    var word = SIT_WORDS[s.phase];
    el.hidden = false;
    el.className = 'situation sit-' + s.phase;
    el.title = s.headline;
    el.setAttribute('aria-label', 'Situation: ' + word + '. ' + s.headline);
    el.replaceChildren(
      h('span', { class: 'sit-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'sit-body' }, [
        h('strong', { class: 'sit-word' }, word),
        h('span', { class: 'sit-line' }, s.headline)
      ])
    );
  }

  function render() {
    if (!state) return;
    var r = currentRoute();
    renderSituation();
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      if (a.getAttribute('data-route') === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    renderAwake();
    var pages = {
      agents: agentsPage,
      vault: vaultPage,
      school: schoolPage,
      activity: activityPage,
      health: healthPage,
      connections: connectionsPage
    };
    var focus = focusAgentId;
    focusAgentId = null;
    view.replaceChildren(pages[r]());
    if (r === 'vault') paintVault();
    renderSheet();
    renderDrawer();
    if (r === 'agents' && focus) focusAgentCard(focus);
    enterNext = false;
  }

  /* ---------- awake rail ---------- */

  function renderAwake() {
    var rail = document.getElementById('awakeRail');
    if (!rail) return;
    var all = (state && state.agents) || [];
    var awake = all.filter(function (a) { return a.enabled; });
    var resting = all.filter(function (a) { return !a.enabled; });
    var kids = [
      h('section', { class: 'rail-sec' }, [
        h('div', { class: 'rail-head' }, [
          h('span', null, 'Awake'),
          h('span', { class: 'rail-count' }, String(awake.length))
        ]),
        awake.length
          ? h('div', { class: 'rail-list' }, awake.map(awakeRow))
          : h('p', { class: 'rail-empty small muted' }, 'No one awake yet.')
      ])
    ];
    if (resting.length) {
      kids.push(h('details', { class: 'rail-rest' }, [
        h('summary', null, 'Resting · ' + resting.length),
        h('div', { class: 'rail-list' }, resting.map(restingRow))
      ]));
    }
    rail.replaceChildren.apply(rail, kids);
  }

  function awakeRow(a) {
    var role = roleOf(a);
    return h('button', {
      type: 'button',
      class: 'rail-agent',
      title: a.name + (role ? ' · ' + role : ''),
      onclick: function () { openAgent(a.id); }
    }, [
      h('span', { class: 'rail-av' }, avatarCanvas(a)),
      h('span', { class: 'rail-txt' }, [
        h('span', { class: 'rail-name' }, a.name),
        role ? h('span', { class: 'rail-role' }, role) : null
      ]),
      h('span', { class: 'rail-dot', 'aria-label': 'Awake' })
    ]);
  }

  function restingRow(a) {
    var role = roleOf(a);
    return h('div', { class: 'rail-rest-row' }, [
      h('span', { class: 'rail-av' }, avatarCanvas(a)),
      h('span', { class: 'rail-txt' }, [
        h('span', { class: 'rail-name' }, a.name),
        role ? h('span', { class: 'rail-role' }, role) : null
      ]),
      h('button', {
        type: 'button', class: 'rail-wake', onclick: function () { wakeAgent(a); }
      }, 'Wake')
    ]);
  }

  function awakeStrip() {
    var awake = ((state && state.agents) || []).filter(function (a) { return a.enabled; });
    return h('div', { class: 'school-awake', 'aria-label': 'Awake agents' }, [
      h('span', { class: 'sa-label' }, 'Awake'),
      awake.length
        ? h('div', { class: 'sa-list' }, awake.map(function (a) {
            return h('button', {
              type: 'button', class: 'mini-agent', title: 'Open ' + a.name,
              onclick: function () { openAgent(a.id); }
            }, [avatarCanvas(a), h('span', null, a.name), h('span', { class: 'mini-dot' })]);
          }))
        : h('span', { class: 'small muted' }, 'No one awake yet.')
    ]);
  }

  function wakeAgent(a) {
    act('POST', '/api/agents/' + a.id + '/toggle', null, 'Woke ' + a.name);
  }

  function openAgent(id) {
    closeDrawer();
    focusAgentId = id;
    go('agents');
  }

  function focusAgentCard(id) {
    var el = view.querySelector('[data-agent-id="' + id + '"]');
    if (!el) return;
    el.classList.add('flash');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    setTimeout(function () { el.classList.remove('flash'); }, 2400);
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

  function wakeToggle(a) {
    var on = !!a.enabled;
    return h('button', {
      type: 'button',
      class: 'wake-toggle' + (on ? ' on' : ''),
      'aria-pressed': on ? 'true' : 'false',
      title: (on ? 'Rest ' : 'Wake ') + a.name,
      onclick: function (e) {
        e.stopPropagation();
        act('POST', '/api/agents/' + a.id + '/toggle', null, (on ? 'Resting ' : 'Waking ') + a.name);
      }
    }, [h('span', { class: 'wt-dot' }), on ? 'Rest' : 'Wake']);
  }

  function agentCard(a, i) {
    var last = lastRun(a.id);
    var isBusy = !!busy[a.id];
    var dot = isBusy ? ['run', 'Checking now'] : (a.enabled ? ['ok', 'Watching, every ' + (a.everyMin || 5) + ' min'] : ['', 'Paused']);
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, a.avatar, a.look);
    var persona = personaOf(a.personaId);

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

    return h('article', { class: 'card p-' + PASTELS[i % PASTELS.length], 'data-agent-id': a.id }, [
      h('div', { class: 'agent-top' }, [
        h('div', { class: 'av' }, canvas),
        h('div', { class: 'grow' }, [
          h('div', { class: 'name-row' }, [
            h('h3', { class: 'name' }, a.name),
            persona ? h('span', { class: 'role-chip' }, persona.role) : null
          ]),
          h('div', { class: 'status' }, [h('span', { class: 'dot ' + dot[0] }), dot[1]]),
          persona && persona.signature ? h('div', { class: 'sig small muted' }, persona.signature) : null
        ]),
        wakeToggle(a)
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

  /* ---------- School ---------- */

  function schoolPage() {
    var personas = (state && state.personas) || [];
    var page = h('section', { class: 'school' }, [
      head('School', 'Enrol an agent as a persona. Each brings a voice, a look and the missions it does best.', [awakeStrip()])
    ]);
    if (!personas.length) {
      page.appendChild(empty('The school is empty', 'Personas ship with the hub. Check that the hub installed correctly.'));
      return page;
    }
    var grid = h('div', { class: 'grid' });
    personas.forEach(function (p, i) {
      grid.appendChild(anim(schoolCard(p, i), i));
    });
    page.appendChild(grid);
    return page;
  }

  function schoolCard(p, i) {
    var missions = (p.templates || []).length;
    return h('article', {
      class: 'card school-card p-' + p.tint,
      role: 'button',
      tabindex: '0',
      'aria-label': 'Enrol as ' + p.role,
      onclick: function () { openSchoolDrawer(p.id); },
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSchoolDrawer(p.id); }
      }
    }, [
      h('div', { class: 'agent-top' }, [
        h('div', { class: 'av' }, personaCanvas(p)),
        h('div', { class: 'grow' }, [
          h('h3', { class: 'name' }, p.role),
          h('div', { class: 'persona-name small' }, p.name)
        ])
      ]),
      h('p', { class: 'tagline' }, p.tagline),
      h('div', { class: 'skill-chips' }, (p.skills || []).slice(0, 4).map(function (s) {
        return h('span', { class: 'chip' }, s);
      })),
      h('div', { class: 'card-foot' }, [
        h('span', { class: 'small muted' }, missions + ' mission' + (missions === 1 ? '' : 's')),
        h('span', { class: 'enrol-link' }, 'Enrol')
      ])
    ]);
  }

  function openSchoolDrawer(id) {
    var p = personaOf(id);
    if (!p) return;
    drawerReturn = document.activeElement;
    drawerMode = 'school';
    drawerId = null;
    waking = false;
    wizard = {
      personaId: p.id,
      step: 1,
      rev: 0,
      name: p.name,
      templateId: (p.templates || [])[0] || '',
      placeName: 'Delhi',
      lat: '28.6139',
      lon: '77.2090',
      members: 'Maa',
      channels: { telegram: true, beacon: false },
      look: { hair: p.look.hair, skin: p.look.skin, color: p.look.color },
      done: false,
      agentName: '',
      agent: null
    };
    var d = document.getElementById('drawer');
    if (!d) return;
    var panel = d.querySelector('.drawer-panel');
    if (panel) panel.setAttribute('data-key', '');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    renderDrawer();
    var close = d.querySelector('.drawer-close');
    if (close) close.focus();
  }

  function schoolPersona() {
    return wizard ? personaOf(wizard.personaId) : null;
  }

  function paintSchoolDrawer(panel) {
    var p = schoolPersona();
    if (!p) { closeDrawer(); return; }
    var key = 'school:' + p.id + ':' + wizard.step + ':' + wizard.rev + (wizard.done ? ':done' : '');
    if (panel.getAttribute('data-key') === key) return;
    panel.setAttribute('data-key', key);
    panel.className = 'drawer-panel p-' + p.tint;
    panel.replaceChildren.apply(panel, schoolDrawerBody(p));
  }

  function schoolDrawerBody(p) {
    if (wizard.done) return schoolDone(p);
    var nodes = [wizTop('School · Step ' + wizard.step + ' of 3'), wizProgress(wizard.step)];
    var body = wizard.step === 1 ? wizStepOne(p) : wizard.step === 2 ? wizStepTwo(p) : wizStepThree(p);
    return nodes.concat(body);
  }

  function wizTop(label) {
    return h('div', { class: 'drawer-top' }, [
      h('span', { class: 'small muted' }, label),
      h('button', { type: 'button', class: 'drawer-close', title: 'Close', 'aria-label': 'Close', onclick: closeDrawer, html: icon('x') })
    ]);
  }

  function wizProgress(step) {
    return h('div', { class: 'wiz-progress', 'aria-hidden': 'true' }, [1, 2, 3].map(function (n) {
      return h('span', { class: 'wiz-dot' + (n <= step ? ' on' : '') });
    }));
  }

  function wizStepOne(p) {
    return [
      h('div', { class: 'drawer-hero p-' + p.tint }, [
        h('div', { class: 'av big' }, personaCanvas(p)),
        h('div', { class: 'grow' }, [
          h('h2', { id: 'drawerTitle', class: 'drawer-title' }, p.role),
          h('p', { class: 'small' }, p.name + ' · ' + p.tagline)
        ])
      ]),
      vsec('About', h('p', { class: 'vtext' }, p.about)),
      vsec('Skills', h('div', { class: 'skill-chips' }, (p.skills || []).map(function (s) {
        return h('span', { class: 'chip' }, s);
      }))),
      vsec('Voice', h('blockquote', { class: 'quote vquote' }, p.voice)),
      h('div', { class: 'wiz-foot' }, [
        h('span', { class: 'small muted' }, 'Step 1 · Persona'),
        h('button', { type: 'button', class: 'pill', onclick: function () { wizard.step = 2; wizard.rev++; renderDrawer(); } }, 'Continue')
      ])
    ];
  }

  function wizStepTwo(p) {
    var missions = (p.templates || []).map(findTpl).filter(Boolean);
    if (missions.length && !missions.some(function (m) { return m.id === wizard.templateId; })) wizard.templateId = missions[0].id;

    var nameInput = h('input', {
      type: 'text', value: wizard.name, 'aria-label': 'Agent name',
      oninput: function () { wizard.name = this.value; }
    });

    var placeInput = h('input', {
      type: 'text', value: wizard.placeName, 'aria-label': 'Place name',
      oninput: function () { wizard.placeName = this.value; }
    });
    var latInput = h('input', {
      type: 'number', step: '0.0001', value: wizard.lat, 'aria-label': 'Latitude',
      oninput: function () { wizard.lat = this.value; }
    });
    var lonInput = h('input', {
      type: 'number', step: '0.0001', value: wizard.lon, 'aria-label': 'Longitude',
      oninput: function () { wizard.lon = this.value; }
    });

    var cityButtons = CITIES.map(function (c) {
      return h('button', {
        type: 'button', class: 'city-btn', onclick: function () {
          wizard.placeName = c[0];
          wizard.lat = String(c[1]);
          wizard.lon = String(c[2]);
          placeInput.value = c[0];
          latInput.value = wizard.lat;
          lonInput.value = wizard.lon;
        }
      }, c[0]);
    });

    var membersInput = h('input', {
      type: 'text', value: wizard.members, 'aria-label': 'Family members',
      placeholder: 'Maa, Papa', oninput: function () { wizard.members = this.value; }
    });

    function chanToggle(key, label) {
      var on = !!wizard.channels[key];
      return h('button', {
        type: 'button', class: 'chan-toggle', 'aria-pressed': on ? 'true' : 'false',
        onclick: function () {
          var next = !wizard.channels[key];
          var other = key === 'telegram' ? 'beacon' : 'telegram';
          if (!next && !wizard.channels[other]) { toast('Keep at least one channel on', true); return; }
          wizard.channels[key] = next;
          this.setAttribute('aria-pressed', next ? 'true' : 'false');
        }
      }, label);
    }

    var missionCards = missions.map(function (m) {
      return h('label', { class: 'mission' }, [
        h('input', {
          type: 'radio', name: 'mission', value: m.id, checked: wizard.templateId === m.id,
          onchange: function () { wizard.templateId = this.value; }
        }),
        h('span', { class: 'mission-body' }, [
          h('span', { class: 'mission-mark' }),
          h('span', null, [
            h('span', { class: 'mission-name' }, m.name),
            h('span', { class: 'mission-sum' }, m.summary || '')
          ])
        ])
      ]);
    });

    return [
      h('h2', { id: 'drawerTitle', class: 'drawer-title' }, 'Set up ' + p.name),
      vsec('Agent name', h('label', { class: 'flabel' }, [h('span', null, 'Name'), nameInput])),
      vsec('Mission', missions.length
        ? h('div', { class: 'wiz-missions' }, missionCards)
        : h('p', { class: 'small muted' }, 'No missions are available for this persona yet.')),
      vsec('Place', h('div', null, [
        h('label', { class: 'flabel' }, [h('span', null, 'Place name'), placeInput]),
        h('div', { class: 'wiz-grid2' }, [
          h('label', { class: 'flabel' }, [h('span', null, 'Latitude'), latInput]),
          h('label', { class: 'flabel' }, [h('span', null, 'Longitude'), lonInput])
        ]),
        h('div', { class: 'city-list' }, cityButtons)
      ])),
      vsec('Family', h('label', { class: 'flabel' }, [
        h('span', null, 'Members, separated by commas'),
        membersInput
      ])),
      vsec('Channels', h('div', { class: 'wiz-channels' }, [chanToggle('telegram', 'Telegram'), chanToggle('beacon', 'Beacon')])),
      h('div', { class: 'wiz-foot' }, [
        btn('Back', { kind: 'ghost', onclick: function () { wizard.step = 1; wizard.rev++; renderDrawer(); } }),
        h('button', {
          type: 'button', class: 'pill', onclick: function () {
            if (!missions.length) { toast('Pick a mission first', true); return; }
            if (!wizard.templateId) wizard.templateId = missions[0].id;
            wizard.step = 3; wizard.rev++; renderDrawer();
          }
        }, 'Continue')
      ])
    ];
  }

  function stepBtn(dir, label, onclick) {
    return h('button', {
      type: 'button', class: 'step-btn', title: label, 'aria-label': label, onclick: onclick, html: icon(dir)
    });
  }

  function wizStepThree(p) {
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, p.avatar, wizard.look);
    var hairVal = h('span', { class: 'picker-val' }, 'Hair ' + (wizard.look.hair + 1) + ' / 8');
    var skinVal = h('span', { class: 'picker-val' }, 'Skin ' + (wizard.look.skin + 1) + ' / 8');

    function refresh() {
      drawAvatar(canvas, p.avatar, wizard.look);
      hairVal.textContent = 'Hair ' + (wizard.look.hair + 1) + ' / 8';
      skinVal.textContent = 'Skin ' + (wizard.look.skin + 1) + ' / 8';
    }
    function cycle(key, d) {
      wizard.look[key] = ((wizard.look[key] + d) % 8 + 8) % 8;
      refresh();
    }

    var palette = LOOK_COLORS.slice();
    if (palette.indexOf(p.look.color) < 0) palette[palette.length - 1] = p.look.color;
    var swatches = palette.map(function (c) {
      var b = h('button', {
        type: 'button', class: 'swatch', style: 'background:' + c,
        title: c, 'aria-label': 'Colour ' + c,
        'aria-pressed': wizard.look.color === c ? 'true' : 'false',
        onclick: function () {
          wizard.look.color = c;
          Array.prototype.forEach.call(b.parentNode.children, function (x) {
            x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
          refresh();
        }
      });
      return b;
    });

    var wakeBtn = h('button', {
      type: 'button', class: 'pill', disabled: waking,
      onclick: function () { wakeUp(p, wakeBtn); }
    }, waking ? 'Waking...' : 'Wake up');

    return [
      h('h2', { id: 'drawerTitle', class: 'drawer-title' }, 'Look'),
      h('div', { class: 'look-preview' }, [
        h('div', { class: 'av big' }, canvas),
        h('div', { class: 'grow' }, [
          h('div', { class: 'look-name' }, wizard.name || p.name),
          h('div', { class: 'small' }, p.role + ' · ' + p.name)
        ])
      ]),
      h('div', { class: 'picker' }, [
        h('div', { class: 'picker-head' }, [h('span', { class: 'picker-title' }, 'Hair'), hairVal]),
        h('div', { class: 'stepper-row' }, [
          stepBtn('left', 'Previous hair', function () { cycle('hair', -1); }),
          stepBtn('right', 'Next hair', function () { cycle('hair', 1); })
        ])
      ]),
      h('div', { class: 'picker' }, [
        h('div', { class: 'picker-head' }, [h('span', { class: 'picker-title' }, 'Skin'), skinVal]),
        h('div', { class: 'stepper-row' }, [
          stepBtn('left', 'Previous skin', function () { cycle('skin', -1); }),
          stepBtn('right', 'Next skin', function () { cycle('skin', 1); })
        ])
      ]),
      h('div', { class: 'picker' }, [
        h('div', { class: 'picker-head' }, [h('span', { class: 'picker-title' }, 'Colour'), h('span', { class: 'picker-val' }, 'Clothes')]),
        h('div', { class: 'swatches' }, swatches)
      ]),
      h('div', { class: 'wiz-foot' }, [
        btn('Back', { kind: 'ghost', onclick: function () { wizard.step = 2; wizard.rev++; renderDrawer(); } }),
        wakeBtn
      ])
    ];
  }

  function parseMembers(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function wakeUp(p, button) {
    if (waking) return;
    waking = true;
    if (button) { button.disabled = true; button.textContent = 'Waking...'; }
    var name = String(wizard.name || '').trim() || p.name;
    var channels = Object.keys(wizard.channels).filter(function (k) { return wizard.channels[k]; });
    var lat = Number(wizard.lat);
    var lon = Number(wizard.lon);
    var body = {
      personaId: p.id,
      name: name,
      templateId: wizard.templateId,
      place: {
        name: String(wizard.placeName || '').trim() || 'Delhi',
        lat: isNaN(lat) ? 28.6139 : lat,
        lon: isNaN(lon) ? 77.2090 : lon
      },
      members: parseMembers(wizard.members),
      look: { hair: wizard.look.hair, skin: wizard.look.skin, color: wizard.look.color },
      channels: channels,
      awake: true
    };
    ask('POST', '/api/agents', body).then(function (d) {
      if (!d) {
        waking = false;
        if (button) { button.disabled = false; button.textContent = 'Wake up'; }
        return;
      }
      waking = false;
      wizard.done = true;
      wizard.agent = d;
      wizard.agentName = (d && d.name) || name;
      wizard.rev++;
      renderDrawer();
      toast(name + ' is awake');
      refresh();
    });
  }

  function schoolDone(p) {
    var name = wizard.agentName || (wizard.agent && wizard.agent.name) || p.name;
    var tpl = findTpl(wizard.templateId);
    var canvas = h('canvas', { class: 'pixel', width: 16, height: 16, 'aria-hidden': 'true' });
    drawAvatar(canvas, p.avatar, wizard.look);
    return [
      wizTop('School · Enrolled'),
      h('div', { class: 'wiz-done' }, [
        h('div', { class: 'av big' }, canvas),
        h('h2', { id: 'drawerTitle', class: 'done-title' }, name + ' is awake'),
        h('p', { class: 'done-sub' }, p.role + (tpl ? ' · ' + tpl.name : '') + (wizard.placeName ? ' · ' + wizard.placeName : '')),
        h('p', { class: 'small' }, 'The agent is watching and will speak in ' + p.name + "'s voice."),
        h('div', { class: 'done-actions' }, [
          h('a', {
            class: 'pill', href: '#agents', onclick: function (e) {
              e.preventDefault();
              var id = wizard.agent && wizard.agent.id;
              closeDrawer();
              if (id) openAgent(id); else go('agents');
            }
          }, 'Go to Agents'),
          h('button', {
            type: 'button', class: 'btn ghost', onclick: function () { closeDrawer(); go('school'); }
          }, 'Enrol another')
        ])
      ])
    ];
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
    drawerMode = 'vault';
    drawerId = id;
    wizard = null;
    var panel = d.querySelector('.drawer-panel');
    if (panel) panel.setAttribute('data-key', '');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    renderDrawer();
    var close = d.querySelector('.drawer-close');
    if (close) close.focus();
  }

  function closeDrawer() {
    var d = document.getElementById('drawer');
    if (!d || !d.classList.contains('open')) return;
    var panel = d.querySelector('.drawer-panel');
    if (panel) panel.setAttribute('data-key', '');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    drawerId = null;
    drawerMode = null;
    wizard = null;
    waking = false;
    if (drawerReturn && drawerReturn.focus) drawerReturn.focus();
    drawerReturn = null;
  }

  function renderDrawer() {
    var d = document.getElementById('drawer');
    if (!d || !d.classList.contains('open')) return;
    var panel = d.querySelector('.drawer-panel');
    if (!panel) return;
    if (drawerMode === 'school' && wizard) return paintSchoolDrawer(panel);
    if (!drawerId) return;
    var t = findTpl(drawerId);
    if (!t) { closeDrawer(); return; }
    var key = 'vault:' + t.id;
    if (panel.getAttribute('data-key') !== key) {
      panel.setAttribute('data-key', key);
      panel.setAttribute('data-id', t.id);
      panel.className = 'drawer-panel p-' + tintOf(t);
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

    var card = h('div', { class: 'sheet-card p-lilac', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheetTitle' }, [
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

  var DEMO_PERSONAS = [
    {
      id: 'firefighter', name: 'Flint', role: 'Firefighter', tint: 'peach', avatar: 'rescue',
      tagline: 'Fire, smoke and heat. First one in, calm voice.',
      about: 'Watches for heat, dry wind and smoky air that make fires dangerous. Tells the family what to switch off, where to go and when to call 112.',
      look: { hair: 3, skin: 2, color: '#E0482F' },
      skills: ['Heat and fire risk', 'Smoke and air', 'Evacuation steps'],
      voice: 'Short, firm and calm, like a firefighter giving clear orders. One action per sentence.',
      signature: 'Flint, fire safety', templates: ['tpl-heat', 'tpl-kit'], speaks: 'veer'
    },
    {
      id: 'doctor', name: 'Asha', role: 'Doctor', tint: 'pink', avatar: 'medic',
      tagline: 'Looks after vitals, medicine and the elders.',
      about: 'Reads heart rate and oxygen for family members and nudges when something looks off. Always points to a real doctor or 112 for anything urgent.',
      look: { hair: 5, skin: 3, color: '#FFFFFF' },
      skills: ['Family vitals', 'Medicine reminders', 'Heat illness'],
      voice: 'Warm and reassuring, plain words, never a diagnosis. Ends urgent messages with call the doctor or 112.',
      signature: 'Dr. Asha, family health', templates: ['tpl-med', 'tpl-heat'], speaks: 'asha'
    },
    {
      id: 'rescuer', name: 'Veer', role: 'Rescue captain', tint: 'blue', avatar: 'rescue',
      tagline: 'Floods, quakes and official warnings.',
      about: 'Follows earthquakes, heavy rain and official NDMA and IMD warnings. Turns them into what to do now, where to go and what to carry.',
      look: { hair: 1, skin: 4, color: '#2F7DE0' },
      skills: ['Quakes', 'Floods', 'Official alerts', 'Evacuation'],
      voice: 'Steady and direct, like a rescue captain on the radio. Says where to go and what to carry.',
      signature: 'Captain Veer, rescue', templates: ['tpl-flood', 'tpl-sos'], speaks: 'veer'
    },
    {
      id: 'teacher', name: 'Didi', role: 'Teacher', tint: 'yellow', avatar: 'guardian',
      tagline: 'Keeps children safe and curious.',
      about: 'Watches sun, air and heat for outdoor play and turns warnings into simple things a child can do. Good for family groups with kids.',
      look: { hair: 6, skin: 1, color: '#E0A02F' },
      skills: ['Child play safety', 'Simple language', 'Drills'],
      voice: 'Friendly big-sister teacher. Very simple words a ten year old understands. Never scary.',
      signature: 'Didi, child safety', templates: ['tpl-child', 'tpl-kit'], speaks: 'didi'
    },
    {
      id: 'scientist', name: 'Megh', role: 'Weather scientist', tint: 'lilac', avatar: 'scout',
      tagline: 'Numbers first: wind, rain, UV and air.',
      about: 'Reads weather, air quality and storms and says what the numbers mean for your day. Good for the whole family and for planning trips.',
      look: { hair: 2, skin: 2, color: '#8A3FD6' },
      skills: ['Weather', 'Air quality', 'Cyclones', 'Cold and heat waves'],
      voice: 'Curious and precise. Gives the number, then one plain sentence on what it means.',
      signature: 'Megh, weather desk', templates: ['tpl-heat', 'tpl-flood'], speaks: 'default'
    },
    {
      id: 'pharmacist', name: 'Dawa', role: 'Pharmacist', tint: 'green', avatar: 'medic',
      tagline: 'Doses on time, stock never runs out.',
      about: 'Tracks when medicine is due and how many days of stock are left, so nobody misses a dose in a storm or a lockdown.',
      look: { hair: 0, skin: 3, color: '#2FA35B' },
      skills: ['Dose reminders', 'Stock days left', 'Refill nudges'],
      voice: 'Kind and tidy, like a neighbourhood pharmacist. Says the medicine name and what to do.',
      signature: 'Dawa, medicine', templates: ['tpl-med', 'tpl-kit'], speaks: 'asha'
    },
    {
      id: 'helper', name: 'Seva', role: 'Community helper', tint: 'pink', avatar: 'coach',
      tagline: 'Neighbours, check-ins and who needs a hand.',
      about: 'Notices when someone has not checked in and passes on help requests from nearby people. Keeps the community talking when things go wrong.',
      look: { hair: 4, skin: 4, color: '#D6408F' },
      skills: ['Check-ins', 'Help requests', 'Neighbours'],
      voice: 'Neighbourly and kind, short and human. Asks before assuming the worst.',
      signature: 'Seva, community', templates: ['tpl-sos', 'tpl-heat'], speaks: 'didi'
    },
    {
      id: 'engineer', name: 'Neev', role: 'Engineer', tint: 'blue', avatar: 'sentinel',
      tagline: 'Roads, water and the supplies at home.',
      about: 'Watches roads and rain for routes that may close and counts days of water and food left at home so you can plan before shops shut.',
      look: { hair: 1, skin: 2, color: '#2F9FB5' },
      skills: ['Routes', 'Supplies', 'Go-bag'],
      voice: 'Practical and brief, like an engineer reading a checklist. Gives a number of days and a next step.',
      signature: 'Neev, supplies', templates: ['tpl-kit', 'tpl-flood'], speaks: 'default'
    }
  ];

  function demoData(withPending) {
    return {
      agents: [
        {
          id: 'ag1', name: 'Heat watch', avatar: 'sentinel', personaId: 'scientist',
          look: { hair: 2, skin: 2, color: '#8A3FD6' }, templateId: 'tpl-heat', enabled: true,
          watch: ['heat index', 'Maa heart rate'], place: { name: 'Home', lat: 0, lon: 0 }, members: ['Maa'], everyMin: 5,
          rules: [{
            id: 'ru1', name: 'Heat index above 41 and Maa heart rate above 110',
            when: { mode: 'all', conditions: [{ metric: 'heat', op: '>', value: 41 }, { metric: 'hr', op: '>', value: 110 }] },
            severity: 'high', message: 'Heat and heart rate are both high. Please check on Maa.'
          }],
          channels: ['telegram'], createdAt: ago(0)
        },
        {
          id: 'ag2', name: 'Medic on call', avatar: 'medic', personaId: 'doctor',
          look: { hair: 5, skin: 3, color: '#FFFFFF' }, templateId: 'tpl-med', enabled: false,
          watch: ['SpO2'], place: null, members: ['Papa'], everyMin: 10,
          rules: [{
            id: 'ru2', name: 'SpO2 below 92',
            when: { mode: 'all', conditions: [{ metric: 'spo2', op: '<', value: 92 }] },
            severity: 'high', message: 'Oxygen is low. Check on Papa now.'
          }],
          channels: ['telegram', 'beacon'], createdAt: ago(0)
        },
        {
          id: 'ag3', name: 'School run', avatar: 'guardian', personaId: 'teacher',
          look: { hair: 6, skin: 1, color: '#E0A02F' }, templateId: 'tpl-child', enabled: true,
          watch: ['steps'], place: { name: 'School', lat: 0, lon: 0 }, members: ['Kiara'], everyMin: 15,
          rules: [], channels: ['beacon'], createdAt: ago(0)
        },
        {
          id: 'ag4', name: 'Flint', avatar: 'rescue', personaId: 'firefighter',
          look: { hair: 3, skin: 2, color: '#E0482F' }, templateId: 'tpl-heat', enabled: true,
          watch: ['weather'], place: { name: 'Delhi', lat: 28.6139, lon: 77.209 }, members: ['Maa'], everyMin: 5,
          rules: [], channels: ['telegram'], createdAt: ago(120000)
        },
        {
          id: 'ag5', name: 'Asha', avatar: 'medic', personaId: 'doctor',
          look: { hair: 5, skin: 3, color: '#FFFFFF' }, templateId: 'tpl-med', enabled: true,
          watch: ['health', 'schedule'], place: { name: 'Mumbai', lat: 19.076, lon: 72.8777 }, members: ['Maa', 'Papa'], everyMin: 10,
          rules: [], channels: ['telegram', 'beacon'], createdAt: ago(300000)
        }
      ],
      personas: DEMO_PERSONAS,
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
      members: ['Maa', 'Papa', 'Kiara'],
      situation: {
        phase: 'alert', level: 3, since: Date.now() - 9 * 60000,
        headline: 'Act now: Heat and heart rate are high.',
        reasons: ['1 severe alert in the last 3 hours', 'Maa heart rate 118 with heat index 43'],
        actions: ['Move Maa to a cool room and give her water.', 'Call Dr. Asha or 112 if breathing is hard.', 'Check on the elders next door.']
      }
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
      if (b.personaId) {
        var per = S.personas.filter(function (x) { return x.id === b.personaId; })[0];
        if (!per) throw new Error('Persona not found');
        var pt = S.templates.filter(function (x) { return x.id === (b.templateId || per.templates[0]); })[0];
        if (!pt) throw new Error('Template not found');
        var made = {
          id: 'ag' + Date.now(), name: b.name || per.name, avatar: per.avatar, personaId: per.id,
          look: b.look || per.look, templateId: pt.id, enabled: b.awake !== false,
          watch: [], place: b.place || null, members: b.members || [], everyMin: 5, rules: [],
          channels: (b.channels && b.channels.length) ? b.channels : ['telegram'], createdAt: new Date().toISOString()
        };
        S.agents.push(made);
        return made;
      }
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
