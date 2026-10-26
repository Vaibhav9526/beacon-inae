# Task for the OpenCode worker: project documentation

You are a worker on the Beacon project in `C:\Users\VAIBHAV\Desktop\INAE`. An orchestrator reviews your work. Several other workers are editing code at the same moment, so you may ONLY create or edit the files listed here. Do not run git commands, do not commit, do not push, do not edit any source code, tests, workflows or config. Do not run builds or installs.

## Files you own

- `README.md` (repo root: rewrite it)
- `docs/architecture.md` (new)
- `docs/features.md` (new)
- `docs/getting-started.md` (new)
- `docs/faq.md` (new)

Read these first (they are the truth; do not invent features that are not in them or in the code):
`docs/master-plan.md`, `docs/hub-v2-plan.md`, `docs/hub-v2-api.md`, `docs/hub-ui-spec.md`, `docs/deploy-hosting.md`, `docs/releasing.md`, `docs/research-summary.md`, `docs/similar-projects.md`, the current `README.md`, `beacon/package.json`, `server/package.json`, `hub/package.json`, `render.yaml`, and the folder layout (`beacon/src/app`, `beacon/src/services`, `beacon/src/mesh`, `beacon/src/kb`, `hub/engine`, `hub/ui`, `server/src`). Open the code when a statement needs checking.

## What to write

1. **README.md** (concise, scannable, for a visitor on GitHub and for a hackathon judge): one-paragraph pitch ("offline-first disaster readiness for families in India: before, during and after"); what makes it different (5 bullets: works with no network over Bluetooth mesh, three phases Prepare/Alert/Recover that the app switches between by itself, family Hub of AI agents with an approval step, India-first (Hindi, NDMA/IMD), honest AI that answers from a curated offline library); a table of the parts (Phone app, Desktop Hub, Relay server); a feature list grouped by phase with the screen name for each; honest status section (what is built and tested in code, what has only been checked with synthetic data or not on real devices, known limits: free Render tier loses data, shake-warning thresholds untuned, medical text needs professional review, unsigned Windows installer); quick start for each part with exact commands taken from the package.json scripts; how updates work (GitHub Releases: phone APK tags `v*`, desktop `hub-v*`, rolling `hub-latest`); links to the docs. No screenshots. No emojis. No marketing superlatives that cannot be shown.
2. **docs/architecture.md**: the three parts and how they talk (phone app, mesh over BLE, hub engine and nodes -> agents -> gateway -> encrypted wire messages through the relay mailbox -> phones), data stores and what stays on the device, the relay's role (opaque blobs, alerts, reports, push), security model (approval gate, audit log, group key only in the pairing QR, Ed25519 signed requests, health data encrypted on the desktop), the phase engine, offline routing, on-device AI (Needle tool routing, guided photo triage, optional vision model), and a simple ASCII diagram for each of: overall system, hub pipeline, mesh message types.
3. **docs/features.md**: every user-visible feature with a 2-3 line description and its route/screen and where the code is (file paths), grouped Prepare / Alert / Recover / Family / Hub (desktop) / Tools / Settings and system. Mark each as `built`, `built, untested on device` or `partial` honestly using the master plan and what the code and tests show.
4. **docs/getting-started.md**: prerequisites (Node versions: Node 24 for the server, Node 22+ for tooling; JDK 17; Android SDK with NDK 30.0.14904198 and CMake 4.1.2; adb), clone, install and run each part (`beacon`: Metro/dev client and the local Android build commands used by the project, `hub`: `npm start`, `npm run desktop`, `npm run mcp`, `npm test`, `server`: `npm start` with the env vars from `server/.env.example`), connecting phone and hub (Settings > Server, Connections > Relay server, Family > Invite phone), deployment pointers, release pointers.
5. **docs/faq.md**: 15 to 20 short Q and A for users and judges: Does it work offline? What does the mesh need? Is my health data uploaded? Why does the photo check not look at my photo in guided mode? What can the voice commands do? How do I connect ElevenLabs and what permissions does the key need (Text to Speech and Speech to Text)? What happens if the Render server restarts? How do I add an elderly parent? How are updates installed? Why does Windows warn about the installer? What are the limits of the shake warning? Is this medical advice? Use only facts you can confirm in the docs and code; where a fact is unknown, say so.

Keep each document focused and plain. Hindi is not needed in these files. When you finish, print a 6-line summary of what you wrote and any statements you were not sure about.
