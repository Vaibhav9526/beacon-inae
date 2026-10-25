// DOM helpers and components. No framework: every component returns a DOM node.
import './avatar.js'; // defines window.drawAvatar (pixel people)
import { icon } from './icons.js';

export { icon };

/* ---------- h(): element builder ---------- */

const BOOL_PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'indeterminate', 'readOnly']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props != null && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node)) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v == null || v === false) continue;
      if (key === 'class' || key === 'className') {
        el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      } else if (key === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (key.startsWith('on') && typeof v === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), v);
      } else if (key === 'htmlFor') {
        el.setAttribute('for', v);
      } else if (BOOL_PROPS.has(key)) {
        el[key] = v;
      } else if (v === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(v));
      }
    }
  } else if (props != null && props !== false) {
    kids.unshift(props);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- formatting ---------- */

export function clock(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function relTime(ms) {
  if (!ms) return '';
  const d = Date.now() - ms;
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const hrs = Math.round(m / 60);
  if (hrs < 24) return hrs + ' h ago';
  return Math.round(hrs / 24) + ' d ago';
}

export function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ---------- Avatar ---------- */

/** Pixel person. key: avatar cast key (sentinel, medic, ...). look: {hair, skin, color}. */
export function Avatar({ key = 'sentinel', look, size = 36, status, asleep = false, selected = false }) {
  const canvas = document.createElement('canvas');
  const wrap = h('span', { class: ['avatar', asleep && 'asleep', selected && 'selected'].filter(Boolean).join(' '), style: { '--av': size + 'px' } },
    h('span', { class: 'avatar-img' }, canvas),
    status ? h('span', { class: 'status-ring' }, Dot({ state: status })) : null
  );
  if (window.drawAvatar) window.drawAvatar(canvas, key, look || undefined);
  return wrap;
}

/* ---------- Button and IconButton ---------- */

const BTN_VARIANT = {
  primary: '',
  outline: 'btn-outline',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  destructive: 'btn-destructive',
  link: 'btn-link'
};

/** variant: primary | outline | secondary | ghost | destructive | link. size: xs | sm | md | lg. */
export function Button({ label, icon: iconName, variant = 'primary', size = 'md', onClick, type = 'button', disabled = false, loading = false, title, block = false, id, dataset, children } = {}) {
  const cls = ['btn', BTN_VARIANT[variant] || '', size === 'xs' ? 'btn-xs' : size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '', block ? 'btn-block' : '', loading ? 'btn-loading' : ''].filter(Boolean).join(' ');
  const b = h('button', {
    type,
    id,
    class: cls,
    title: title || undefined,
    disabled: disabled || loading,
    'aria-busy': loading ? 'true' : undefined,
    dataset,
    onclick: onClick
  },
    loading ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
    iconName && !loading ? icon(iconName, size === 'lg' ? 16 : 14) : null,
    label != null ? h('span', null, label) : null,
    children
  );
  return b;
}

/** Icon-only button with a tooltip. label is used for aria-label and the tooltip. */
export function IconButton({ icon: iconName, label, onClick, active = false, danger = false, size = 'sm', disabled = false, dataset, id } = {}) {
  const b = h('button', {
    type: 'button',
    id,
    class: ['icon-btn', size === 'lg' ? 'lg' : '', danger ? 'danger' : ''].filter(Boolean).join(' '),
    'aria-label': label,
    'aria-pressed': active ? 'true' : undefined,
    disabled,
    dataset,
    onclick: onClick
  }, icon(iconName, size === 'lg' ? 16 : 14));
  Tooltip(b, label);
  return b;
}

/* ---------- Tooltip (one floating layer) ---------- */

let tipEl = null;
let tipTimer = null;
let lastTipAt = 0;

export function Tooltip(target, text, { delay = 350 } = {}) {
  if (!target || !text) return target;
  const show = () => {
    clearTimeout(tipTimer);
    const wait = Date.now() - lastTipAt < 300 ? 0 : delay;
    tipTimer = setTimeout(() => {
      if (!target.isConnected) return;
      hideTip();
      tipEl = h('div', { class: 'tooltip', role: 'tooltip' }, text);
      document.body.append(tipEl);
      const r = target.getBoundingClientRect();
      const tw = tipEl.offsetWidth;
      const th = tipEl.offsetHeight;
      let left = r.right + 10;
      let top = r.top + r.height / 2 - th / 2;
      if (left + tw > window.innerWidth - 8) left = r.left - tw - 10;
      tipEl.style.left = Math.max(8, left) + 'px';
      tipEl.style.top = Math.max(8, top) + 'px';
      lastTipAt = Date.now();
    }, wait);
  };
  const hide = () => {
    clearTimeout(tipTimer);
    hideTip();
  };
  target.addEventListener('mouseenter', show);
  target.addEventListener('focus', show);
  target.addEventListener('mouseleave', hide);
  target.addEventListener('blur', hide);
  target.addEventListener('pointerdown', hide);
  return target;
}

function hideTip() {
  if (tipEl) {
    tipEl.remove();
    tipEl = null;
  }
}

/* ---------- Tabs (sliding segmented control) ---------- */

/**
 * items: [{id, label, icon?}]. value: selected id. onChange(id).
 * The pill slides between triggers (250 ms). Re-rendering is safe: the first placement does not animate.
 */
export function Tabs({ items, value, onChange, block = false, label }) {
  const pill = h('span', { class: 'tab-pill no-anim', 'aria-hidden': 'true' });
  const triggers = items.map((it) => {
    const t = h('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      'aria-selected': it.id === value ? 'true' : 'false',
      tabindex: it.id === value ? '0' : '-1',
      dataset: { tab: it.id },
      onclick: () => {
        if (it.id !== value && onChange) onChange(it.id);
      }
    }, it.icon ? icon(it.icon, 14) : null, it.label);
    return t;
  });
  const root = h('div', { class: 'tabs' + (block ? ' block' : ''), role: 'tablist', 'aria-label': label }, pill, triggers);
  const place = () => {
    const sel = triggers.find((t) => t.getAttribute('aria-selected') === 'true') || triggers[0];
    if (!sel) return;
    pill.style.width = sel.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + sel.offsetLeft + 'px)';
  };
  requestAnimationFrame(() => {
    place();
    requestAnimationFrame(() => pill.classList.remove('no-anim'));
  });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => place());
    ro.observe(root);
  }
  return root;
}

/* ---------- Switch ---------- */

/** Controlled switch: onChange(nextValue). The caller re-renders or updates state. */
export function Switch({ checked = false, onChange, label, small = false, disabled = false }) {
  return h('button', {
    type: 'button',
    role: 'switch',
    class: 'switch' + (small ? ' sm' : ''),
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    disabled,
    onclick: (e) => {
      const next = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', next ? 'true' : 'false');
      if (onChange) onChange(next);
    }
  });
}

/* ---------- Dialog ---------- */

const dialogStack = [];
let dialogSeq = 0;

function onDialogKey(e) {
  if (e.key !== 'Escape' || !dialogStack.length) return;
  const top = dialogStack[dialogStack.length - 1];
  if (top.busy || top.persistent) return;
  e.preventDefault();
  top.close();
}

/**
 * openDialog({ title, description, icon, danger, width, body, actions, persistent, onClose })
 *   body: node, or function(api) returning a node.
 *   actions: [{ label, variant, onClick(api), keepOpen, disabled }]
 * Returns api: { close(), setBody(node), setActions(list), setBusy(bool), el }.
 */
export function openDialog(opts = {}) {
  const prevFocus = document.activeElement;
  const id = 'dlg-' + ++dialogSeq;
  const api = { close, setBody, setActions, setBusy, el: null, busy: false, persistent: !!opts.persistent };
  let bodyEl = h('div', { class: 'dialog-body' });
  const actionsEl = h('div', { class: 'dialog-foot' });
  const titleEl = h('h2', { class: 'dialog-title', id: id + '-t' }, opts.title || '');
  const head = opts.title || opts.icon || opts.description
    ? h('div', { class: 'dialog-head' },
        opts.icon ? h('span', { class: 'dialog-icon' + (opts.danger ? ' danger' : '') }, icon(opts.icon, 20)) : null,
        h('div', { class: 'dialog-titles' }, titleEl, opts.description ? h('p', { class: 'dialog-desc' }, opts.description) : null),
        opts.persistent ? null : h('div', { class: 'dialog-close' }, IconButton({ icon: 'close', label: 'Close', onClick: () => close() })))
    : null;
  const dlg = h('div', {
    class: 'dialog' + (opts.wide ? ' wide' : ''),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': opts.title ? id + '-t' : undefined,
    tabindex: '-1',
    style: opts.width ? { width: 'min(' + opts.width + 'px, 100%)' } : null
  }, head, bodyEl, actionsEl);
  const scrim = h('div', { class: 'dialog-scrim' + (dialogStack.length ? ' stacked' : '') }, dlg);
  api.el = dlg;
  let closed = false;

  function setBody(node) {
    const next = h('div', { class: 'dialog-body' }, typeof node === 'function' ? node(api) : node);
    bodyEl.replaceWith(next);
    bodyEl = next;
  }

  function setActions(list) {
    actionsEl.replaceChildren(...(list || []).map((a) => {
      const b = Button({
        label: a.label,
        variant: a.variant || 'outline',
        icon: a.icon,
        disabled: a.disabled,
        onClick: async () => {
          if (!a.onClick) {
            if (!a.keepOpen) close();
            return;
          }
          const res = a.onClick(api);
          if (res && typeof res.then === 'function') {
            setBusy(true);
            try {
              await res;
            } finally {
              setBusy(false);
            }
          }
          if (!a.keepOpen && !closed) close();
        }
      });
      if (a.primary) b.dataset.primary = 'true';
      return b;
    }));
    if (!list || !list.length) actionsEl.remove();
    else if (!actionsEl.isConnected) dlg.append(actionsEl);
  }

  function setBusy(v) {
    api.busy = !!v;
    dlg.classList.toggle('is-busy', !!v);
    actionsEl.querySelectorAll('button').forEach((b) => {
      b.disabled = !!v;
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    const i = dialogStack.indexOf(api);
    if (i >= 0) dialogStack.splice(i, 1);
    scrim.remove();
    if (!dialogStack.length) document.removeEventListener('keydown', onDialogKey);
    if (opts.onClose) opts.onClose(api);
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
  }

  if (opts.body) setBody(opts.body);
  if (opts.actions) setActions(opts.actions);
  if (!dialogStack.length) document.addEventListener('keydown', onDialogKey);
  dialogStack.push(api);
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim && !api.persistent && !api.busy) close();
  });
  document.body.append(scrim);
  requestAnimationFrame(() => {
    const focusEl = dlg.querySelector('[data-autofocus]') || dlg.querySelector('input,textarea,select') || dlg.querySelector('[data-primary]') || dlg;
    if (focusEl && focusEl.focus) focusEl.focus({ preventScroll: true });
  });
  return api;
}

/** Destructive or plain confirm. Resolves true when confirmed. */
export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false, icon: iconName = 'alert' }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      description: text,
      icon: iconName,
      danger,
      width: 420,
      onClose: () => {
        if (!answered) resolve(false);
      },
      actions: [
        { label: 'Cancel', variant: 'outline', onClick: () => { answered = true; resolve(false); } },
        {
          label: confirmLabel,
          variant: danger ? 'destructive' : 'primary',
          primary: true,
          onClick: () => { answered = true; resolve(true); }
        }
      ]
    });
  });
}

/* ---------- Toast ---------- */

let toastHost = null;

function host() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  return toastHost;
}

/**
 * toast(message, opts): opts = { kind: 'ok'|'err'|'info', title, detail, avatar: {key, look},
 *   action: {label, onClick}, undo: {label, ms, onUndo, onExpire} }
 * Returns a close() function. Max 3 visible.
 */
export function toast(message, opts = {}) {
  const kind = opts.kind || (opts.error ? 'err' : 'ok');
  const ms = opts.undo ? opts.undo.ms || 5000 : kind === 'err' ? 5000 : 3200;
  let done = false;
  let timer = null;

  const iconEl = opts.avatar
    ? Avatar({ key: opts.avatar.key, look: opts.avatar.look, size: 32 })
    : h('span', { class: 'toast-icon' }, icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16));

  const textEl = h('div', { class: 'toast-text' },
    opts.title ? h('div', { class: 'toast-title' }, opts.title) : null,
    h('div', opts.title ? { class: 'toast-desc' } : { class: 'toast-title' }, message),
    opts.detail ? h('div', { class: 'toast-detail' }, opts.detail) : null
  );

  const actionsEl = h('div', { class: 'toast-actions' });
  const el = h('div', { class: 'toast ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : ''), role: kind === 'err' ? 'alert' : 'status' },
    iconEl, textEl, actionsEl,
    opts.undo ? h('div', { class: 'toast-progress', style: { animationDuration: ms + 'ms' } }) : null
  );

  const close = (expired) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
    if (expired && opts.undo && opts.undo.onExpire) opts.undo.onExpire();
  };

  const mkBtn = (label, onClick) => h('button', {
    type: 'button',
    class: 'btn btn-xs btn-ghost',
    onclick: () => { onClick(); close(false); }
  }, label);

  if (opts.undo) actionsEl.append(mkBtn(opts.undo.label || 'Undo', () => opts.undo.onUndo && opts.undo.onUndo()));
  if (opts.action) actionsEl.append(mkBtn(opts.action.label, () => opts.action.onClick && opts.action.onClick()));
  actionsEl.append(h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': 'Dismiss',
    onclick: () => close(false)
  }, icon('close', 12)));

  const stack = host();
  stack.append(el);
  const live = [...stack.querySelectorAll('.toast:not(.out)')];
  while (live.length > 3) {
    const old = live.shift();
    old.remove();
  }
  timer = setTimeout(() => close(true), ms);
  return close;
}

/* ---------- Menu ---------- */

let openMenu = null;

/**
 * Menu({ anchor, items, x, y }). items: [{label, icon, onClick, danger, disabled}] or '-' for a separator.
 * Closes on outside click, Esc, or selection. Arrow keys move the highlight.
 */
export function Menu({ anchor, items, x, y }) {
  if (openMenu) openMenu.close();
  const prev = document.activeElement;
  const buttons = [];
  const el = h('div', { class: 'menu', role: 'menu' }, items.map((it) => {
    if (it === '-') return h('div', { class: 'menu-sep', role: 'separator' });
    const b = h('button', {
      type: 'button',
      role: 'menuitem',
      class: 'menu-item' + (it.danger ? ' danger' : ''),
      disabled: !!it.disabled,
      onclick: () => {
        close();
        if (it.onClick) it.onClick();
      }
    }, it.icon ? icon(it.icon, 16) : null, h('span', null, it.label));
    buttons.push(b);
    return b;
  }));
  document.body.append(el);
  const r = anchor ? anchor.getBoundingClientRect() : { left: x || 0, bottom: y || 0, top: y || 0, right: x || 0 };
  let left = anchor ? r.left : r.left;
  let top = anchor ? r.bottom + 6 : y;
  if (anchor && left + el.offsetWidth > window.innerWidth - 8) left = Math.max(8, r.right - el.offsetWidth);
  if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, (anchor ? r.top : y) - el.offsetHeight - 6);
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, top) + 'px';

  const onDown = (e) => {
    if (!el.contains(e.target)) close();
  };
  const onKey = (e) => {
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const enabled = buttons.filter((b) => !b.disabled);
      if (!enabled.length) return;
      let i = enabled.indexOf(buttons[idx]);
      i = e.key === 'ArrowDown' ? (i + 1) % enabled.length : (i - 1 + enabled.length) % enabled.length;
      enabled[i].focus();
    }
  };
  function close() {
    if (openMenu !== api) return;
    openMenu = null;
    el.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
  }
  const api = { close, el };
  openMenu = api;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus({ preventScroll: true });
  return api;
}

/* ---------- Chip, StatusDot, EmptyState, PageHeader ---------- */

/** tone: '' | ok | warn | danger | accent | muted | outline */
export function Chip({ label, tone = '', icon: iconName, title }) {
  const outline = tone === 'outline';
  return h('span', {
    class: ['chip', outline ? 'outline' : tone, title ? '' : ''].filter(Boolean).join(' '),
    title
  }, iconName ? icon(iconName, 12) : null, label);
}

/** state: ok | working | waiting | bad | asleep */
export function Dot({ state = 'asleep', label }) {
  return h('span', { class: 'dot ' + state, role: label ? 'img' : undefined, 'aria-label': label, 'aria-hidden': label ? undefined : 'true' });
}

export function EmptyState({ icon: iconName, title, text, action, compact = false }) {
  return h('div', { class: 'empty' + (compact ? ' compact' : ''), role: 'status' },
    iconName ? h('span', { class: 'empty-icon' }, icon(iconName, 18)) : null,
    title ? h('p', { class: 'empty-title' }, title) : null,
    text ? h('p', { class: 'empty-text' }, text) : null,
    action ? h('div', { style: { marginTop: '8px' } }, action) : null
  );
}

/** Page header: 52px bar with title, sub line and right-side actions. */
export function PageHeader({ title, sub, avatar, actions }) {
  return h('header', { class: 'page-head' },
    avatar ? avatar : null,
    h('div', { class: 'page-head-main' },
      h('div', { class: 'page-head-title' }, title),
      sub ? h('div', { class: 'page-head-sub' }, sub) : null),
    actions ? h('div', { class: 'topbar-group' }, actions) : null
  );
}

/* ---------- Forms ---------- */

/* Accepts controls either as props.children or as trailing arguments:
   Field({ label, children: ctl }) or Field({ label }, ctl, ctl2). */
export function Field(props = {}, ...rest) {
  const { label, desc, error, id, span2 = false } = props;
  const src = props.children != null ? [props.children] : rest;
  const kids = src.flat(Infinity).filter((c) => c != null && c !== false);
  return h('div', { class: 'field' + (span2 ? ' span-2' : '') },
    label ? h('label', { class: 'field-label', htmlFor: id }, label) : null,
    ...kids,
    desc ? h('div', { class: 'field-desc' }, desc) : null,
    error ? h('div', { class: 'field-error', role: 'alert' }, error) : null
  );
}

/** Text input. onInput(value). */
export function Input({ value = '', placeholder, onInput, id, name, type = 'text', min, max, step, readonly = false, invalid = false, onKeyDown, autocomplete = 'off', dataset, autofocus = false }) {
  return h('input', {
    class: 'input',
    id,
    name: name || id,
    type,
    value,
    placeholder,
    min,
    max,
    step,
    readonly: readonly || undefined,
    autocomplete,
    dataset,
    'aria-invalid': invalid ? 'true' : undefined,
    'data-autofocus': autofocus ? '' : undefined,
    oninput: onInput ? (e) => onInput(e.target.value) : undefined,
    onkeydown: onKeyDown
  });
}

export function Textarea({ value = '', rows = 3, placeholder, onInput, id, name, invalid = false }) {
  return h('textarea', {
    class: 'textarea',
    id,
    name: name || id,
    rows,
    placeholder,
    'aria-invalid': invalid ? 'true' : undefined,
    oninput: onInput ? (e) => onInput(e.target.value) : undefined
  }, value);
}

/** options: [value, label] pairs or {value, label}. onChange(value). */
export function Select({ value, options, onChange, id, name }) {
  const opts = options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  });
  return h('select', {
    class: 'select',
    id,
    name: name || id,
    onchange: onChange ? (e) => onChange(e.target.value) : undefined
  }, opts);
}

/* ---------- Misc ---------- */

/** A small "Label: value" row inside a grouped card. */
export function GroupRow({ label, desc, value, control, onClick, chevron = false }) {
  return h('div', { class: 'group-row' + (onClick ? ' row' : ''), onclick: onClick, role: onClick ? 'button' : undefined, tabindex: onClick ? '0' : undefined },
    h('div', { class: 'group-row-main' },
      h('span', { class: 'group-row-label' }, label),
      desc ? h('span', { class: 'group-row-desc' }, desc) : null),
    value != null ? h('span', { class: 'group-row-value' }, value) : null,
    control || null,
    chevron ? icon('chevron-right', 14) : null
  );
}

/** Shared loading placeholder (the shell shows it until the first state arrives). */
export function Loading(text = 'Loading the hub...') {
  return h('div', { class: 'empty', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('p', { class: 'empty-text' }, text));
}

/** Makes a QR-looking placeholder data URL (for pages that show a pairing code without a real QR). */
export function svgDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
