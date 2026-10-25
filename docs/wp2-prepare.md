# WP2 Prepare (task for the OpenCode worker)

Read `docs/master-plan.md` and `beacon/AGENTS.md` first. The orchestrator reviews your diff and wires navigation; do NOT edit `src/app/_layout.tsx`, `src/app/adult/{index,more}.tsx`, `src/app/kid/index.tsx`, `src/components/{TabBar,Screen,ui}.tsx` or any file outside your list. No git, no commits. Checks: `cd beacon && npx tsc --noEmit && npm test`.

Design rules: Poppins, vivid tinted cards via `useTheme()` `p.tint.*` (black ink), black pill `Btn`, Deco stickers from `src/components/Deco.tsx`, `Screen`/`Card`/`Txt` from `src/components`, bold big headings, bento tiles radius 24-28, no emojis, calm 200ms ease-out motion (no springs). Hindi and English: use a small inline `{en, hi}` pair like `src/app/adult/more.tsx` does.

You own ONLY these files:
- `src/kb/hazards.ts` (new)
- `src/kb/__tests__/hazards.test.ts` (new)
- `src/services/readiness.ts` (new)
- `src/services/__tests__/readiness.test.ts` (new)
- `src/app/prepare.tsx` (new, route `/prepare`)

## 1. hazards.ts

Coarse, honest hazard exposure by Indian state or UT, and for about 30 major cities:
- seismic zone II to V (BIS IS 1893 zoning, state level, with city overrides: Delhi IV, Guwahati V, Mumbai III, Chennai III, Kolkata III, Bengaluru II, Hyderabad II, Kochi III)
- flood-prone (river or urban), cyclone coastal risk (east and west coast states), heatwave, landslide, drought, lightning
- each hazard has a level 0-3 and a one-line "what it means for you"

Exports:
- `hazardProfile(place)` where `place = { state?: string; city?: string; lat?: number; lon?: number }`. It returns hazards ranked by level, each with level and why. When state and city are unknown, fall back to the nearest city by lat/lon (haversine over the city list).
- `DISCLAIMER` constant: "Approximate, from public zoning maps. Check your local authority for exact risk."
- `hazardCalendar(month)` where `month` is 0-11. It returns the hazards in season in India that month (monsoon floods Jun-Sep, cyclones Apr-Jun and Oct-Dec, heatwave Mar-Jun, cold wave Dec-Feb, and so on).

Tests: Delhi seismic IV, Guwahati V, lat/lon fallback picks the right city, July includes floods.

## 2. readiness.ts

Pure function `readinessScore(input)` returning `{ score: 0-100, parts: [{ id, label, weight, done: boolean | number, hint }], next: [{ id, label, why }] }` with the top 3 next steps.

Inputs: `medicalIdFilled`, `emergencyContactsCount`, `goBagChecked` / `goBagTotal`, `drillsDone` / `drillsTotal` and best drill time, `familyMembersLinked`, `shelterKnown`, optional `waterDaysAtHome`, `hubPaired`, `hazardLevelMax` (a higher risk raises the weight of the matching preparation).

Tests: monotonicity, bounds, and that `next` suggests the heaviest missing item.

## 3. prepare.tsx

Screen titled "Prepare":
- Hero card with a big score ring (`react-native-svg`, animated with 200ms timing, no bounce) and "Your readiness".
- Three next-step cards (tinted, each with a Deco sticker and a button routing to: go-bag `/gobag`, drills `/drills`, medical ID `/medical`, family `/family`, map `/adult/map`, hub `/hub`).
- "Where you live": top hazards from `hazardProfile` using the saved location from `src/services/location.ts` if available, with level pips, the why line and the disclaimer in small muted text.
- "This month" strip from `hazardCalendar`.

Read inputs from existing stores and services (`src/state/settings.ts` for medical ID, contacts, go-bag items and drill progress). If a field does not exist, treat it as empty; do not add state. Show a skeleton while location resolves.

When finished, print a 4 line summary including the route name.
