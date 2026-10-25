// Family page: members (add, edit, remove, invite a phone), phones waiting to join,
// the group chat and the questions from phones. Shapes: docs/hub-v2-api.md and hub/engine/types.ts.
// Patches in update() so the composer, the open forms and the scroll position survive state refreshes.
import * as ui from '../ui.js';
import { api } from '../api.js';

const { h, Button, IconButton, Tabs, Switch, Chip, Avatar, EmptyState, PageHeader, Field, Input, Select, Dot, GroupRow, icon, openDialog, toast, confirmDialog, clock, dayLabel, relTime, Loading } = ui;

const MAX_CHAT = 500;

const ROLES = {
  adult: { label: 'Adult', key: 'sentinel', help: 'Manages the hub: members, agents, routes and phone approvals.' },
  elder: { label: 'Elder', key: 'guardian', help: 'Gets large, plain alerts. Cannot change the hub.' },
  child: { label: 'Child', key: 'scout', help: 'Kid mode: short, calm messages. Cannot change the hub.' }
};
const ROLE_OPTIONS = Object.keys(ROLES).map((id) => [id, ROLES[id].label]);

const ASK_STATUS = {
  pending: { label: 'Waiting for you', tone: 'warn' },
  running: { label: 'Working on it', tone: 'accent' },
  answered: { label: 'Answered', tone: 'ok' },
  denied: { label: 'Declined', tone: 'muted' }
};

// Module state that must survive re-renders.
const drafts = { chat: '', joins: {} };
const meta = { forceBottom: false, sending: false };
let seen = new Set();
let refs = {};
let lastState = null;

/* ---------- small helpers ---------- */

const safeId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
const enc = (s) => encodeURIComponent(String(s));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const hairList = () => window.HAIR_STYLES || ['short', 'bun', 'curly', 'long', 'spiky', 'side'];
const skinList = () => window.SKINS || ['#FBE3CC', '#F2C9A5', '#D9A77F', '#B9825F', '#8D5A3B', '#5A3825'];
const swatchList = () => window.SWATCHES || ['#E0482F', '#2F7DE0', '#8A3FD6', '#2FA35B', '#E0A02F', '#D6408F', '#2F9FB5', '#0A0A0C'];

function membersNow() {
  return (lastState && lastState.group && lastState.group.members) || [];
}

/** The desktop owner: the first member who has no phone (the person who set the hub up). */
function ownerId(members) {
  const o = members.filter((m) => !m.deviceId).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
  return o ? o.id : null;
}

function isMine(m, members) {
  return m.from === 'hub' || (!!m.from && m.from === ownerId(members));
}

function expiry(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A slot is an empty container the page fills. It remembers its last signature so it only rebuilds on change. */
function slot(name) {
  return h('div', { class: 'fam-slot', dataset: { slot: name } });
}

function fill(root, name, sig, build) {
  const el = root.querySelector('[data-slot="' + name + '"]');
  if (!el || el.__sig === sig) return;
  el.__sig = sig;
  const out = build();
  el.replaceChildren(...(Array.isArray(out) ? out : [out]).filter(Boolean));
}

/* ---------- page ---------- */

function build() {
  refs = {};
  return h('div', { class: 'page fam-page' },
    PageHeader({ title: 'Family', sub: 'People, their phones and the group chat' }),
    h('div', { class: 'scroll' },
      h('div', { class: 'fam-grid' },
        h('section', { class: 'fam-col', 'aria-labelledby': 'fam-h-family' },
          h('div', { class: 'fam-head' },
            h('h2', { class: 'fam-h2', id: 'fam-h-family' }, 'Family'),
            Button({ label: 'Add a family member', icon: 'plus', variant: 'outline', size: 'sm', dataset: { focusKey: 'add-member' }, onClick: () => openMemberDialog(null) })),
          slot('members'),
          slot('joins')),
        h('div', { class: 'fam-col' },
          h('section', { class: 'fam-chat', 'aria-labelledby': 'fam-h-chat' },
            h('div', { class: 'fam-chat-head' },
              h('h2', { class: 'fam-h2', id: 'fam-h-chat' }, 'Group chat'),
              h('span', { class: 'fam-muted small' }, 'Everyone in the family sees this')),
            h('div', { class: 'fam-log', role: 'log', tabindex: '0', 'aria-label': 'Group chat messages', 'aria-live': 'polite' }),
            composer()),
          slot('asks')))));
}

function paint(root, ctx) {
  const g = ctx.state.group || {};
  const members = g.members || [];
  lastState = ctx.state;
  fill(root, 'members', JSON.stringify(members), () => membersBlock(members));
  fill(root, 'joins', JSON.stringify(g.pendingJoins || []), () => joinsBlock(g.pendingJoins || []));
  fill(root, 'asks', JSON.stringify([g.asks || [], !!g.allowAdultAsks]), () => asksBlock(g));
  paintChat(root, g, members);
}

export default {
  id: 'family',
  title: 'Family',
  icon: 'family',

  render(ctx) {
    const root = build();
    paint(root, ctx);
    return root;
  },

  // Called by the shell on state refreshes. Only changed sections are rebuilt, so the composer and open fields keep focus and text.
  update(root, ctx) {
    paint(root, ctx);
  }
};

/* ---------- members ---------- */

function membersBlock(members) {
  if (!members.length) return setupCard();
  return h('ul', { class: 'fam-list', 'aria-label': 'Family members' }, members.map(memberCard));
}

function setupCard() {
  return h('div', { class: 'fam-setup card-box' },
    h('h3', { class: 'fam-setup-title' }, 'Who is setting up?'),
    h('p', { class: 'fam-muted small' }, 'The first person added must be an adult. They approve phones and manage the hub. Add the rest of the family after that.'),
    Button({ label: 'Add yourself as the first adult', icon: 'plus', dataset: { focusKey: 'add-first' }, onClick: () => openMemberDialog(null) }));
}

function phoneLine(m) {
  return m.deviceId
    ? h('span', { class: 'fam-phone ok' }, Dot({ state: 'ok' }), 'Phone linked')
    : h('span', { class: 'fam-phone' }, Dot({ state: 'asleep' }), 'No phone yet');
}

function memberCard(m) {
  const r = ROLES[m.role] || ROLES.elder;
  return h('li', { class: 'fam-member' },
    Avatar({ key: r.key, look: m.look, size: 40 }),
    h('div', { class: 'fam-member-main' },
      h('div', { class: 'fam-member-top' },
        h('span', { class: 'fam-member-name' }, m.name),
        h('span', { class: 'fam-role ' + m.role }, r.label)),
      h('div', { class: 'fam-member-sub' },
        phoneLine(m),
        m.healthName ? h('span', null, 'Health name: ' + m.healthName) : null),
      h('p', { class: 'fam-member-help' }, r.help)),
    h('div', { class: 'fam-member-actions' },
      Button({ label: 'Invite phone', icon: 'qr', variant: 'outline', size: 'sm', dataset: { focusKey: 'invite-' + m.id }, onClick: () => openInvite(m) }),
      IconButton({ icon: 'edit', label: 'Edit ' + m.name, dataset: { focusKey: 'edit-' + m.id }, onClick: () => openMemberDialog(m) }),
      IconButton({ icon: 'trash', label: 'Remove ' + m.name, danger: true, dataset: { focusKey: 'remove-' + m.id }, onClick: () => removeMember(m) })));
}

async function removeMember(m) {
  const ok = await confirmDialog({
    title: 'Remove ' + m.name + '?',
    text: 'They stop getting family messages and alerts on their phone.',
    confirmLabel: 'Remove',
    danger: true,
    icon: 'trash'
  });
  if (!ok) return;
  // A refused removal (for example the last adult) shows the engine's message as a toast.
  const r = await api.del('/api/members/' + enc(m.id));
  if (r) toast(m.name + ' was removed');
}

function normaliseLook(look, n) {
  const hairs = hairList();
  const colors = swatchList();
  const base = { hair: n % hairs.length, skin: 2, color: colors[n % colors.length] };
  if (!look) return base;
  return {
    hair: Number.isInteger(look.hair) ? look.hair : base.hair,
    skin: Number.isInteger(look.skin) ? look.skin : base.skin,
    color: typeof look.color === 'string' && /^#[0-9a-f]{6}$/i.test(look.color) ? look.color : base.color
  };
}

/** Add or edit a member. member null means add. */
function openMemberDialog(member) {
  const editing = !!member;
  const count = membersNow().length;
  const d = {
    name: member ? member.name : '',
    role: member ? member.role : (count ? 'elder' : 'adult'),
    healthName: member && member.healthName ? member.healthName : '',
    look: normaliseLook(member && member.look, count)
  };
  let nameIn;
  let healthIn;
  let err;
  let roleSlot;
  let help;
  let preview;
  let lookSlot;
  let dlg;

  const submitOnEnter = (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const p = dlg && dlg.el.querySelector('[data-primary]');
    if (p) p.click();
  };

  function paintPreview() {
    preview.replaceChildren(Avatar({ key: ROLES[d.role].key, look: d.look, size: 56 }));
  }

  function paintRole() {
    roleSlot.replaceChildren(Tabs({
      label: 'Role',
      block: true,
      items: Object.keys(ROLES).map((id) => ({ id, label: ROLES[id].label })),
      value: d.role,
      onChange: (id) => {
        d.role = id;
        paintRole();
        const t = roleSlot.querySelector('[data-tab="' + id + '"]');
        if (t) t.focus({ preventScroll: true });
      }
    }));
    help.textContent = ROLES[d.role].help;
    if (preview) paintPreview();
  }

  function optRow(label, items) {
    return h('div', { class: 'fam-opt-row', role: 'group', 'aria-label': label },
      items.map((it) => h('button', {
        type: 'button',
        class: 'fam-opt' + (it.text ? ' text' : ''),
        'aria-pressed': it.on ? 'true' : 'false',
        'aria-label': it.label,
        title: it.label,
        dataset: { key: it.key },
        style: it.style || null,
        onclick: () => {
          it.pick();
          paintLook();
          paintPreview();
          const b = lookSlot.querySelector('[data-key="' + it.key + '"]');
          if (b) b.focus({ preventScroll: true });
        }
      }, it.text || null)));
  }

  function paintLook() {
    const hairs = hairList();
    const skins = skinList();
    const colors = swatchList();
    lookSlot.replaceChildren(
      optRow('Hair', hairs.map((n, i) => ({ key: 'hair-' + i, label: cap(n), text: cap(n), on: d.look.hair === i, pick: () => { d.look.hair = i; } }))),
      optRow('Skin', skins.map((c, i) => ({ key: 'skin-' + i, label: 'Skin tone ' + (i + 1), on: d.look.skin === i, style: { background: c }, pick: () => { d.look.skin = i; } }))),
      optRow('Colour', colors.map((c, i) => ({ key: 'color-' + i, label: 'Colour ' + (i + 1), on: String(d.look.color).toUpperCase() === String(c).toUpperCase(), style: { background: c }, pick: () => { d.look.color = c; } })))
    );
  }

  const submit = async () => {
    const name = d.name.trim();
    if (!name) {
      err.textContent = 'Give them a name first.';
      nameIn.focus();
      return;
    }
    err.textContent = '';
    const body = { name, role: d.role, look: d.look, healthName: d.healthName.trim() };
    const r = editing
      ? await api.put('/api/members/' + enc(member.id), body)
      : await api.post('/api/members', body);
    if (r) {
      dlg.close();
      toast(editing ? 'Saved ' + name : name + ' joined the family');
    }
  };

  const formBody = () => {
    nameIn = Input({ id: 'mem-name', value: d.name, placeholder: 'For example, Maa', autofocus: true, onInput: (v) => { d.name = v; err.textContent = ''; }, onKeyDown: submitOnEnter });
    healthIn = Input({ id: 'mem-health', value: d.healthName, placeholder: 'As in the health readings', onInput: (v) => { d.healthName = v; }, onKeyDown: submitOnEnter });
    help = h('p', { class: 'fam-muted small', id: 'mem-role-help' });
    roleSlot = h('div', { class: 'fam-role-slot' });
    preview = h('div', { class: 'fam-preview' });
    lookSlot = h('div', { class: 'fam-look' });
    err = h('div', { class: 'field-error', role: 'alert' });
    paintRole();
    paintLook();
    return h('div', { class: 'fam-form' },
      h('div', { class: 'fam-form-top' },
        preview,
        Field({ label: 'Name', id: 'mem-name', children: nameIn })),
      h('div', { class: 'field' },
        h('span', { class: 'field-label', id: 'mem-role-label' }, 'Role'),
        roleSlot,
        help),
      Field({ label: 'Health name (optional)', id: 'mem-health', desc: 'Used by the family-health agent. Match the name in phone health readings.', children: healthIn }),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Look'),
        lookSlot),
      err);
  };

  dlg = openDialog({
    title: editing ? 'Edit ' + member.name : 'Add a family member',
    description: editing ? 'Change the name, role, health name or look.' : 'Add a person in the house, an elder or a child.',
    width: 460,
    body: formBody,
    actions: [
      { label: 'Cancel', variant: 'outline' },
      { label: editing ? 'Save' : 'Add member', variant: 'primary', primary: true, keepOpen: true, onClick: submit }
    ]
  });
}

/* ---------- invite ---------- */

async function openInvite(m) {
  const dlg = openDialog({
    title: 'Invite ' + m.name + "'s phone",
    description: 'Scan this code to link a phone to ' + m.name + '.',
    width: 460,
    actions: [
      { label: 'Regenerate', variant: 'outline', icon: 'refresh', keepOpen: true, onClick: () => loadInvite(dlg, m) },
      { label: 'Done', variant: 'primary', primary: true }
    ]
  });
  loadInvite(dlg, m);
}

async function loadInvite(dlg, m) {
  dlg.setBody(Loading('Making a code...'));
  const r = await api.post('/api/members/' + enc(m.id) + '/invite', {});
  if (!r || !r.code) {
    dlg.setBody(EmptyState({ compact: true, icon: 'alert', title: 'No code yet', text: 'Could not make an invite. Try Regenerate.' }));
    return;
  }
  dlg.setBody(h('div', { class: 'fam-invite' },
    h('div', { class: 'fam-qr-tile' },
      h('img', { src: r.qr, width: 200, height: 200, alt: 'QR code to link ' + m.name + "'s phone" })),
    h('div', { class: 'fam-code-wrap' },
      h('span', { class: 'fam-muted small' }, 'Code'),
      h('code', { class: 'fam-code' }, r.code)),
    h('p', { class: 'fam-muted small' }, 'Expires ' + expiry(r.expiresAt) + '.'),
    h('p', { class: 'fam-steps' }, 'On their phone open Beacon, then Settings > Desktop hub > Scan QR. Elders: scan it on their phone or show it to them.')));
}

/* ---------- phones waiting to join ---------- */

function joinsBlock(list) {
  if (!list.length) return null;
  return h('section', { class: 'fam-section', 'aria-labelledby': 'fam-h-joins' },
    h('h3', { class: 'fam-h3', id: 'fam-h-joins' }, 'Phones waiting to join'),
    h('p', { class: 'fam-muted small' }, 'These phones said hello without an invite. Approve one to add it with the role you choose.'),
    h('ul', { class: 'fam-list' }, list.map(joinRow)));
}

function joinRow(j) {
  const k = safeId(j.deviceId);
  const dr = drafts.joins[j.deviceId] || (drafts.joins[j.deviceId] = { name: j.name || '', role: 'elder' });
  return h('li', { class: 'fam-join' },
    h('div', { class: 'fam-join-top' },
      Dot({ state: 'waiting' }),
      h('span', { class: 'fam-member-name' }, j.name || 'New phone'),
      h('span', { class: 'fam-muted small' }, 'asked ' + relTime(j.at))),
    h('div', { class: 'fam-join-form' },
      Field({ label: 'Name', id: 'join-name-' + k, children: Input({ id: 'join-name-' + k, value: dr.name, placeholder: 'Name', dataset: { focusKey: 'join-name-' + k }, onInput: (v) => { dr.name = v; } }) }),
      Field({ label: 'Role', id: 'join-role-' + k, children: Select({ id: 'join-role-' + k, value: dr.role, options: ROLE_OPTIONS, onChange: (v) => { dr.role = v; } }) }),
      h('div', { class: 'fam-join-btns' },
        Button({ label: 'Approve', size: 'sm', dataset: { focusKey: 'approve-' + k }, onClick: () => approveJoin(j, dr) }),
        Button({ label: 'Decline', size: 'sm', variant: 'ghost', dataset: { focusKey: 'decline-' + k }, onClick: () => declineJoin(j) }))));
}

async function approveJoin(j, dr) {
  const name = dr.name.trim() || j.name || 'Family';
  const r = await api.post('/api/joins/' + enc(j.deviceId) + '/approve', { role: dr.role, name });
  if (r) {
    delete drafts.joins[j.deviceId];
    toast(name + ' joined as ' + ROLES[dr.role].label.toLowerCase());
  }
}

async function declineJoin(j) {
  const r = await api.del('/api/joins/' + enc(j.deviceId));
  if (r) {
    delete drafts.joins[j.deviceId];
    toast('Phone declined');
  }
}

/* ---------- group chat ---------- */

function composer() {
  const ta = h('textarea', {
    id: 'fam-compose',
    class: 'textarea fam-compose-input',
    rows: 2,
    maxlength: MAX_CHAT,
    placeholder: 'Write to the family',
    'aria-label': 'Message the family. Enter sends, Shift plus Enter makes a new line.',
    dataset: { focusKey: 'fam-compose' },
    oninput: (e) => {
      drafts.chat = e.target.value;
      syncComposer(false);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChat();
      }
    }
  }, drafts.chat);
  const count = h('span', { class: 'fam-count', 'aria-live': 'off' });
  const send = Button({ label: 'Send', icon: 'send', size: 'sm', onClick: () => sendChat() });
  refs = { ta, count, send };
  syncComposer(false);
  return h('div', { class: 'fam-composer' },
    ta,
    h('div', { class: 'fam-compose-foot' }, count, send));
}

function syncComposer(busy) {
  if (!refs.ta) return;
  const n = drafts.chat.length;
  refs.count.textContent = n + ' / ' + MAX_CHAT;
  refs.count.classList.toggle('near', n > MAX_CHAT - 40);
  refs.send.disabled = busy || !drafts.chat.trim();
}

async function sendChat() {
  const text = drafts.chat.trim();
  if (!text || meta.sending) return;
  meta.sending = true;
  syncComposer(true);
  const m = await api.post('/api/chat', { text });
  meta.sending = false;
  if (m) {
    meta.forceBottom = true;
    if (drafts.chat.trim() === text) drafts.chat = '';
    if (refs.ta) refs.ta.value = drafts.chat;
  }
  if (refs.ta) refs.ta.focus({ preventScroll: true });
  syncComposer(false);
}

function paintChat(root, g, members) {
  const log = root.querySelector('.fam-log');
  if (!log) return;
  const msgs = g.messages || [];
  const sig = JSON.stringify([msgs, members.map((m) => [m.id, m.role, m.name, m.deviceId ? 1 : 0])]);
  if (log.__sig === sig) return;
  const first = log.__sig === undefined;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const keep = log.scrollTop;
  log.__sig = sig;

  const prev = seen;
  seen = new Set(msgs.map((m) => m.id));
  const fresh = new Set(msgs.filter((m) => !prev.has(m.id)).map((m) => m.id));
  log.replaceChildren(...chatNodes(msgs, members, first ? new Set() : fresh));

  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  if (first) requestAnimationFrame(toBottom);
  else if (meta.forceBottom || atBottom) toBottom();
  else log.scrollTop = keep;
  meta.forceBottom = false;
}

function chatNodes(msgs, members, fresh) {
  const out = [];
  let day = '';
  msgs.forEach((m) => {
    const d = dayLabel(m.at);
    if (d !== day) {
      day = d;
      out.push(h('div', { class: 'fam-day' }, d));
    }
    out.push(bubble(m, members, fresh.has(m.id)));
  });
  if (!out.length) out.push(h('p', { class: 'fam-empty-chat' }, 'No messages yet. Say hello to the family.'));
  return out;
}

function bubble(m, members, fresh) {
  const kind = m.kind || 'text';
  const anim = fresh ? ' fam-in' : '';
  if (kind === 'agent' || kind === 'alert') {
    return h('div', { class: 'fam-sys' + anim },
      h('span', null, m.text),
      h('time', { class: 'fam-time', datetime: new Date(m.at).toISOString() }, clock(m.at)));
  }
  const mine = isMine(m, members);
  const who = members.find((x) => x.id === m.from);
  const role = who ? who.role : 'other';
  const cls = ['fam-msg', mine ? 'me' : 'them', kind === 'sos' ? 'sos' : '', kind === 'safe' ? 'safe' : ''].filter(Boolean).join(' ');
  const tag = kind === 'sos' ? icon('alert', 12) : kind === 'safe' ? icon('check', 12) : null;
  return h('div', { class: cls + anim, 'data-id': m.id },
    mine ? null : h('div', { class: 'fam-msg-meta' },
      h('span', { class: 'fam-name ' + role }, m.fromName || (who ? who.name : 'Family'))),
    h('div', { class: 'fam-bubble' }, tag, tag ? ' ' : null, m.text),
    h('div', { class: 'fam-msg-meta' },
      h('time', { class: 'fam-time', datetime: new Date(m.at).toISOString() }, clock(m.at))));
}

/* ---------- questions from phones ---------- */

function asksBlock(g) {
  const asks = (g.asks || []).slice();
  const ordered = asks.filter((k) => k.status === 'pending').concat(asks.filter((k) => k.status !== 'pending'));
  let sw = null;
  sw = Switch({
    checked: !!g.allowAdultAsks,
    label: "Answer adults' questions automatically",
    onChange: async (on) => {
      const r = await api.put('/api/settings', { allowAdultAsks: on });
      if (!r && sw) sw.setAttribute('aria-checked', on ? 'false' : 'true');
    }
  });
  sw.dataset.focusKey = 'allow-asks';
  return h('section', { class: 'fam-section', 'aria-labelledby': 'fam-h-asks' },
    h('h3', { class: 'fam-h3', id: 'fam-h-asks' }, 'Questions from phones'),
    ordered.length
      ? h('ul', { class: 'fam-list', 'aria-label': 'Questions' }, ordered.map(askItem))
      : h('p', { class: 'fam-muted small' }, 'No questions yet. When a phone asks the desktop something, it shows here.'),
    h('div', { class: 'group' },
      GroupRow({
        label: "Answer adults' questions automatically",
        desc: 'Adults get an answer straight away. Everyone else waits for you.',
        control: sw
      })));
}

function askItem(k) {
  const st = ASK_STATUS[k.status] || { label: k.status, tone: 'muted' };
  return h('li', { class: 'fam-ask' },
    h('div', { class: 'fam-ask-head' },
      h('span', { class: 'fam-member-name' }, k.name || 'Family'),
      h('span', { class: 'fam-muted small' }, relTime(k.at)),
      Chip({ label: st.label, tone: st.tone })),
    h('p', { class: 'fam-ask-text' }, k.text),
    k.answer ? h('p', { class: 'fam-ask-answer' }, h('span', { class: 'fam-muted small' }, 'Answer: '), k.answer) : null,
    k.status === 'pending'
      ? h('div', { class: 'row-inline' },
          Button({ label: 'Approve', size: 'sm', dataset: { focusKey: 'ask-ok-' + safeId(k.id) }, onClick: () => answerAsk(k, 'approve') }),
          Button({ label: 'Deny', size: 'sm', variant: 'outline', dataset: { focusKey: 'ask-no-' + safeId(k.id) }, onClick: () => answerAsk(k, 'deny') }))
      : null);
}

async function answerAsk(k, answer) {
  const r = await api.post('/api/asks/' + enc(k.id), { answer });
  if (r) toast(answer === 'approve' ? 'Answer sent to ' + (k.name || 'the phone') : 'Question declined');
}
