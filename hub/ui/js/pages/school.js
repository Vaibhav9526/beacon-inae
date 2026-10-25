// School page: the persona roster and the enrol dialog (Persona recap, Set up, Look). Spec 3.4 and 5.2.
// Drafts live in the dialog's closure, so a state refresh never wipes a half-filled enrol.
import * as ui from '../ui.js';
import { api } from '../api.js';
import { GENRE_LABEL } from '../model.js';

const { h, icon, Avatar, Chip, Switch, Field, Input, openDialog, EmptyState, PageHeader } = ui;

const CITIES = [
  ['Delhi', 28.6139, 77.209],
  ['Mumbai', 19.076, 72.8777],
  ['Chennai', 13.0827, 80.2707],
  ['Kolkata', 22.5726, 88.3639],
  ['Bengaluru', 12.9716, 77.5946],
  ['Hyderabad', 17.385, 78.4867],
  ['Guwahati', 26.1445, 91.7362],
  ['Kochi', 9.9312, 76.2673]
];

const HAIR_NAMES = { short: 'Short', bun: 'Bun', curly: 'Curly', long: 'Long', spiky: 'Spiky', side: 'Side part' };
const STEP_NAMES = ['Persona', 'Set up', 'Look'];

// Option lists come from js/avatar.js (window globals), with a fallback so the page never breaks.
const hairStyles = () => window.HAIR_STYLES || ['short'];
const skinTones = () => window.SKINS || ['#D9A77F'];
const swatches = () => window.SWATCHES || ['#2F7DE0'];
const wrapIndex = (n, len) => ((n % len) + len) % len;

function personaTemplates(state, p) {
  const all = state.templates || [];
  return (p.templates || []).map((id) => all.find((t) => t.id === id)).filter(Boolean);
}

/** Agent.members holds the names used in health readings: healthName when set, else the name. */
const memberKey = (m) => m.healthName || m.name;

function kindLabel(state, kind) {
  const k = (state.nodeKinds || []).find((x) => x.kind === kind);
  return k ? k.label : kind;
}

/** A small inline path: "Local news feed > Keyword filter". */
function pathLine(state, pipeline) {
  const nodes = pipeline || [];
  if (!nodes.length) return null;
  const parts = [];
  nodes.forEach((n, i) => {
    if (i) parts.push(h('span', { class: 'path-arrow', 'aria-hidden': 'true' }, icon('arrow', 12)));
    parts.push(h('span', { class: 'path-node' }, kindLabel(state, n.kind)));
  });
  return h('div', { class: 'path-line', 'aria-label': 'Path: ' + nodes.map((n) => kindLabel(state, n.kind)).join(', ') }, parts);
}

/* ---------- roster ---------- */

function personaCard(ctx, p) {
  const skills = (p.skills || []).map((s) => Chip({ label: s, tone: 'outline' }));
  return h('button', {
    type: 'button',
    class: 'school-card tint-' + p.tint,
    dataset: { focusKey: 'card-' + p.id },
    'aria-label': p.name + ', ' + p.role + '. ' + p.tagline,
    onclick: () => openEnrol(ctx, p)
  },
    h('span', { class: 'school-card-top' }, Avatar({ key: p.avatar, look: p.look, size: 64 })),
    h('span', { class: 'school-card-name' }, p.name),
    h('span', { class: 'school-card-role' }, p.role),
    h('span', { class: 'school-card-tag' }, p.tagline),
    h('span', { class: 'school-card-skills' }, skills)
  );
}

/* ---------- enrol dialog ---------- */

function openEnrol(ctx, p) {
  const st = ctx.state;
  const tmpls = personaTemplates(st, p);
  const members = (st.group && st.group.members) || [];
  const firstAdult = members.find((m) => m.role === 'adult') || null;
  const tgOn = !!(st.connections && st.connections.telegram && st.connections.telegram.connected);
  const draft = {
    step: 0,
    name: p.name,
    templateId: tmpls[0] ? tmpls[0].id : '',
    placeName: '',
    lat: '',
    lon: '',
    members: firstAdult ? [memberKey(firstAdult)] : [],
    channels: { beacon: true, telegram: tgOn },
    look: { hair: p.look.hair, skin: p.look.skin, color: p.look.color },
    error: '',
    done: null
  };
  let d = null;
  let previewEl = null;

  const selectedTemplate = () => tmpls.find((t) => t.id === draft.templateId) || null;

  function validateSetup() {
    if (!draft.name.trim()) return 'Give the agent a name.';
    const hasLat = String(draft.lat).trim() !== '';
    const hasLon = String(draft.lon).trim() !== '';
    if (hasLat !== hasLon) return 'Enter both latitude and longitude, or leave both empty.';
    if (hasLat) {
      const la = Number(draft.lat);
      const lo = Number(draft.lon);
      if (!Number.isFinite(la) || la < -90 || la > 90) return 'Latitude must be between -90 and 90.';
      if (!Number.isFinite(lo) || lo < -180 || lo > 180) return 'Longitude must be between -180 and 180.';
    }
    return '';
  }

  function placeOf() {
    if (String(draft.lat).trim() === '') return null;
    return { name: draft.placeName.trim() || 'My place', lat: Number(draft.lat), lon: Number(draft.lon) };
  }

  /* Step 0: recap */
  function recapView() {
    return h('div', { class: 'school-recap' },
      h('div', { class: 'school-recap-head' },
        Avatar({ key: p.avatar, look: p.look, size: 72 }),
        h('div', { class: 'school-recap-titles' },
          h('p', { class: 'school-step-title', tabindex: '-1' }, p.name),
          h('p', { class: 'school-recap-role' }, p.role + ' · ' + p.tagline))),
      h('p', { class: 'school-recap-about' }, p.about),
      h('div', { class: 'school-block' },
        h('span', { class: 'field-label' }, 'Skills'),
        h('span', { class: 'school-skills' }, (p.skills || []).map((s) => Chip({ label: s, tone: 'outline' })))),
      h('div', { class: 'school-block' },
        h('span', { class: 'field-label' }, 'Voice'),
        h('p', { class: 'quote' }, p.voice)));
  }

  /* Step 1: set up */
  function setupView() {
    const missions = tmpls.length
      ? h('fieldset', { class: 'school-missions' },
          h('legend', { class: 'field-label' }, 'Mission'),
          tmpls.map((t) => {
            const genre = (t.agent && t.agent.genre) || 'custom';
            return h('label', { class: 'school-choice' + (draft.templateId === t.id ? ' selected' : '') },
              h('input', {
                type: 'radio',
                name: 'school-mission',
                value: t.id,
                checked: draft.templateId === t.id,
                dataset: { focusKey: 'mission-' + t.id },
                onchange: () => { draft.templateId = t.id; redraw('mission-' + t.id); }
              }),
              h('span', { class: 'school-choice-body' },
                h('span', { class: 'school-choice-name' }, t.name, Chip({ label: GENRE_LABEL[genre] || genre, tone: 'accent' })),
                h('span', { class: 'school-choice-sum' }, t.summary),
                pathLine(st, t.agent && t.agent.pipeline)));
          }))
      : h('p', { class: 'field-desc' }, 'This persona has no missions yet. The agent starts with the built-in rules.');

    const cityBtns = CITIES.map(([name, la, lo]) => {
      const pressed = draft.placeName === name && String(draft.lat) === String(la);
      return h('button', {
        type: 'button',
        class: 'chip-btn school-city',
        'aria-pressed': pressed ? 'true' : 'false',
        dataset: { focusKey: 'city-' + name },
        onclick: () => {
          draft.placeName = name;
          draft.lat = String(la);
          draft.lon = String(lo);
          redraw('city-' + name);
        }
      }, name);
    });

    const memberList = membersOf(st);
    const channelRow = (key, label, desc) => h('div', { class: 'school-switch-row' },
      h('div', { class: 'school-switch-text' },
        h('span', { class: 'row-title-name' }, label),
        h('span', { class: 'row-sub' }, desc)),
      Switch({ checked: !!draft.channels[key], label, onChange: (v) => { draft.channels[key] = v; } }));

    return h('div', { class: 'school-setup' },
      Field({ label: 'Agent name', id: 'school-name', desc: 'Starts as ' + p.name + '. Change it if the family knows it by another name.', children:
        Input({ id: 'school-name', value: draft.name, placeholder: p.name, onInput: (v) => { draft.name = v; } }) }),
      missions,
      h('div', { class: 'school-block' },
        Field({ label: 'Place', id: 'school-place', desc: 'Used for weather, air and quake sources. Leave empty to skip.', children:
          Input({ id: 'school-place', value: draft.placeName, placeholder: 'City or town', onInput: (v) => { draft.placeName = v; } }) }),
        h('div', { class: 'school-cities', role: 'group', 'aria-label': 'City presets' }, cityBtns),
        h('div', { class: 'school-latlon' },
          Field({ label: 'Latitude', id: 'school-lat', children:
            Input({ id: 'school-lat', type: 'number', min: -90, max: 90, step: 'any', value: draft.lat, onInput: (v) => { draft.lat = v; } }) }),
          Field({ label: 'Longitude', id: 'school-lon', children:
            Input({ id: 'school-lon', type: 'number', min: -180, max: 180, step: 'any', value: draft.lon, onInput: (v) => { draft.lon = v; } }) }))),
      h('fieldset', { class: 'school-block' },
        h('legend', { class: 'field-label' }, 'Family members this agent looks after'),
        memberList.length
          ? h('div', { class: 'school-members' }, memberList.map((m) => {
              const key = memberKey(m);
              return h('label', { class: 'school-member' },
                h('input', {
                  type: 'checkbox',
                  value: key,
                  checked: draft.members.includes(key),
                  onchange: (e) => {
                    draft.members = e.target.checked
                      ? [...draft.members, key]
                      : draft.members.filter((x) => x !== key);
                  }
                }),
                h('span', null, m.name),
                h('span', { class: 'row-sub' }, m.role));
            }))
          : h('p', { class: 'field-desc' }, 'No family members yet. Add them in Family, then enrol again to look after them.')),
      h('div', { class: 'school-block' },
        h('span', { class: 'field-label' }, 'Channels'),
        channelRow('beacon', 'Beacon phones', 'Send to the family phones paired with this hub.'),
        channelRow('telegram', 'Telegram', st.connections && st.connections.telegram && st.connections.telegram.connected
          ? 'Send to the Telegram chats paired with this hub.'
          : 'Telegram is not connected yet. Set it up in Connections.')));
  }

  /* Step 2: look */
  function lookView() {
    const hair = hairStyles();
    const skins = skinTones();
    const colours = swatches();
    previewEl = h('div', { class: 'school-look-preview' });
    refreshPreview();

    const hairName = h('span', { class: 'school-opt-name' }, HAIR_NAMES[hair[draft.look.hair]] || hair[draft.look.hair]);
    const skinSw = h('span', { class: 'school-skin-swatch', 'aria-hidden': 'true' });
    skinSw.style.setProperty('--sw', skins[draft.look.skin]);
    const skinName = h('span', { class: 'school-opt-name' }, 'Skin ' + (draft.look.skin + 1) + ' of ' + skins.length);

    const cycle = (kind, len, delta, onDone) => {
      draft.look[kind] = wrapIndex(draft.look[kind] + delta, len);
      onDone();
      refreshPreview();
    };

    const swatchBtns = colours.map((c, i) => {
      const b = h('button', {
        type: 'button',
        class: 'school-swatch',
        'aria-pressed': draft.look.color === c ? 'true' : 'false',
        'aria-label': 'Colour ' + (i + 1) + ' of ' + colours.length,
        dataset: { focusKey: 'sw-' + i },
        onclick: () => {
          draft.look.color = c;
          swatchBtns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
          refreshPreview();
        }
      });
      b.style.setProperty('--sw', c);
      return b;
    });

    return h('div', { class: 'school-look' },
      previewEl,
      h('div', { class: 'school-opt-row' },
        h('span', { class: 'field-label' }, 'Hair'),
        h('div', { class: 'school-opt-control' },
          ui.IconButton({ icon: 'chevron-left', label: 'Previous hair style', onClick: () => cycle('hair', hair.length, -1, () => { hairName.textContent = HAIR_NAMES[hair[draft.look.hair]] || hair[draft.look.hair]; }) }),
          hairName,
          ui.IconButton({ icon: 'chevron-right', label: 'Next hair style', onClick: () => cycle('hair', hair.length, 1, () => { hairName.textContent = HAIR_NAMES[hair[draft.look.hair]] || hair[draft.look.hair]; }) }))),
      h('div', { class: 'school-opt-row' },
        h('span', { class: 'field-label' }, 'Skin'),
        h('div', { class: 'school-opt-control' },
          ui.IconButton({ icon: 'chevron-left', label: 'Previous skin tone', onClick: () => cycle('skin', skins.length, -1, () => { skinSw.style.setProperty('--sw', skins[draft.look.skin]); skinName.textContent = 'Skin ' + (draft.look.skin + 1) + ' of ' + skins.length; }) }),
          skinSw,
          skinName,
          ui.IconButton({ icon: 'chevron-right', label: 'Next skin tone', onClick: () => cycle('skin', skins.length, 1, () => { skinSw.style.setProperty('--sw', skins[draft.look.skin]); skinName.textContent = 'Skin ' + (draft.look.skin + 1) + ' of ' + skins.length; }) }))),
      h('div', { class: 'school-opt-row' },
        h('span', { class: 'field-label' }, 'Colour'),
        h('div', { class: 'school-swatches' }, swatchBtns)));
  }

  function refreshPreview() {
    if (!previewEl) return;
    previewEl.replaceChildren(Avatar({ key: p.avatar, look: { ...draft.look }, size: 96 }));
  }

  /* Done */
  function doneView(a) {
    const tm = selectedTemplate();
    return h('div', { class: 'school-done' },
      Avatar({ key: p.avatar, look: { ...draft.look }, size: 96 }),
      h('p', { class: 'school-done-title', tabindex: '-1' }, a.name + ' is awake'),
      h('p', { class: 'school-done-text' },
        tm ? a.name + ' will watch ' + tm.name.toLowerCase() + ' and tell the family when something needs attention.'
           : a.name + ' is ready. It will tell the family when something needs attention.'));
  }

  function stepRail() {
    return h('ol', { class: 'school-steps', 'aria-label': 'Enrol steps' },
      STEP_NAMES.map((name, i) => h('li', {
        class: 'school-step' + (i === draft.step ? ' current' : i < draft.step ? ' past' : ''),
        'aria-current': i === draft.step ? 'step' : undefined
      }, (i + 1) + '. ' + name)));
  }

  function stepBody() {
    const views = [recapView, setupView, lookView];
    return h('div', { class: 'school-enrol' },
      stepRail(),
      draft.error ? h('p', { class: 'field-error', role: 'alert' }, draft.error) : null,
      views[draft.step]());
  }

  function doneActions(a) {
    return [
      { label: 'Add another', variant: 'outline', keepOpen: true, onClick: () => d.close() },
      { label: 'Open agent', variant: 'primary', primary: true, keepOpen: true, onClick: () => { d.close(); ctx.nav('#agents/' + a.id); } }
    ];
  }

  function actionsFor(step) {
    if (draft.done) return doneActions(draft.done);
    const back = { label: 'Back', variant: 'outline', keepOpen: true, onClick: () => { draft.step -= 1; draft.error = ''; redraw(); } };
    const cancel = { label: 'Cancel', variant: 'outline' };
    if (step === 0) {
      return [cancel, { label: 'Next', variant: 'primary', primary: true, keepOpen: true, onClick: () => { draft.step = 1; draft.error = ''; redraw(); } }];
    }
    if (step === 1) {
      return [cancel, back, { label: 'Next', variant: 'primary', primary: true, keepOpen: true, onClick: () => {
        draft.error = validateSetup();
        if (!draft.error) draft.step = 2;
        redraw();
      } }];
    }
    return [cancel, back, { label: 'Wake up', variant: 'primary', primary: true, keepOpen: true, onClick: wakeUp }];
  }

  async function wakeUp() {
    draft.error = validateSetup();
    if (draft.error) { draft.step = 1; redraw(); return; }
    const tm = selectedTemplate();
    const body = {
      personaId: p.id,
      name: draft.name.trim(),
      genre: (tm && tm.agent && tm.agent.genre) || 'custom',
      members: draft.members,
      look: { ...draft.look },
      channels: Object.keys(draft.channels).filter((k) => draft.channels[k])
    };
    if (tm) body.templateId = tm.id;
    const place = placeOf();
    if (place) body.place = place;
    const a = await api.post('/api/agents', body);
    if (!a) return;
    draft.done = a;
    d.setBody(() => doneView(a));
    d.setActions(doneActions(a));
    d.el.querySelector('.school-done-title')?.focus({ preventScroll: true });
  }

  /** Re-draws the current step and puts focus back on a stable element (or the step heading). */
  function redraw(focusKey) {
    if (!d) return;
    d.setBody(() => stepBody());
    d.setActions(actionsFor(draft.step));
    const target = focusKey && d.el.querySelector('[data-focus-key="' + focusKey + '"]');
    const heading = d.el.querySelector('.school-step-title');
    (target || heading || d.el).focus({ preventScroll: true });
  }

  d = openDialog({
    title: 'Enrol ' + p.name,
    icon: 'school',
    width: 560,
    body: () => stepBody(),
    actions: actionsFor(0)
  });

  // Enter moves the dialog forward (the primary action) from a text or number field.
  d.el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type === 'checkbox' || t.type === 'radio') return;
    const primary = d.el.querySelector('[data-primary]');
    if (primary && !primary.disabled) {
      e.preventDefault();
      primary.click();
    }
  });
}

function membersOf(state) {
  return (state.group && state.group.members) || [];
}

/* ---------- page ---------- */

export default {
  id: 'school',
  title: 'School',
  icon: 'school',

  render(ctx) {
    const personas = ctx.state.personas || [];
    return h('div', { class: 'page' },
      PageHeader({ title: 'School', sub: 'Enrol an agent as a persona. Each brings a voice, a look and the missions that suit it.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col school-col' },
          personas.length
            ? h('div', { class: 'school-grid' }, personas.map((p) => personaCard(ctx, p)))
            : EmptyState({ icon: 'school', title: 'No personas yet', text: 'The School has no personas to show.' }))));
  }
};
