// Health page: family members, a manual reading form and a CSV import. Readings stay on this computer;
// only short approved alert text is ever sent. Spec 5.8 and section 8 (update keeps form input alive).
import * as ui from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';

const { h, icon, Button, Field, Input, EmptyState, PageHeader, toast } = ui;

const PRIVACY = 'Health data stays on this computer; only short approved alert text is ever sent.';

/** Reads a number input. Returns null when empty, NaN when not a number. */
function numberOf(el) {
  const v = el ? String(el.value).trim() : '';
  if (v === '') return null;
  return Number(v);
}

function inRange(v, lo, hi) {
  return v === null || (Number.isFinite(v) && v >= lo && v <= hi);
}

function fillMemberOptions(select, names, keepValue) {
  if (!select) return;
  const current = keepValue ? select.value : '';
  select.replaceChildren(...names.map((n) => h('option', { value: n, selected: n === current }, n)));
  if (!names.includes(current) && names.length) select.value = names[0];
}

function membersNode(state) {
  const names = state.members || [];
  if (!names.length) {
    return EmptyState({
      icon: 'family',
      compact: true,
      title: 'No family members yet',
      text: 'Health readings are kept per member. Add family members in Family first.',
      action: Button({ label: 'Open Family', variant: 'outline', size: 'sm', onClick: () => location.assign('#family') })
    });
  }
  return h('ul', { class: 'health-members' }, names.map((n) => h('li', { class: 'health-member' },
    h('span', { class: 'health-member-name' }, n),
    h('span', { class: 'row-sub' }, 'Readings kept on this computer'))));
}

/** Patches the members list and the member pickers without touching typed values. */
function paint(root, state) {
  const list = root.querySelector('[data-region="members"]');
  if (list) list.replaceChildren(membersNode(state));
  const names = state.members || [];
  root.querySelectorAll('select[data-member-select]').forEach((sel) => fillMemberOptions(sel, names, true));
  const save = root.querySelector('[data-region="save"]');
  if (save) save.disabled = !names.length;
}

async function saveReading(root) {
  const member = root.querySelector('#health-member');
  const hr = numberOf(root.querySelector('#health-hr'));
  const spo2 = numberOf(root.querySelector('#health-spo2'));
  const steps = numberOf(root.querySelector('#health-steps'));
  const sleepHours = numberOf(root.querySelector('#health-sleep'));
  const errEl = root.querySelector('[data-region="reading-error"]');
  const fail = (msg) => { if (errEl) errEl.textContent = msg; };

  if (!member || !member.value) return fail('Pick a family member first.');
  if (![hr, spo2, steps, sleepHours].some((v) => v !== null)) return fail('Enter at least one reading.');
  if (!inRange(hr, 20, 250)) return fail('Heart rate should be between 20 and 250.');
  if (!inRange(spo2, 50, 100)) return fail('Oxygen should be between 50 and 100.');
  if (steps !== null && (!Number.isFinite(steps) || steps < 0)) return fail('Steps cannot be negative.');
  if (!inRange(sleepHours, 0, 24)) return fail('Sleep should be between 0 and 24 hours.');
  fail('');

  const body = { member: member.value, at: Date.now() };
  if (hr !== null) body.hr = hr;
  if (spo2 !== null) body.spo2 = spo2;
  if (steps !== null) body.steps = steps;
  if (sleepHours !== null) body.sleepHours = sleepHours;

  const res = await api.post('/api/health/reading', body);
  if (!res) return;
  ['#health-hr', '#health-spo2', '#health-steps', '#health-sleep'].forEach((sel) => {
    const el = root.querySelector(sel);
    if (el) el.value = '';
  });
  toast('Reading saved for ' + member.value + '.', { kind: 'ok', title: 'Saved' });
}

async function importCsv(root) {
  const fileEl = root.querySelector('#health-csv-file');
  const memberEl = root.querySelector('#health-csv-member');
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) return toast('Choose a CSV file first.', { kind: 'info' });
  if (!memberEl || !memberEl.value) return toast('Pick the family member the file is for.', { kind: 'info' });

  // The file is read here in the browser; only its text is sent to the hub, to the chosen member.
  let text = '';
  try {
    text = await file.text();
  } catch (e) {
    return toast("Could not read that file. Try saving it again as CSV.", { kind: 'err' });
  }
  const res = await api.post('/api/health/csv', { text, member: memberEl.value });
  if (!res) return;
  const n = res.imported ?? res.rows ?? res.count;
  toast(n != null ? n + ' readings imported for ' + memberEl.value + '.' : 'File imported for ' + memberEl.value + '.', { kind: 'ok', title: 'Imported' });
  fileEl.value = '';
}

export default {
  id: 'health',
  title: 'Health',
  icon: 'health',

  render(ctx) {
    const names = ctx.state.members || [];
    const hasMembers = names.length > 0;

    const numField = (id, label, desc, extra = {}) => Field({ label, id, desc, children:
      Input(Object.assign({ id, type: 'number', step: 'any', placeholder: 'Empty' }, extra)) });

    const readingForm = h('form', {
      class: 'health-form',
      onsubmit: (e) => { e.preventDefault(); saveReading(e.currentTarget.closest('.health-page')); }
    },
      h('div', { class: 'health-grid' },
        Field({ label: 'Member', id: 'health-member', children:
          h('select', { id: 'health-member', name: 'health-member', class: 'select', 'data-member-select': '', disabled: !hasMembers },
            names.map((n) => h('option', { value: n }, n))) }),
        numField('health-hr', 'Heart rate', 'Beats per minute', { min: 20, max: 250, step: 1 }),
        numField('health-spo2', 'Oxygen (SpO2)', 'Percent', { min: 50, max: 100, step: 1 }),
        numField('health-steps', 'Steps', 'Today or since last reading', { min: 0, step: 1 }),
        numField('health-sleep', 'Sleep', 'Hours', { min: 0, max: 24, step: 0.5 })),
      h('p', { class: 'health-error', role: 'alert', 'data-region': 'reading-error' }),
      h('div', { class: 'health-actions' },
        Button({ label: 'Save reading', variant: 'primary', size: 'sm', dataset: { region: 'save' }, disabled: !hasMembers, type: 'submit' })));

    const csvForm = h('div', { class: 'health-csv' },
      Field({ label: 'Member', id: 'health-csv-member', desc: 'The file is read on this computer. Only the rows are sent to the hub.', children:
        h('select', { id: 'health-csv-member', name: 'health-csv-member', class: 'select', 'data-member-select': '', disabled: !hasMembers },
          names.map((n) => h('option', { value: n }, n))) }),
      Field({ label: 'CSV file', id: 'health-csv-file', desc: 'Columns: date or time, heart rate, oxygen, steps.', children:
        h('input', { type: 'file', id: 'health-csv-file', name: 'health-csv-file', accept: '.csv,text/csv', class: 'health-file' }) }),
      h('div', { class: 'health-actions' },
        Button({ label: 'Import CSV', variant: 'outline', size: 'sm', disabled: !hasMembers, onClick: (e) => importCsv(e.currentTarget.closest('.health-page')) })));

    return h('div', { class: 'page health-page' },
      PageHeader({ title: 'Health', sub: 'Heart rate, oxygen and steps for family members. Alerts use these readings when an agent watches them.' }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col health-col' },
          h('div', { class: 'health-privacy', role: 'note' },
            h('span', { class: 'health-privacy-icon', 'aria-hidden': 'true' }, icon('lock', 16)),
            h('p', null, PRIVACY)),
          h('section', { class: 'health-card' },
            h('h2', { class: 'section-title' }, 'Members'),
            h('div', { 'data-region': 'members' }, membersNode(ctx.state))),
          h('section', { class: 'health-card' },
            h('h2', { class: 'section-title' }, 'Add a reading'),
            readingForm),
          h('section', { class: 'health-card' },
            h('h2', { class: 'section-title' }, 'Import from CSV'),
            csvForm))));
  },

  update(root, ctx) {
    const state = store.state || ctx.state;
    paint(root, state);
  }
};
