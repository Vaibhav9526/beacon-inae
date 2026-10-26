// Place picker: type a city or town and a dropdown lists matching places, each "City, State, IN". Picking one fills the
// name, state and coordinates. The built-in list answers at once (GET /api/places?offline=1), then the network
// results (OpenWeather when a key is saved, else Open-Meteo) replace it after 250 ms. Manual latitude and longitude
// stay under "Enter coordinates". The list is positioned fixed, so dialogs with scrolling bodies do not clip it.
import { h, Field, Input } from '../ui.js';
import { api } from '../api.js';

/** Quick choices. Same names and coordinates as the engine's built-in list (hub/engine/geo.ts). */
export const QUICK_PLACES = [
  { name: 'Raipur', state: 'Chhattisgarh', lat: 21.2514, lon: 81.6296 },
  { name: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.209 },
  { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lon: 72.8777 },
  { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639 },
  { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lon: 78.4867 },
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714 },
  { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lon: 77.4126 },
  { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lon: 79.0882 },
];

const NET_DELAY_MS = 250;
const NET_MIN = 2;
const NOTE_NO_MATCH = 'No match: try another spelling';

/** The text before the first comma: "Raipur, Chh" searches for "Raipur". */
const cityPart = (text) => String(text ?? '').split(',')[0].trim();

/** Fold one character: lower case, accent removed. Keeps one character per input character so highlights line up. */
function foldChar(c) {
  const f = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return [...f].length === 1 ? f : c.toLowerCase();
}

/** Splits a name into plain and highlighted parts around the first match of the query. */
function highlight(text, query) {
  const chars = [...String(text)];
  const folded = chars.map(foldChar);
  const q = [...cityPart(query)].map(foldChar);
  if (!q.length) return [chars.join('')];
  for (let i = 0; i + q.length <= folded.length; i++) {
    let hit = true;
    for (let j = 0; j < q.length && hit; j++) hit = folded[i + j] === q[j];
    if (hit) {
      return [
        chars.slice(0, i).join(''),
        h('mark', { class: 'place-hit' }, chars.slice(i, i + q.length).join('')),
        chars.slice(i + q.length).join(''),
      ];
    }
  }
  return [chars.join('')];
}

/** The muted part of a row: "State, IN". */
const subLine = (p) => [p.state, p.country].filter(Boolean).join(', ');

async function fetchPlaces(q, offline) {
  const r = await api.get('/api/places?q=' + encodeURIComponent(q) + (offline ? '&offline=1' : ''), { silent: true });
  return r && Array.isArray(r.places) ? r.places : null; // null: the lookup failed
}

/**
 * Builds the picker. Props:
 *   id           base id; the text box uses it (so a Field label can point at it)
 *   name         place name (text box, city part)
 *   lat, lon     coordinates (strings or numbers)
 *   state        lower-case state the engine filters alerts by (optional)
 *   label        "City, State, IN" shown in the box for the chosen place (optional)
 *   onChange     called with { name, lat, lon, state, label } on every change; lat and lon are strings
 * Returns one DOM node.
 */
export function placePicker({ id = 'place', name = '', lat = '', lon = '', state = '', label = '', onChange = () => {} } = {}) {
  const v = { name: String(name ?? ''), lat: String(lat ?? ''), lon: String(lon ?? ''), state: String(state ?? ''), label: String(label ?? '') };
  const shown = v.label || v.name;
  let base = shown; // the text of the last picked or loaded place. Typing away from it drops its coordinates.
  let items = [];
  let active = -1;
  let pending = false;
  let open = false;
  let seq = 0;
  let timer = null;

  const emit = () => onChange({ name: v.name, lat: v.lat, lon: v.lon, state: v.state, label: v.label });

  const input = h('input', {
    id,
    class: 'input',
    type: 'text',
    placeholder: 'Type a city or town',
    autocomplete: 'off',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': id + '-list',
    'aria-label': 'Place',
  });
  input.value = shown;
  const list = h('ul', { id: id + '-list', class: 'place-list', role: 'listbox' });
  list.hidden = true;
  const box = h('div', { class: 'place-box' }, input, list);
  const latInput = Input({ id: id + '-lat', type: 'number', step: 'any', value: v.lat, onInput: (x) => { v.lat = x; emit(); } });
  const lonInput = Input({ id: id + '-lon', type: 'number', step: 'any', value: v.lon, onInput: (x) => { v.lon = x; emit(); } });

  /* ---- dropdown position: fixed, under the box (above it when there is no room below) ---- */
  function place() {
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    list.style.left = r.left + 'px';
    list.style.width = r.width + 'px';
    list.style.top = '';
    list.style.bottom = '';
    if (below < 180 && above > below) {
      list.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      list.style.maxHeight = Math.max(120, Math.min(280, above - 12)) + 'px';
    } else {
      list.style.top = (r.bottom + 4) + 'px';
      list.style.maxHeight = Math.max(120, Math.min(280, below - 12)) + 'px';
    }
  }
  const onMove = () => { if (open) place(); };

  function setOpen(on) {
    if (on && document.activeElement !== input) on = false; // a late answer must not reopen a list the user left
    open = on;
    list.hidden = !on;
    input.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      place();
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
    } else {
      active = -1;
      input.removeAttribute('aria-activedescendant');
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    }
  }

  function syncActive() {
    list.querySelectorAll('.place-opt').forEach((el, i) => {
      el.setAttribute('aria-selected', i === active ? 'true' : 'false');
      el.classList.toggle('is-active', i === active);
    });
    if (active >= 0) input.setAttribute('aria-activedescendant', id + '-opt-' + active);
    else input.removeAttribute('aria-activedescendant');
  }

  /** Redraws the rows: matches, then "Searching..." while the network is asked, or "No match" when nothing is found. */
  function paint(query) {
    const rows = items.map((p, i) => h('li', {
      id: id + '-opt-' + i,
      class: 'place-opt' + (i === active ? ' is-active' : ''),
      role: 'option',
      'aria-selected': i === active ? 'true' : 'false',
      onmousedown: (e) => e.preventDefault(), // keep focus in the box so the click lands
      onmouseenter: () => { active = i; syncActive(); },
      onclick: () => choose(p),
    }, h('strong', { class: 'place-opt-name' }, highlight(p.name, query)),
       subLine(p) ? h('span', { class: 'place-opt-sub' }, ', ' + subLine(p)) : null));
    if (pending) rows.push(h('li', { class: 'place-note', role: 'presentation', 'aria-live': 'polite' }, 'Searching...'));
    if (!items.length && !pending && query) rows.push(h('li', { class: 'place-note', role: 'presentation' }, NOTE_NO_MATCH));
    list.replaceChildren(...rows);
    setOpen(rows.length > 0);
    syncActive();
  }

  function choose(p) {
    seq++; // a lookup still in flight is now out of date
    clearTimeout(timer);
    pending = false;
    v.name = p.name;
    v.state = String(p.state || '').toLowerCase();
    v.lat = String(p.lat);
    v.lon = String(p.lon);
    v.label = p.label || [p.name, p.state, p.country || 'IN'].filter(Boolean).join(', ');
    base = v.label;
    input.value = v.label;
    latInput.value = v.lat;
    lonInput.value = v.lon;
    items = [];
    setOpen(false);
    emit();
  }

  async function search(query) {
    const my = ++seq;
    clearTimeout(timer);
    if (!query) {
      items = [];
      pending = false;
      paint('');
      return;
    }
    // 1. Built-in matches: local and instant.
    const local = await fetchPlaces(query, true);
    if (my !== seq) return;
    items = local || [];
    active = items.length ? 0 : -1;
    pending = query.length >= NET_MIN;
    paint(query);
    if (!pending) return;
    // 2. Network matches after a short pause, if the user is still typing the same thing.
    timer = setTimeout(async () => {
      const net = await fetchPlaces(query, false);
      if (my !== seq) return;
      pending = false;
      if (net && net.length) {
        items = net;
        active = Math.min(Math.max(active, 0), items.length - 1);
      }
      paint(query);
    }, NET_DELAY_MS);
  }

  input.addEventListener('input', () => {
    const text = input.value;
    if (base.trim() && text.trim() !== base.trim()) {
      // Typed away from the picked or loaded place: its state and coordinates no longer apply.
      v.state = '';
      v.label = '';
      v.lat = '';
      v.lon = '';
      latInput.value = '';
      lonInput.value = '';
      base = '';
    }
    v.name = cityPart(text);
    emit();
    search(cityPart(text));
  });

  input.addEventListener('keydown', (e) => {
    const isOpen = open && items.length > 0;
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      if (!open) setOpen(true);
      active = (active + 1) % items.length;
      syncActive();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      if (!open) setOpen(true);
      active = active <= 0 ? items.length - 1 : active - 1;
      syncActive();
    } else if (e.key === 'Enter') {
      if (isOpen && active >= 0) {
        e.preventDefault();
        choose(items[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // close the list, not the dialog
        setOpen(false);
      }
    }
  });

  input.addEventListener('focus', () => {
    if (items.length && input.value.trim()) paint(cityPart(input.value));
  });
  input.addEventListener('blur', () => setOpen(false));

  // Outside click closes the list. The handler removes itself once this picker leaves the page.
  const onDocDown = (e) => {
    if (!input.isConnected) { document.removeEventListener('pointerdown', onDocDown, true); return; }
    if (open && !box.contains(e.target)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocDown, true);

  const chips = h('div', { class: 'place-chips', role: 'group', 'aria-label': 'Quick choices' },
    QUICK_PLACES.map((p) => h('button', {
      type: 'button',
      class: 'chip outline place-chip',
      title: p.name + ', ' + p.state,
      onclick: () => choose({ ...p, country: 'IN', label: [p.name, p.state, 'IN'].join(', ') }),
    }, p.name)));

  const coords = h('details', { class: 'place-coords' },
    h('summary', { class: 'field-desc' }, 'Enter coordinates'),
    h('div', { class: 'form-grid place-coords-grid' },
      Field({ label: 'Latitude', id: id + '-lat' }, latInput),
      Field({ label: 'Longitude', id: id + '-lon' }, lonInput)));
  if (v.lat !== '' || v.lon !== '') coords.open = true;

  return h('div', { class: 'place-picker' }, chips, box, coords);
}
