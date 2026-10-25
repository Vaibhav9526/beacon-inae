# Hub v2 local API

Base: the hub's local server (127.0.0.1). Every `/api/*` call sends header `x-hub-token` (from `?t=` in the page URL, kept in sessionStorage). JSON in and out. Errors: `{error: string}` with a 4xx/5xx status. Events: `GET /api/events?t=...` (EventSource) sends `data: {"type": "..."}` for `pending | alert | run | feed | group | ask | mcp | members`; the page then re-fetches `/api/state` (debounce 150 ms).

Types are in `hub/engine/types.ts` (Agent, Template, Persona, FeedItem, NodeSpec, GatewayRoute, Member, GroupMessage, McpServerSpec, McpToolInfo).

## GET /api/state

```
{
  agents: Agent[],                  // Agent.pipeline?: NodeSpec[], genre?, personaId?, look?
  templates: Template[], personas: Persona[],
  runs: RunLogEntry[], alerts: Alert[], audit: [...],
  connections: { telegram:{connected,paired,bot}, beacon:{paired}, brain:{kind,ok}, haiku:boolean },
  pending: null | { id, alertId, text, channels },     // first-send approval
  members: string[],                                   // health member names
  situation: { phase:'calm'|'watch'|'alert'|'recovering', level:0-3, headline, reasons, actions },
  feed: FeedItem[],                                    // last 100, newest first
  group: {
    members: Member[],
    messages: GroupMessage[],                          // last 200, oldest first
    pendingJoins: Array<{ deviceId, name, at }>,       // phones that said hello without a valid invite
    asks: Array<{ id, memberId, name, text, at, status:'pending'|'running'|'answered'|'denied', answer?:string }>,
    allowAdultAsks: boolean
  },
  gateway: { routes: GatewayRoute[] },
  mcp: { servers: McpServerSpec[], status: Array<{id, connected, toolCount, error?}>, tools: McpToolInfo[] },
  nodeKinds: Array<{ kind: NodeKind, label: string, description: string, source: boolean,
                     fields: Array<{ key: string, label: string, type: 'text'|'number'|'list'|'select'|'json'|'toggle', options?: string[], placeholder?: string }> }>
}
```

## Agents and nodes

- `POST /api/agents` `{personaId, name?, templateId?, genre?, place?, members?, look?, channels?, awake?}` or `{templateId}` -> Agent
- `PUT /api/agents/:id` any Agent fields; `DELETE /api/agents/:id`; `POST /api/agents/:id/toggle`; `POST /api/agents/:id/run` -> `{signals:number, items:number, results: NodeRunResult[]}`
- `PUT /api/agents/:id/pipeline` `{nodes: NodeSpec[]}` -> Agent (validates kinds; ids generated when missing)
- `POST /api/agents/:id/nodes/test` `{node: NodeSpec}` -> `{items: FeedItem[], result: NodeRunResult}` (runs one source node on its own)
- `POST /api/agents/:id/rules` `{text}` -> `{rule, via}`; `DELETE /api/agents/:id/rules/:ruleId`
- `POST /api/tick` -> `{alerts:number}`; `POST /api/approve` `{id, answer:'once'|'always'|'no'}`

## Gateway

- `PUT /api/gateway/routes` `{routes: GatewayRoute[]}` -> `{routes}`
- `POST /api/gateway/preview` `{item?: Partial<FeedItem>}` -> `{matches: Array<{routeId, routeName, recipients: string[], telegram: boolean, notify: boolean}>}` (nothing is sent)
- `POST /api/gateway/send-test` `{text?}` -> `{delivered:number}` sends a low-severity test item to all phones

## Members, invites, group chat, asks

- `POST /api/members` `{name, role, healthName?, look?}` -> Member (first member must be an adult; later calls are made by the desktop owner who counts as an adult)
- `PUT /api/members/:id`, `DELETE /api/members/:id`
- `POST /api/members/:id/invite` -> `{code, expiresAt, qr (data URL), payload}` (QR contains the pairing token, group key and invite)
- `POST /api/joins/:deviceId/approve` `{role, name?}` -> Member; `DELETE /api/joins/:deviceId`
- `POST /api/chat` `{text}` -> GroupMessage (sent as the desktop owner, fanned out to all phones)
- `POST /api/asks/:id` `{answer:'approve'|'deny'}`; `PUT /api/settings` `{allowAdultAsks: boolean}`

## MCP servers

- `POST /api/mcp` `{name, transport, command?, args?, env?, url?, headers?}` -> McpServerSpec
- `PUT /api/mcp/:id` `{enabled?, name?, ...}`; `DELETE /api/mcp/:id`
- `POST /api/mcp/:id/connect` -> `{ok, tools, error?}`; `POST /api/mcp/test` `{spec}` -> `{ok, tools, error?}`
- `POST /api/mcp/:id/call` `{tool, args}` -> `{result}`

## Existing (unchanged)

`POST /api/agents/:id/toggle`, health (`/api/health/csv`, `/api/health/reading`), `POST /api/telegram/token`, `POST /api/telegram/pair`, `POST /api/beacon/pair` (now `{memberId?}`), `POST /api/brain`, `GET /api/situation`, `GET /api/cap/:alertId`.

## Demo mode

`?demo=1` makes the page use `ui/js/demo.js`, an in-memory fake of all of the above (same shapes), so the UI can be built and checked without the engine.
