// Inline SVG line icons. 20 unit grid, stroke 1.6, currentColor.
// Use: icon('agents', 16) returns an <svg> element.

const PATHS = {
  agents: '<circle cx="10" cy="7" r="3.2"/><path d="M4 17c.9-2.8 3.1-4.2 6-4.2s5.1 1.4 6 4.2"/>',
  school: '<path d="M10 4 2.5 7.5 10 11l7.5-3.5L10 4z"/><path d="M5.5 9.2V13c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V9.2"/><path d="M17.5 7.5V13"/>',
  vault: '<rect x="3.5" y="4.5" width="13" height="11" rx="2"/><circle cx="10" cy="10" r="2.2"/><path d="M10 6.6v.9M10 12.5v.9M6.6 10h.9M12.5 10h.9"/>',
  nodes: '<rect x="2.5" y="3" width="5" height="4" rx="1"/><rect x="12.5" y="13" width="5" height="4" rx="1"/><path d="M7.5 5h2.5a2.5 2.5 0 0 1 2.5 2.5V13h2"/>',
  gateway: '<path d="M3 6h7M3 14h7"/><path d="M7.5 3.5 10 6l-2.5 2.5M7.5 11.5 10 14l-2.5 2.5"/><rect x="13.5" y="4" width="3.5" height="12" rx="1.5"/>',
  phones: '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 14.5h2"/>',
  family: '<circle cx="7" cy="7" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M2.5 16c.6-2.4 2.4-3.7 4.5-3.7s3.9 1.3 4.5 3.7M12 15.3c.4-1.6 1.6-2.5 3-2.5 1.6 0 2.7 1 3 2.5"/>',
  chat: '<path d="M4 5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3H6a2 2 0 0 1-2-2z"/>',
  mcp: '<path d="M7 3v3.5M13 3v3.5M5 6.5h10v2.5a5 5 0 0 1-10 0V6.5z"/><path d="M10 14v3"/>',
  health: '<path d="M10 16.5s-6.2-3.6-6.2-8.1A3.4 3.4 0 0 1 10 6.3a3.4 3.4 0 0 1 6.2 2.1c0 4.5-6.2 8.1-6.2 8.1z"/>',
  activity: '<path d="M2.5 10h3l2-5 4 10 2-5h4"/>',
  plug: '<path d="M8 3v3.5M12 3v3.5M5.5 6.5h9v2.5a4.5 4.5 0 0 1-9 0V6.5z"/><path d="M10 13.5V17"/>',
  settings: '<path d="M3 6h7M14 6h3M3 14h3M10 14h7"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
  check: '<path d="M4.5 10.5 8 14l7.5-8"/>',
  play: '<path d="M7 5v10l8-5z"/>',
  pause: '<rect x="5.5" y="5" width="3" height="10" rx="0.6"/><rect x="11.5" y="5" width="3" height="10" rx="0.6"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10"/>',
  bell: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.2 1.5H3.8L5 13.5z"/><path d="M8.5 17h3"/>',
  send: '<path d="M17 3 3 9l5.5 2L10.5 17 17 3z"/><path d="M8.5 11 17 3"/>',
  qr: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><path d="M11.5 11.5h2v2h-2zM15 11.5h2M11.5 15h2M15 15h2v2h-2z"/>',
  refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3.5v3h-3"/>',
  link: '<path d="M8.5 11.5l3-3"/><path d="M7 13l-1.5 1.5a2.6 2.6 0 0 1-3.7-3.7L4.5 8.5"/><path d="M13 7l1.5-1.5a2.6 2.6 0 0 1 3.7 3.7L15.5 11"/>',
  moon: '<path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z"/>',
  sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M4.6 15.4 6 14M14 6l1.4-1.4"/>',
  chevron: '<path d="M8 5l5 5-5 5"/>',
  'chevron-right': '<path d="M8 5l5 5-5 5"/>',
  'chevron-left': '<path d="M12 5 7 10l5 5"/>',
  'chevron-down': '<path d="M5 8l5 5 5-5"/>',
  'chevron-up': '<path d="M5 12l5-5 5 5"/>',
  more: '<circle cx="4.5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
  pin: '<path d="M7.5 3.5h5l-1 4.5 2.5 2.5h-4L10 17l-.5-6.5h-4L8.5 8l-1-4.5z"/>',
  undo: '<path d="M7.5 6H12a4 4 0 0 1 0 8H8"/><path d="M7.5 6 10 3.5M7.5 6 10 8.5"/>',
  external: '<path d="M11 4h5v5"/><path d="M16 4l-7 7"/><path d="M8 5H5v10h10v-3"/>',
  alert: '<path d="M10 3 18 17H2L10 3z"/><path d="M10 8.5v4"/><path d="M10 14.6v.1"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6.5V10l2.5 1.5"/>',
  edit: '<path d="M13.5 4.5l2 2L7 15H5v-2l8.5-8.5z"/>',
  lock: '<rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  arrow: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 17c.8-2.6 3-4 6-4s5.2 1.4 6 4"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.4v.1"/>'
};

export const ICON_NAMES = Object.keys(PATHS);

/** Returns an SVG element for the icon. Unknown names fall back to a dot. */
export function icon(name, size = 16) {
  const body = PATHS[name] || '<circle cx="10" cy="10" r="2"/>';
  const wrap = document.createElement('template');
  wrap.innerHTML =
    '<svg class="ico" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  return wrap.content.firstElementChild;
}
