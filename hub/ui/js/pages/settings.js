// Settings page: appearance (theme and sidebar density), a plain-words Safety list, About with the
// versions and the keyboard shortcuts (spec section 7). Spec 5.11.
import * as ui from '../ui.js';
import { LS, toggleCompact, setTheme } from '../shell.js';

const { h, Switch, PageHeader } = ui;

// The same key the shell and the inline script in index.html read.
const THEME_KEY = 'beacon:theme';
const COMPACT_KEY = 'beacon:left-compact';
const THEMES = [
  ['dark', 'Dark', 'Dark surfaces, the default.'],
  ['light', 'Light', 'Light surfaces for bright rooms.'],
  ['system', 'System', 'Follow the computer setting.']
];

// Fallback when the snapshot carries no version. Matches hub/package.json.
const ENGINE_VERSION_FALLBACK = '0.1.0';

const SHORTCUTS = [
  ['Ctrl+K', 'Open or close search (Cmd+K on Mac).'],
  ['Ctrl+,', 'Open settings from anywhere, even inside a text field (Cmd+, on Mac).'],
  ['Ctrl+B', 'Show or hide the sidebar labels.'],
  ['Esc', 'Close a dialog, menu or search. Not while something is saving.'],
  ['Enter', 'Submit the main action in a dialog or form. Shift+Enter for a new line in a note.'],
  ['Up and Down', 'Move through lists and menus. Enter picks the highlighted item.'],
  ['Tab', 'Move between the sidebar, the list, the main page and the side panel.']
];

function currentTheme() {
  const t = LS.get(THEME_KEY, 'dark');
  return ['dark', 'light', 'system'].includes(t) ? t : 'dark';
}

/** Applies a theme now and remembers it (shell.setTheme also updates the topbar icon). */
function applyTheme(value) {
  setTheme(value);
}

function compactOn() {
  return LS.get(COMPACT_KEY, '0') === '1';
}

function themeChoices() {
  const saved = currentTheme();
  return h('div', { class: 'set-choices', role: 'radiogroup', 'aria-label': 'Theme' },
    THEMES.map(([id, label, desc]) => h('label', { class: 'set-choice' + (saved === id ? ' selected' : '') },
      h('input', {
        type: 'radio',
        name: 'theme',
        value: id,
        checked: saved === id,
        dataset: { focusKey: 'theme-' + id },
        onchange: (e) => {
          applyTheme(id);
          e.currentTarget.closest('.set-choices').querySelectorAll('.set-choice').forEach((l) => {
            l.classList.toggle('selected', l.querySelector('input').value === id);
          });
        }
      }),
      h('span', { class: 'set-choice-text' },
        h('span', { class: 'set-choice-title' }, label),
        h('span', { class: 'row-sub' }, desc)))));
}

function row(title, desc, control) {
  return h('div', { class: 'set-row' },
    h('div', { class: 'set-row-text' },
      h('span', { class: 'set-row-title' }, title),
      desc ? h('span', { class: 'set-row-desc' }, desc) : null),
    control || null);
}

function safetyRows() {
  return [
    ['Approval before anything leaves', 'The first time an alert would go to a phone or Telegram, the hub waits for you. Allow it once, always, or say no.'],
    ['Audit log', 'Every alert, run and change is written to a log on this computer. Read it in Activity, under Messages.'],
    ['Health data stays here', 'Readings are kept on this computer. Only short approved alert text is ever sent out.'],
    ['Models only see what you allow', 'If a brain is set up, it only words alerts. It does not get your readings or your contacts.']
  ].map(([t, d]) => row(t, d, null));
}

function aboutRows(state) {
  const version = state.version || (state.engine && state.engine.version) || ENGINE_VERSION_FALLBACK;
  return [
    row('Hub engine', 'Runs the agents and keeps the data on this computer.', h('span', { class: 'set-value' }, 'Version ' + version)),
    row('Interface', 'The window you are looking at.', h('span', { class: 'set-value' }, 'Hub v2')),
    row('Where data lives', 'On this computer only.', h('span', { class: 'set-value' }, 'Local'))
  ];
}

function shortcutsTable() {
  return h('table', { class: 'set-keys' },
    h('caption', { class: 'sr-only' }, 'Keyboard shortcuts'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Keys'),
      h('th', { scope: 'col' }, 'What it does'))),
    h('tbody', null, SHORTCUTS.map(([keys, what]) => h('tr', null,
      h('td', null, h('kbd', { class: 'kbd' }, keys)),
      h('td', null, what)))));
}

export default {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',

  render(ctx) {
    return h('div', { class: 'page settings-page' },
      PageHeader({ title: 'Settings', sub: 'Look, safety and about this hub.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col set-col' },
          h('section', { class: 'set-section', 'aria-labelledby': 'set-appearance' },
            h('h2', { class: 'set-title', id: 'set-appearance' }, 'Appearance'),
            h('div', { class: 'set-block' },
              h('span', { class: 'field-label' }, 'Theme'),
              themeChoices()),
            h('div', { class: 'group' },
              row('Compact sidebar', 'Show only icons in the sidebar. Ctrl+B does the same.',
                Switch({
                  checked: compactOn(),
                  label: 'Compact sidebar',
                  onChange: () => toggleCompact()
                })))),

          h('section', { class: 'set-section', 'aria-labelledby': 'set-safety' },
            h('h2', { class: 'set-title', id: 'set-safety' }, 'Safety'),
            h('div', { class: 'group' }, safetyRows())),

          h('section', { class: 'set-section', 'aria-labelledby': 'set-about' },
            h('h2', { class: 'set-title', id: 'set-about' }, 'About'),
            h('div', { class: 'group' }, aboutRows(ctx.state)),
            h('h3', { class: 'set-subtitle' }, 'Keyboard shortcuts'),
            shortcutsTable()))));
  }
};
