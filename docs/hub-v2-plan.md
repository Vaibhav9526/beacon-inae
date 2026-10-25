# Hub v2: nodes, agents, gateway, phones

The desktop Hub becomes an OpenBot/Jargon-style control room for disaster information. Phones are the outlets.

```
 sources / MCP tools
   (rss, http-json, weather, aqi, quake, cap, mcp-tool)
        |
   NODES  ->  AGENT (a genre: news, wind, flood, health, supply...)  ->  FeedItems
                                                                          |
                                                                      GATEWAY (routes: who gets what)
                                                                          |
                                      encrypted wire messages via the Beacon server mailbox
                                                                          |
                                         phones (members of the family group)  <->  group chat, ask, SOS
```

Shared types: `hub/engine/types.ts` (FeedItem, NodeSpec, Agent.pipeline, GatewayRoute, Member, GroupMessage, McpServerSpec, WireMessage). Do not change them without telling the orchestrator.

## Modules (each worker owns its files)

| Module | Files | Job |
|---|---|---|
| Nodes | `engine/nodes.ts`, `engine/rss.ts`, `engine/cap.ts` already exists (export CAP) + `engine/capParse.ts`, tests | run a pipeline: sources -> FeedItems, filters, dedupe, summarize hook |
| MCP | `engine/mcpClients.ts`, tests | add/remove external MCP servers (stdio/http), list tools, call a tool |
| Group | `engine/wire.ts`, `engine/members.ts`, `engine/gateway.ts`, extend `engine/beaconLink.ts`, tests | encryption, members and roles, routes, delivery, inbox polling |
| Integration | `engine/app.ts`, `engine/httpServer.ts`, `engine/hub.ts`, templates | orchestrator owns |
| UI | `hub/ui/*` | OpenBot-like interface |
| Phone | `beacon/src/services/{wire,hubFeed}.ts`, `beacon/src/app/hub.tsx`, Home feed | receive feed, notifications, group chat, ask the desktop |

## Wire format (hub <-> phone)

- A per-hub 32-byte group key `gk` is made on the desktop and travels only in the pairing QR (never through the server).
- A message is `JSON.stringify(WireMessage)` encrypted with ChaCha20-Poly1305 (`@noble/ciphers/chacha`): blob = base64( nonce(12) || ciphertext||tag ), key = `gk`, AAD = the string `beacon-hub-v1`. Max 8000 bytes of base64; `feed` messages are split into batches that fit.
- The Beacon server only ever sees opaque blobs, sender and recipient ids.
- Hub -> phone: `POST /v1/mail/send {to:'phone:<deviceId>', blob}`. Phone -> hub: `POST /v1/mail/send {to:'hub:<hubId>', blob}`. Both sides poll `GET /v1/mail/inbox?since=<ms>`; items have `kind` (`msg` for these) and `from` (`hub:<id>` or `phone:<deviceId>`).
- Shared test vector (both implementations must decrypt it): key = 32 bytes of 0x07, nonce = 12 bytes of 0x01, plaintext `{"t":"safe","name":"Maa"}`, AAD `beacon-hub-v1`. Each side's test computes the blob from these inputs and checks the other side's helper decrypts it (the orchestrator will cross-check the two blob strings are equal).
- Pairing QR payload (v2): `{v:2, hub, key (hub ed25519 pub b64), token, relay, gk (b64), invite?}`; `invite` ties the phone to a Member the adult created, so the phone gets that member's role.

## Members and the group

- The first member is the person who set up the hub (adult). Adults can add and remove members. Each member gets an invite (a QR with `invite`): an elder's QR is shown on the adult's phone or the desktop so the adult can set up a parent's phone.
- Roles: adult (manage everything), elder (gets simplified, larger alerts; cannot manage), child (kid mode). The role sets the default gateway routes (e.g. elders get only warning and above, in plain words).
- Group chat: any member's text goes to the hub, the hub stores the last 200 messages and fans each out to every member's phone. SOS and safe messages appear in the chat with a kind.

## Gateway routes

Default routes (editable): `Everything urgent -> all phones, notify` (severity >= warning), `News -> all phones, no notification`, `Health -> adults only`. A route matches by kinds, agents, tags, minSeverity and sends to roles, members, or Telegram.

## Phone side

- Home "Alerts and news" shows hub FeedItems merged with the existing sources.
- Notifications for items at or above the route's `notifyFrom`.
- `/hub` screen tabs: Feed, Family (members, group chat, add member with role and invite QR for adults), Ask desktop (send a prompt to the desktop's agents/brains, show the answer), Connection.
- The desktop shows approval for `ask` unless the member is an adult with "allow asks" on.

## Safety

- The desktop never runs shell commands from a phone. `ask` only sends text to the configured brain CLI (`claude -p`, `codex exec`, `gemini -p`) or the API, after approval.
- Health data stays on the desktop. Feed items carry only short approved text.
- MCP servers are started only from the desktop UI by the person at the desktop.
