# Beacon Hub Desktop UI Spec

Target: `C:\Users\VAIBHAV\Desktop\INAE\hub\ui` (plain HTML, CSS, JS).
Goal: the Hub looks and behaves like the Jargon desktop app's agent workspace. This document is self-contained. An engineer builds from it without opening Jargon.

Source notes (for traceability only, not needed to build):
- Tokens: Jargon `packages/brand/src/tokens.css`.
- Shell and sidebar: `src/renderer/src/styles/app-shell.css`, `packages/ui/src/features/sidebar/*`.
- Primitives: `packages/ui/src/styles/primitives.css`, `sliding-tabs.css`.
- Settings modal: `packages/ui/src/features/settings/settings-modal.css`.
- Diagram canvas: `packages/ui/src/features/diagrams/diagrams.css`, `diagram-graph.ts`.
- Strings: `packages/i18n/src/messages/en/*.ts`.

Important corrections to the brief:
1. Jargon's desktop renderer is dark only (`color-scheme: dark`). It defines no light desktop palette. Section 2 gives the dark palette. The light column is marked "derive" and gives a rule, not a sourced value. Do not claim it matches Jargon.
2. Jargon's MCP custom-server form has no per-tool enable toggles. It has one enable Switch per server, and a test returns a tool count. Section 3.9 follows that.
3. The agent header tab set in Jargon is not Overview/Nodes/Rules/Activity/Settings. The real pattern is a chat view plus a right side panel with panes (browser, files, tasks, settings, question, voice, subagent) and a settings panel with groups Brain, Knows, Does, Rules. Section 5 maps Beacon's tabs onto these.
4. The OpenBot README (github.com/nightly-labs/openbot, fetched) says: the desktop app is an Electron app that runs the agents and stores data locally. The iPhone app is a client that pairs with a running desktop via a Mobile Connect QR code, over an encrypted WebRTC channel. The phone never hosts agents.

---

## 1. Overall layout

### 1.1 Window chrome
- Window background (outside the card): `#0f0f0f` (mix of canvas and notch black, `color-mix(in srgb, #1a1a1a 50%, #000000)`, rounded to `#0d0d0d` by 50% mix; use `#0d0d0d`).
- Top row height: 38px (`--left-header-height`). It is a drag region (`-webkit-app-region: drag`), and buttons inside it are `no-drag`.
- Card: one rounded surface holding sidebar, main pane and right panel, below the top row.
  - Card fill: `#1a1a1a`. Card border: 1px `rgba(255,255,255,0.035)`. Card radius: 14px.
  - Card inset: 0 right and bottom, 5px (`--window-edge` = 4px plus 1px line). Top starts at 37px (`header height - 1`).
- No line between the top row and the card. The card's outline draws the edge.

### 1.2 Grid
```
+------------------ 38px top row (drag) -------------------------------+
| (no rail)        |                                                     |
| SIDEBAR          | MAIN PANE (chat / canvas / settings page)  | RIGHT |
| 280px (128-400)  | minmax(424px, 1fr)                         | PANEL |
|                  |                                            | 296px |
+------------------------------------------------------------------------+
```
- Left sidebar default width 280px. Min 128px. Max 400px. Compact (icon-only) width 88px. Collapse threshold 110px, expand threshold 118px.
- Main pane minimum width 424px.
- Optional server rail on the far left: 64px wide (56px narrow). Beacon can omit it.
- Right panel (side panel) default width 296px, max 1600px. Hidden when closed.
- Resizers: 6px wide hit area, a 1px line `rgba(255,255,255,0.035)` that turns `#007cf7` on hover or drag.
- Persist widths in `localStorage` keys `beacon:left-panel-width`, `beacon:settings-panel-width`.

### 1.3 Left sidebar structure (top to bottom)
1. Top row (38px, height shared with window top row). Left: server or workspace name button (28px high, ghost, 14px text, chevron). Right: icon buttons 28x28, 3px gap: Marketplace or Plugins (puzzle), New (plus, opens menu: New agent, New section).
2. Search field (padding `8px 12px 6px`). Height 32px, radius 6px, background `rgba(255,255,255,0.06)`, 0.5px border `rgba(255,255,255,0.035)`, placeholder 13px `#979797`. Click opens global search (Ctrl+K). Focus: background `#212121`, border `#6a6a6a`.
3. Segmented switch (padding `2px 12px 6px`): two tabs, e.g. "Chats" | "Routines". Sliding pill, see 3.3.
4. Agent list (padding `4px 12px 0`, scrollbar hidden, scroll on hover 8px thumb). Groups:
   - "Needs you" (waiting agents) first, when any.
   - Pinned group.
   - User sections (collapsible, named).
   - "Hidden" group at the bottom, collapsed by default.
5. Footer (optional): usage or account chip, 40px high.

### 1.4 Agent rows
- Row: height 54px, padding 8px, gap 8px, radius 8px, width 100% of list content (list inset adds 8px on each side in the non-compact sidebar, so rows reach 4px from the sidebar edge).
- Stack between rows: 4px.
- Avatar: 36x36 circle, character rendered inside. Name sits under the avatar, 13px, max-width 72px, in the row figure.
- Copy: name (14px, weight 600 for the name). Right of the name: optional role badge (11px, outline). Right side of heading: relative time (12px, `#979797`).
- Preview: 13px, line-height 18px, single line, ellipsis, colour `#979797`.
- Status dot: bottom-right of avatar, offset right -5px, bottom -3px. Container with 2px border of the sidebar colour (`#1a1a1a`), shadow `0 1px 3px rgba(0,0,0,0.1)`.

States:
| State | Visual |
|---|---|
| Default | transparent background, text `#ffffff`, preview `#979797` |
| Hover | background `rgba(255,255,255,0.06)` |
| Pressed (`:active`) | `transform: scale(0.99)` |
| Active (selected) | background `#212121`. Status ring border becomes `#212121` |
| Working | status pill 24x16, radius pill, background `#212121`, three typing dots (2px gap) |
| Unread | count badge, background `#74b9ff`, text `#07131f`, 12px weight 600 |
| Responded | check icon, color `#31cf76` |
| Waiting (needs you) | wait chip: pill, background `rgba(255,146,18,0.12)`, text `#ff9412`, 12px, weight 600, icon 11px, padding `1px 7px 1px 5px`. Tooltip after 350ms, placement right, 10px gutter |
| Limited (usage) | clock icon, chip with reset time, `#ff9412` |
| Routine running/queued | small status text in place of preview, `#42a0ff` |
| Routine failed | `#ff6069` |
| Asleep / hidden | avatar at 50% opacity, preview shows "Hidden since {date}" |

Context menu on right click: Rename, Pin, Move to section (submenu), Hide, Delete (destructive, last).

### 1.5 Sections
- Section header toggle: height 32px, padding 0 7px, radius 8px, text `rgba(255,255,255,0.59)` 12px, weight 400. Hover text `#dcdcdc`. Chevron 12px, hidden until hover, rotates 90deg when expanded.
- Section body: 2px gap between items.
- Empty section: text "Drop agents here" 12px, `#6a6a6a`, dashed 1px `rgba(255,255,255,0.1)` border, radius 8px, height 40px.

### 1.6 Empty states
- No agents: centered in the list. Title 14px weight 600, body 13px `#979797`, one primary button "Create your first agent" (see 3.4). Vertical padding 48px.
- No agent selected (main pane): centered, 18px title "Choose an agent or create one.", 13px secondary line, primary button "New agent".
- Search no results: `p.empty-search`, 13px, `#979797`, padding 24px, text "No matches."

### 1.7 Main pane (header and body)
- Header (agent header): height 52px, padding 0 16px, border-bottom 1px `rgba(255,255,255,0.035)`. Contents: avatar 28px, name 16px weight 600, subtitle (role or model) 12px `#979797`. Right: model picker button (outline, 28px high), status text, settings toggle (icon 28x28, `PanelRight` icon, dot badge when tasks run).
- Body: scroll region, padding 24px. Content max-width 680px, centred.
- Composer (bottom of chat): padding 12px 16px 16px. Field radius 14px, background `#212121`, border 1px `rgba(255,255,255,0.045)`, min height 44px, max 40% viewport. Send button 32x32 radius 8px background `#f0f0f0`, icon `#141414`.

### 1.8 Right panel (side panel) and drawers
- Width 296px. Background transparent (inside the card). Border-left 1px `rgba(255,255,255,0.035)`.
- Top row: tabs for each open pane, 28px high, then Add (+) and Maximize icons. Tab icon doubles as close: X appears on hover or focus.
- Panes: Browser, Files, Tasks, Settings, Question, Voice, Subagent. Beacon uses: Settings, Files, Tasks, Activity.
- Drawer open: `panel-open` 400ms, cubic-bezier(0.22,1,0.36,1), translateX from 100% (translateY 100px for mobile sheets). Close: 350ms.

---

## 2. Design tokens

Fonts:
- Sans: `"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Load Inter Variable (wght axis 100-900) locally, same as `@fontsource-variable/inter` 5.3.0.
- Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace`.
- Feature settings: `font-synthesis: none`. `text-rendering: geometricPrecision`.

Type scale (use exactly these six sizes):
| Token | Size | Line height | Use |
|---|---|---|---|
| text-sm | 12px | 16px | captions, section names, status, badges |
| text-md | 13px | 18px | previews, search, tabs, descriptions |
| text-lg | 14px | 20px | row names, button default, body |
| text-xl | 16px | 22px | panel titles, agent name in header |
| text-2xl | 18px | 24px | modal titles, empty-state titles |
| text-3xl | 24px | 30px | rare: onboarding |
Display 32px / 38px, reserved for full-screen first-run only.

Weights: regular 400, medium 500, semibold 600, bold 700. Tracking: headings -0.1px, body 0.

Colour (dark, the only desktop theme):
| Token | Hex / value | Use |
|---|---|---|
| bg-canvas | `#1a1a1a` | main pane, sidebar, card |
| bg-sidebar | `#1a1a1a` | sidebar, dialogs (confirm) |
| bg-window-frame | `#0d0d0d` | outside the card |
| bg-surface | `#212121` | active row, inputs, control, tab bar |
| bg-surface-raised | `#242424` | cards, toasts, node cards |
| bg-control | `#212121` | outline buttons, switch track |
| bg-control-hover | `#242424` | hover on outline/ghost |
| bg-control-active | `#2a2a2a` | pressed, tab pill |
| bg-grouped | `#212121` | grouped rows (template install) |
| border-grouped | `#333335` | separators in grouped rows |
| border | `rgba(255,255,255,0.035)` | dividers, card outline |
| border-strong | `rgba(255,255,255,0.045)` | inputs, edges |
| dialog-ring | `rgba(255,255,255,0.10)` | dialog outline |
| hover | `rgba(255,255,255,0.06)` | row hover, nav hover |
| dialog-overlay | `rgba(0,0,0,0.10)` + blur 4px | modal backdrop |
| text-primary | `#ffffff` | titles, active |
| text-secondary | `#dcdcdc` | labels, body |
| text-muted | `#979797` | previews, meta |
| text-dim | `#6a6a6a` | placeholders on dark, disabled |
| text-placeholder | `#bfbfbf` | input placeholder |
| text-readable | `rgba(255,255,255,0.52)` | section headers |
| text-on-light | `#141414` | text on light buttons |
| surface-light | `#f0f0f0` | primary button fill |
| accent | `#007cf7` | focus, progress, status dot |
| accent-hover | `#1f8fff` | |
| accent-text | `#42a0ff` | links, working status |
| accent-soft | `rgba(0,124,247,0.16)` | focus ring base |
| accent-strong | `rgba(0,124,247,0.34)` | |
| focus-border | `rgba(0,124,247,0.72)` | |
| focus-ring | `0 0 0 3px rgba(0,124,247,0.16)` | keyboard focus |
| success | `#31cf76` | responded, succeeded |
| success-soft | `rgba(49,207,118,0.12)` | |
| warning | `#ff9412` | waiting, limited |
| warning-soft | `rgba(255,148,18,0.12)` | wait chip |
| danger | `#fd2f3b` | destructive fill |
| danger-text | `#ff6069` | error text |
| danger-soft | `rgba(253,47,59,0.16)` | destructive button fill |
| danger-soft-hover | `rgba(253,47,59,0.28)` | |
| danger-border | `rgba(253,47,59,0.50)` | invalid input |
| unread | `#74b9ff` | unread badge |
| unread-text | `#07131f` | |
| badge-new | `#ff1e5e` | "new" pill (not an action) |
| teal | `#6bc7d9` | question option |
| violet | `#d6adf2` | chart series |

Light theme: Jargon's desktop has none. If Beacon needs one, define the same token names on `:root[data-theme="light"]` with: canvas `#f7f7f8`, surface `#ffffff`, raised `#ffffff`, border `rgba(20,20,20,0.10)`, text-primary `#141414`, text-muted `rgba(20,20,20,0.52)`, accent unchanged. This is a suggestion, not Jargon's values.

Radii:
- xs 4px (chips, focus), sm 6px (search field, tab triggers), md 8px (buttons, rows, nav items), lg 12px (toasts, template card), card 14px (dialogs, card, edge), xl 20px (confirm dialog), modal 30px (rare), pill 999px (switch, badges, status).

Spacing scale: 2, 4, 6, 8, 12, 16, 24, 32px (use only these).

Control heights: xs 24px, sm 28px (sidebar icon buttons, tabs), md 32px (search, small buttons), lg 36px (default button), xl 40px (large button, row action). Toast min-height 40px.

Icons: Lucide style, stroke 1.5 (unitless, `stroke-width="1.5"` on a 24-unit viewBox). Sizes: 12px (xs), 14px (sm, tab icons), 16px (default, nav and buttons), 20px (lg). Colour: currentColor. Icon-only button: 28x28 (sidebar) or 32x32 (header).

Shadows:
- raised (popover, toast, node): `0 12px 32px rgba(0,0,0,0.10)`.
- overlay (dialog): `0 12px 32px rgba(0,0,0,0.48)`.
- dynamic/tooltip: none (tooltips use a 1px `rgba(255,255,255,0.1)` ring).
- Edge ring used on cards: `0 0 0 1px rgba(255,255,255,0.035)`.
- Switch track: inset `0 0 0 1px rgba(255,255,255,0.045)`, plus `0 1px 2px rgba(228,228,228,0.04)`.

Z-layers: dropdown 40, popover 60, dialog 100, toast 120, tooltip 240. Dialog host (dialog opening over dialog) = 160.

Spacing defaults: sidebar padding 12px; list padding 4px 12px 0; row padding 8px; section gap 25px in settings.

---

## 3. Components

### 3.1 Buttons
Base: inline-flex, centred, gap 6px, border 1px transparent, radius 8px, font 13px weight 500, line-height 1, padding 0 16px. Transitions 0ms colour (hover is instant).

Variants:
- Default (primary): bg `#f0f0f0`, text `#141414`. Hover: bg `rgba(240,240,240,0.82)`.
- Outline: bg `#212121`, border `rgba(255,255,255,0.035)`, text `#dcdcdc`. Hover: bg `#242424`, text `#fff`.
- Secondary: bg `#242424`, text `#fff`. Hover: `#2a2a2a`.
- Ghost: transparent, text `#979797`. Hover: bg `#242424`, text `#fff`.
- Destructive: bg `rgba(253,47,59,0.16)`, text `#fd2f3b`. Hover bg `rgba(253,47,59,0.28)`.
- Link: no bg, underline on hover, offset 4px.

States: focus-visible `box-shadow: 0 0 0 3px rgba(0,124,247,0.16)`. Disabled `opacity 0.42`, no pointer. Invalid `border rgba(253,47,59,0.5)` plus ring. Loading shows spinner and loading label. Pressed icon buttons: `scale(0.96)`.

Sizes: xs 24px (padding 0 8px, 12px), sm 32px (0 12px, 12px), default 36px, lg 40px (0 24px).

### 3.2 Icon buttons
28x28 (sidebar), 32x32 (header), radius 6px, colour `#979797`. Hover bg `rgba(255,255,255,0.035)`, text `#fff`. Active `scale(0.96)`. Focus outline 1px `#979797` offset 1px.

### 3.3 Segmented tabs (sliding)
- Bar: inline-flex, gap 3px, padding 3px, radius 8px, bg `#212121`, inset 1px `rgba(255,255,255,0.035)` outline.
- Trigger: height 28px, padding 4px 12px, radius 6px, text 13px weight 500 `#979797`. Selected or hover: `#fff`.
- Pill: absolute, height 28px, radius 6px, bg `#2a2a2a`, top 3px. Moves with `transform` and `width`, 250ms, cubic-bezier(0.22,1,0.36,1).
- Content swap: 150ms, translateY 4px and blur 2px to 0.

### 3.4 Agent creation flow (from scratch or template)
Entry: sidebar "+" menu, "New agent", or empty-state button. Opens a full main-pane page (not a modal). Header: avatar 28px, live name, Cancel (ghost, top right).

Two-column content, max width 680px:
1. Avatar editor: live avatar 96px centred. Below: colour row (swatches 24px circle: "Automatic" first, then hue options in a row, selected ring 2px `#007cf7`). Then face grid (4 columns of 56px tiles, radius 14px, selected border 2px `#007cf7`).
2. "Customize" disclosure (details/summary, 13px `#979797`). Inside: Skin, Hair (chip rows), Hair colour, Tie, Glasses (toggle rows), Reset link.
3. Fields (gap 16px):
   - Name (required, text input 36px, placeholder "Agent name").
   - Purpose (textarea, 3 rows, placeholder "What this agent is for"). This is the instructions field.
   - Model (select, 36px, shows models from connected providers; shows "Set up a provider" if none).
4. Submit: primary button full width at the bottom of the form, label "Create agent". Loading label "Creating…". Error: alert with `#ff6069` text, role alert.
5. Suggestions strip below (horizontal scroll, cards 200x120, radius 14px, bg `#242424`, title 14px, one-line description). Clicking fills Name and Purpose.

Persona: the avatar, colour and face together are the persona. Store them as `avatar: {hue, face, skin, hair, hairColor, tie, glasses}`.

Template path: start from a template card (3.5). "Add agent" installs the template and opens the same page pre-filled, locked to "Use template" until edited.

### 3.5 Template gallery card
- Card: width 100% of grid column (min 220px), height ~200px, radius 14px, bg `#242424`, ring 1px `rgba(255,255,255,0.035)`.
- Top: avatar 56px centred. Title 14px weight 600. "By {author}" 12px `#979797`. Description 13px, clamp 2 lines.
- Footer row: "Instructions · Skills · Routines" counts, 12px muted, and an outline button "Add" (sm).
- Hover: bg `#2a2a2a`, transition 160ms ease-out. Focus: focus ring.

Install dialog (centred, 420px, radius 14px, bg `#1a1a1a`, border 1px `rgba(255,255,255,0.10)`):
- Identity block: avatar 72px, name 18px, description (4 line clamp).
- Grouped rows (bg `#212121`, radius 16px): "Instructions", "Skills", "Routines". Each row 12px 16px padding, separator 1px `#333335`, count right in muted text, chevron.
- Footer: Cancel (outline) and "Add agent" (primary), right aligned.

### 3.6 Agent detail page (the agent's main view)
Header (52px) with tab strip. Tab strip below header is a sliding tab bar (3.3) with: **Overview | Nodes | Rules | Activity | Settings**.

- Overview: the chat (messages and composer), plus pinned summary card (persona, model, status).
- Nodes: the routine canvas (3.12).
- Rules: access and automation controls (see 3.7).
- Activity: timeline list of runs, tool calls, messages. Row: time 12px muted, icon 14px, text 13px. Groups by day, 12px `#979797` day headers.
- Settings: the settings panel (3.7).

Jargon's own tab map, for reference: header with model picker; right panel with panes; settings panel groups Brain (model, reasoning, access), Knows (memories, skills, files, tables), Does (routines, usage), Rules (permissions, busy message, task limit, backup models, computer use, local scripts, notifications), Advanced.

### 3.7 Settings panel and Settings modal
Settings panel (right panel, 296px default): title 16px weight 600, sections separated by 25px. Link groups: grouped rows (bg `#212121`, radius 16px, separator `rgba(255,255,255,0.035)` inset 16px). Each row: label 14px `#fff`, value 13px muted, chevron right. Fields: label 13px muted above input (36px, radius 8px, bg `#212121`).

Settings modal: width min(880px, 100vw-48px), height min(600px, 100dvh-48px), radius 14px, bg `#1a1a1a`, grid columns 220px and 1fr.
- Nav (220px): items 32px high, padding 0 8px, radius 8px, 13px `#dcdcdc`, icon 16px left. Current item bg `#242424`, text `#fff`, weight 500. Hover bg `rgba(255,255,255,0.06)`.
- Main: header padding 24px 24px 16px. Title 18px weight 600. Description 13px `#979797`.
- Rows: min-height 64px, padding 12px 16px, separators 1px inside a card.
- Switches (3.11). Save bar at bottom (footer), right-aligned actions.
- Opens: scale 0.965 to 1 and translateY 10px to 0, 240ms, cubic-bezier(0.23,1,0.32,1). Close: 150ms.

Beacon Rules tab should contain: Access (Workspace only, Ask first, Full access, with a confirm dialog for full access), Busy message (Queue, Steer), Tasks at once (number), Backup models (ordered list), Notifications, Local scripts (switch).

### 3.8 Connection and status indicators
- Dot: 8px circle. Online `#31cf76`. Working `#42a0ff` with a pulse. Waiting `#ff9412`. Offline/failed `#ff6069`. Asleep `#6a6a6a`.
- Pill: height 20px, padding 0 8px, radius 999px, 12px weight 600. Use the warning, success, danger soft backgrounds above.
- Connection row: name 14px, subtitle 12px muted, right: status pill, then a Connect or Manage button (outline sm).

### 3.9 MCP servers
List (settings page): one grouped card per server. Row: icon 28px rounded, name 14px, subtitle (transport and tool count, e.g. "STDIO · 6 tools" or "HTTP · 4 tools"), right: Switch (enable), overflow menu (Test, Edit, Remove). Status: "Signed in" pill, or "Not tested", or failure text in `#ff6069`.

Add or Edit dialog (Dialog 460px, radius 14px, bg `#1a1a1a`, border ring):
- Header: title "Connect MCP server", description, close X top right.
- Transport tabs: **STDIO | Streamable HTTP** (sliding tabs 3.3).
- Name (text).
- STDIO: Command (text), Arguments (repeatable rows with + Add argument), Environment variables (rows of key and value, + Add variable), Working directory (optional).
- HTTP: Server URL, Headers (rows of key and value, + Add header).
- Test section: button "Test connection" (outline). Result line: "Connected · 6 tools" in `#31cf76`, or failure in `#ff6069` with reason. A typed STDIO command that starts with http switches the form to HTTP.
- Footer: Cancel, "Save" (primary). Save runs a test first if none passed.
- Note: no per-tool toggles exist. The server's enable Switch controls the whole server. Show the tool count only.

Local app MCP (another app on this computer): dialog with numbered steps (ordered list), a docs link (link button with external icon), the address in code font, and "Connect" that retries. Steps stay visible after failure.

### 3.10 Toasts
- Position: bottom-right, 16px from edges, stack gap 8px, max 3 visible.
- Surface: bg `#242424`, ring 1px `rgba(255,255,255,0.035)`, shadow raised, radius 12px, padding 12px 16px, min-height 40px.
- Layout: 3 columns (icon, text, action), with actions on a second row.
- Text: title 13px weight 500, description 13px `#dcdcdc`, close X top right.
- Enter 340ms ease-out (translate and fade). Exit 220ms.
- Undo toast (delete agent): 32px avatar, title, detail (12px), progress bar 2px at bottom in `#007cf7` linear over 5s, then remove.

### 3.11 Switch
- Track 36x20, radius pill, bg `#212121`, inset ring `rgba(255,255,255,0.045)`. Thumb 16px white, inset 2px. Checked: track `#f0f0f0`, thumb `#141414`.
- Small variant 24x14, thumb 12px, inset 1px.
- Transition 0ms colour. Focus-visible ring.

### 3.12 Nodes canvas (the "path" of an agent)
Board: full area, background `#1a1a1a` with dot grid: radial dot 1px `rgba(255,255,255,0.045)` on a 24px grid. Pan with drag, zoom with wheel (zoom control bottom-right: - / % / +).

Node card (routine or agent node):
- Width 264px. Radius 14px. Bg `#242424`. Shadow `0 0 0 1px rgba(255,255,255,0.035)` plus raised shadow. Cursor grab.
- Header: row with 28x28 icon square (radius 8px, bg `rgba(0,124,247,0.16)`, icon `#42a0ff` 14px for agent; routine uses its own tint), kicker 11px muted uppercase ("ROUTINE" or "AGENT"), name 14px weight 600.
- Body: schedule or trigger line (12px muted), preview of last output (2 lines, 13px).
- Footer: status (12px, icon 12px): succeeded `#31cf76`, failed `#ff6069`, running `#42a0ff`; duration right, 12px muted.
- Ports: left input and right output, 26px down from the top of the card.

Edges: SVG path, stroke 2px `rgba(255,255,255,0.045)`, round caps. Delivered: stroke routine colour or accent. Running: stroke accent with dash 6 6, animated 0.6s linear infinite. Arrow: 9px length, 5.5px half width, tip gap 6px.

Inspector (right panel, 296px): header with name and status, body with run history (list of runs, each row time, status pill, duration), and an empty state "No runs yet."

Canvas menu (right click on empty space): New agent, New routine, Paste. Lens bar at the top: segmented tabs "Flow" | "Schedule".

### 3.13 Gateway (routes)
Use the Nodes canvas with a list fallback:
- Route row (list): left: source chip (channel or device, 12px pill), arrow 14px muted, destination chip (agent name, avatar 20px). Right: status pill and overflow menu.
- Route editor (dialog 460px): source select, destination select, filter text, enable Switch. Footer Cancel and Save.

### 3.14 Toast and dialog patterns (general)
- Dialog overlay: fixed inset 0, bg `rgba(0,0,0,0.10)`, backdrop blur 4px, fade in 240ms ease-out.
- Dialog (standard): width min(460px, 100%), max-height calc(100dvh - 48px), radius 20px, bg `#1a1a1a`, border 1px `rgba(255,255,255,0.10)`, no shadow. Enter: scale 0.97 and translateY 4px to 0, 200ms ease-out.
- Layout: icon left (20px in a 36px square), title 16px weight 600, description 13px muted, actions in a footer row divided by a 1px line, right aligned.
- Destructive confirm: the confirm button uses Destructive variant. Cancel is Outline.
- Keyboard: Esc closes (except while busy). Enter submits the primary action. Focus moves into the dialog on open, returns to the trigger on close.

### 3.15 Dropdowns and menus
- Content: min-width 200px, padding 4px, radius 8px, bg `#242424`, ring `rgba(255,255,255,0.035)`, shadow raised. Enter: 120ms fade and scale 0.97.
- Item: height 32px, padding 0 8px, gap 8px, radius 6px, 13px `#dcdcdc`, icon 16px. Hover or highlight bg `rgba(255,255,255,0.06)`, text `#fff`. Destructive item: text `#ff6069`.
- Separator: 1px `rgba(255,255,255,0.035)`, margin 4px 0.

### 3.16 Tooltips
- Bg `#2a2a2a`, text 12px `#fff`, padding 4px 8px, radius 6px, shadow raised. Open delay 350ms, skip delay 300ms. Gutter 10px.

### 3.17 Form controls
- Text input: height 36px, radius 8px, bg `#212121`, border 1px `rgba(255,255,255,0.035)`, padding 0 12px, 14px text. Focus: border `rgba(255,255,255,0.4)`, ring accent-soft. Placeholder `#6a6a6a`.
- Select: same as input, chevron 14px right.
- Textarea: min 3 rows, resize vertical, radius 8px.
- Field label: 13px weight 500 `#dcdcdc`, description 12px `#979797`, error 12px `#ff6069`.

---

## 4. Motion
Durations:
- hover 0ms (colour changes are instant, as Jargon sets `--jargon-duration-hover: 0ms`), fast 120ms, normal 160ms, slow 200ms, overlay 240ms, dialog 100ms (close)
- toast enter 340ms, exit 220ms
- sliding tab pill 250ms; tab content 150ms
- settings modal open 250ms, close 150ms
- side panel open 400ms, close 350ms
- resize (panel width) 300ms
- agent activity fade out after 500ms delay
- loading indicator shows after 400ms delay (so fast answers never flash a spinner)

Easings:
- ease-out (general): `cubic-bezier(0.23, 1, 0.32, 1)`
- panels and modals: `cubic-bezier(0.22, 1, 0.36, 1)`
- sheet and resize: `cubic-bezier(0.32, 0.72, 0, 1)`
- in-out: `cubic-bezier(0.77, 0, 0.175, 1)`

Patterns: row press `scale(0.99)`; icon press `scale(0.96)`; never animate layout for hover. Respect `prefers-reduced-motion: reduce` by setting all transitions to none.

Stream text: new characters fade in over 300ms with 40ms stagger, ease `cubic-bezier(0.22,1,0.36,1)`.

---

## 5. The 12 screens for Beacon Hub

Each screen uses the patterns above. Beacon names in brackets.

1. **Agents** (sidebar list plus detail). Sidebar: 3.4 rows, sections (Needs you, Pinned, user sections, Hidden). Detail: header and tabs Overview, Nodes, Rules, Activity, Settings (3.6).
2. **School** (persona gallery and enrol flow). Gallery: template cards (3.5) in a 3-column grid. Enrol: the creation flow (3.4), with persona avatar and purpose pre-filled.
3. **Vault** (templates). Template gallery (3.5), search field at top, install dialog (3.5).
4. **Nodes** (canvas and list of an agent's path). Canvas (3.12), list fallback is a vertical stack of node cards with edges drawn as 2px lines between them.
5. **Gateway** (routes). Route list and editor (3.13).
6. **Phones and Family** (members, group chat, invites). Members list: avatar 32px, name 14px, role 12px muted, status dot. Group chat: channel view with the same message row as Overview. Invite: dialog with a QR code (white `#ffffff` tile, 200px) and a copy link button.
7. **MCP servers**. Settings list and dialog (3.9).
8. **Health**. Status cards: 4 cards in a row (CPU, memory, storage, uptime), each with label 12px muted, value 24px weight 600, bar 4px `#007cf7` on `#242424`. Warning bars `#ff9412`, danger `#fd2f3b`.
9. **Activity**. Timeline list across all agents (3.6 Activity rows), filter segmented tabs (All, Messages, Runs, Errors).
10. **Connections** (Telegram, brain, phone pairing). Connection rows (3.8). Telegram: "Chats" section (rows with Link and Add to group buttons), attention alert in warning style. Brain: model and provider rows. Phone pairing: QR card (3.14 dialog) with "Replace" and "Revoke" confirms.
11. **Settings**. Modal (3.7): nav items General, Notifications, Voice, Computer use, Profile, Billing, Mobile connect, Updates. Each tab uses the rows pattern.
12. **Onboarding and first run**. Language step, provider step and the first-agent creation flow (3.4), full window, no sidebar.

---

## 6. ASCII wireframes

### 6.1 Main layout
```
+----------------------------------------------------------------------------+
| [Beacon ▾]                              [puzzle] [+]    (38px top row)     |
+-------------------------+----------------------------------+---------------+
| [ 🔍 Search          ] | Scout                  [model ▾] [⚙]|  Settings      |
| [Chats | Routines]     |  Overview Nodes Rules Activity Set. |  Files         |
|                         |----------------------------------|  Tasks         |
| NEEDS YOU               |                                  |               |
| (•) Scout   [Approve]   |   chat messages (max 680px)      |               |
|                         |                                  |               |
| PINNED                  |                                  |               |
| (o) Atlas        9:41   |                                  |               |
|                         |                                  |               |
| HOME                    |----------------------------------|               |
| > Vega   ●  working…    | [ Message…                  ] [→]|               |
|   Lumen      Ready      |                                  |               |
|                         +----------------------------------+               |
| HIDDEN (2)              |                                                   |
+-------------------------+---------------------------------------------------+
  280px sidebar              main (min 424px)                    296px panel
```

### 6.2 Agent detail
```
+-----------------------------------------------------------------------+
| (o) Scout   Scout Assistant · Claude Sonnet ▾        [⚙ settings]     |
|-----------------------------------------------------------------------|
|  [ Overview | Nodes | Rules | Activity | Settings ]   (sliding tabs) |
|-----------------------------------------------------------------------|
|  Overview: persona card, recent messages, composer                    |
|                                                                       |
|  +--------------------------------------------------------------+     |
|  | Message Scout…                                         [→]   |     |
|  +--------------------------------------------------------------+     |
+-----------------------------------------------------------------------+
```

### 6.3 Nodes path
```
        ( grid dots every 24px )
   +----------------+        +----------------+        +----------------+
   | [icon] ROUTINE |  --->  | [icon] AGENT   |  --->  | [icon] AGENT   |
   | Daily digest   |  2px   | Scout          |  dash  | Atlas          |
   | every day 9:00 |  line  | "Found 3 …"    |  flow  | waiting…       |
   | ● succeeded 2s |        | ● running  1m  |        | ● idle         |
   +----------------+        +----------------+        +----------------+
     264px wide                 264px wide                 264px wide
```

### 6.4 Gateway
```
+----------------------------------------------------------------+
| Routes                                              [+ Route]   |
|----------------------------------------------------------------|
| [Telegram]  →  (o) Scout           ● Active         [⋯]        |
| [Phone 2]   →  (o) Atlas           ● Active         [⋯]        |
| [Family]    →  (o) Lumen           ○ Paused         [⋯]        |
+----------------------------------------------------------------+
```

---

## 7. Keyboard shortcuts
- Ctrl+K (Cmd+K on macOS): open or close global search. Ignore Alt and Shift.
- Ctrl+, (Cmd+, on macOS): open settings, from any focus including text fields.
- Esc: close dialog, menu or search (not while busy).
- Enter: send in composer (or the send shortcut chosen in General settings; default Enter, with Shift+Enter for a newline).
- Up and Down in lists and menus: move highlight; Enter selects.
- Tab order: sidebar top row, search, list, main header, composer, right panel.
- Focus visible: ring `0 0 0 3px rgba(0,124,247,0.16)`.

---

## 8. Accessibility
- Agent rows are buttons with `aria-pressed` for the selected one, and an `aria-label` that reads name, title, state, time.
- Status changes announce through an `aria-live="polite"` region.
- Respect `prefers-reduced-motion`.
- Contrast: text-primary on canvas is above 15:1. text-muted `#979797` on `#1a1a1a` is about 6.5:1.
