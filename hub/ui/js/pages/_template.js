// PAGE MODULE TEMPLATE. Copy this file to js/pages/<name>.js and register it in js/main.js (PAGES)
// and, if it should be in the sidebar, in js/model.js (NAV).
//
// Contract:
//   export default { id, title, icon, render(ctx), update?(root, ctx) }
//
//   id, title, icon   strings. id is the route name (#<id>). icon is a name from js/icons.js.
//   render(ctx)       returns ONE root DOM node. Called on every state change (SSE, mutations, route
//                     changes). Keep it cheap and pure: read ctx.state, build nodes, return.
//                     Give the root class "page" and put the scrolling part in a child with class "scroll",
//                     so the shell can keep its scroll position.
//   update(root, ctx) optional. If present it is called instead of render() when the route is the same
//                     page and key as last time, so you can patch the existing DOM and keep local
//                     widgets (an open editor, a canvas) alive. Without it, render() runs every time.
//
//   ctx = {
//     state,        hub snapshot (GET /api/state). Never null when render runs (the shell shows a loader first).
//     route,        { page, id, query, hash } parsed from the URL. Example: #agents/abc?tab=rules gives id 'abc', query.tab 'rules'.
//     id, query,    shortcuts for route.id and route.query.
//     api,          api.get / post / put / del (JSON). Each resolves to the body, or null after an error toast.
//                   Pass { throws: true } as a last argument to get an Error instead.
//     ui,           the ui module namespace: h, Button, IconButton, Tabs, Switch, Chip, Dot, Avatar,
//                   EmptyState, PageHeader, Field, Input, Textarea, Select, GroupRow, Tooltip, Menu, icon,
//                   openDialog, confirmDialog, toast, clock, relTime, dayLabel.
//     el,           same as ui.h (short builder): el('div', {class: 'x', onclick: fn}, child, 'text')
//     nav(hash),    navigate, e.g. ctx.nav('#agents/abc?tab=settings').
//     toast(msg, opts),         kind 'ok' | 'err' | 'info', title, detail, undo {label, ms, onUndo, onExpire}.
//     openDialog(opts),         returns { close, setBody, setActions, setBusy, el }.
//     confirm({title, text, confirmLabel, danger}) resolves true or false.
//     refresh(),    re-fetch the snapshot now (usually not needed after an api call: mutations refresh by themselves).
//     panel,        right panel: panel.open(title, node), panel.close().
//     palette(),    open the Ctrl+K search.
//     store         the store module (store.state is the same as ctx.state).
//   }
//
// Rules of thumb:
//   - Give inputs a stable id (or data-focus-key). The shell puts focus and caret back by id after each render.
//   - Keep drafts (unsaved text) in module variables keyed by id, so a re-render does not wipe them.
//   - Do not fetch in render(). Call the api from event handlers; the mutation refreshes the snapshot.
//   - Use the spec tokens (css/tokens.css) and the components in ui.js. No inline colours.

import { h, EmptyState, PageHeader, Button } from '../ui.js';

export default {
  id: 'example',
  title: 'Example',
  icon: 'activity',

  render(ctx) {
    return h('div', { class: 'page' },
      PageHeader({ title: 'Example', sub: 'Page template', actions: [Button({ label: 'Do it', variant: 'outline', size: 'sm', onClick: () => ctx.toast('Done') })] }),
      h('div', { class: 'scroll' },
        h('div', { class: 'col' },
          EmptyState({ icon: 'activity', title: 'Nothing here', text: 'Replace this with the page.' }))));
  }
};
