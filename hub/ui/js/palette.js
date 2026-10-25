// Global search (Ctrl+K): agents, pages and a few actions.
import { h, icon, Avatar } from './ui.js';
import { store } from './store.js';
import { openNewAgentDialog } from './pages/agents.js';
import { NAV, avatarKey, agentLook, roleOf } from './model.js';

let open = null;

export function openPalette() {
  if (open) {
    open.close();
    return;
  }
  const prev = document.activeElement;
  const state = store.state || {};
  let query = '';
  let active = 0;
  let items = [];

  const input = h('input', {
    class: 'palette-input',
    type: 'text',
    placeholder: 'Search agents and pages',
    'aria-label': 'Search agents and pages',
    autocomplete: 'off',
    oninput: (e) => {
      query = e.target.value.trim().toLowerCase();
      active = 0;
      paint();
    },
    onkeydown: (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[active];
        if (it) run(it);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
  });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const panel = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' }, input, list);
  const scrim = h('div', { class: 'palette-scrim' }, panel);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });

  function build() {
    const out = [];
    const agents = state.agents || [];
    agents.forEach((a) => {
      out.push({
        key: 'a:' + a.id,
        label: a.name,
        sub: roleOf(state, a) + (a.enabled ? '' : ' · resting'),
        avatar: { key: avatarKey(state, a), look: agentLook(state, a) },
        hay: (a.name + ' ' + roleOf(state, a) + ' ' + (a.genre || '')).toLowerCase(),
        run: () => { location.hash = '#agents/' + a.id; }
      });
    });
    NAV.forEach((n) => {
      out.push({
        key: 'p:' + n.id,
        label: n.label,
        sub: 'Page',
        icon: n.icon,
        hay: (n.label + ' page').toLowerCase(),
        run: () => { location.hash = '#' + n.id; }
      });
    });
    out.push({
      key: 'new',
      label: 'New agent',
      sub: 'Action',
      icon: 'plus',
      hay: 'new agent create',
      run: () => openNewAgentDialog()
    });
    return out.filter((it) => !query || it.hay.includes(query) || it.label.toLowerCase().includes(query));
  }

  function paint() {
    items = build();
    if (active >= items.length) active = Math.max(0, items.length - 1);
    if (!items.length) {
      list.replaceChildren(h('p', { class: 'empty-search' }, 'No matches.'));
      return;
    }
    list.replaceChildren(...items.map((it, i) => {
      const row = h('button', {
        type: 'button',
        class: 'palette-item' + (i === active ? ' hl' : ''),
        role: 'option',
        'aria-selected': i === active ? 'true' : 'false',
        onmouseenter: () => { active = i; highlight(); },
        onclick: () => run(it)
      },
        it.avatar ? Avatar({ key: it.avatar.key, look: it.avatar.look, size: 28 }) : icon(it.icon || 'agents', 16),
        h('span', { class: 'palette-item-text' },
          h('span', null, it.label),
          h('span', { class: 'palette-item-sub' }, it.sub)));
      return row;
    }));
  }

  function highlight() {
    [...list.querySelectorAll('.palette-item')].forEach((el, i) => {
      el.classList.toggle('hl', i === active);
      el.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    const cur = list.querySelectorAll('.palette-item')[active];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function move(d) {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    highlight();
  }

  function run(it) {
    close();
    it.run();
  }

  function close() {
    if (open !== api) return;
    open = null;
    scrim.remove();
    if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
  }

  const api = { close };
  open = api;
  document.body.append(scrim);
  paint();
  input.focus();
  return api;
}
