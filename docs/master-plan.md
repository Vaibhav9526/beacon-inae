# Beacon master plan: prepare, respond, recover

One app, one hub, three phases. The app decides which phase the person is in and reshapes itself; the Hub watches while they are not looking.

Ideas merged (implemented our own way; code only from permissive licences): bitchat (mesh, panic wipe), OmniMesh (fall SOS), Meshtastic (mesh health), flare-gun (SOS broadcast), HelpID (medical ID card), Google Person Finder (PFIF export), Sachet/CAP (alert format), weather-mcp (hub tools), SLM-medical and FirstSight (safety-gated first aid), Ushahidi/Sahana (reports, shelters, needs).

## Phases

| Phase | Trigger | What the app does |
|---|---|---|
| Prepare (calm) | no active alert near me | Readiness score, weekly missions, hazard profile for where I live, family plan, go-bag, drills, medical ID |
| Alert (real time) | official or detected hazard near me, or an SOS heard on the mesh | Emergency mode: hazard-specific do and don't, big SOS and I-am-safe, nearest shelter, torch/siren/strobe, fall SOS, mesh health, hub pushes |
| Recover (after) | alert cleared within the last 72 hours, or I marked myself safe after an alert | Check-in board for family, missing-person register (PFIF export), damage report, needs and offers board, recovery checklist (water, documents, insurance, wellbeing) |

The phase is computed, never asked: `src/state/phase.ts` is a pure function over (alerts, SOS heard, last alert end, my safe status, now). The user can override it from a small chip on Home.

## Work packages (each owns separate files)

1. Phase engine and dynamic Home (orchestrator): `src/state/phase.ts`, Home screens, phase chip.
2. Prepare: `src/services/readiness.ts`, `src/kb/hazards.ts`, `src/app/prepare.tsx`.
3. Respond tools: `src/app/tools.tsx` (torch, siren, strobe, whistle, flare message), `src/kb/dodont.ts`.
4. Recover: `src/services/pfif.ts`, `src/kb/recovery.ts`, `src/app/recover.tsx`.
5. Hub situation: `hub/engine/situation.ts`, `hub/engine/cap.ts`, API and UI chip.
6. In flight: fall SOS, mesh health, cancellable model download, panic wipe (done).

## Effectiveness measures

- Readiness score 0-100 from checkable items, shown with what to do next.
- Time to SOS: from tap or auto-trigger to first send, logged locally.
- Alert de-duplication and one clear action per alert.
- Drills timed, with a best time.
