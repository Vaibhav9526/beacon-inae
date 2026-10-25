# Beacon

One community app for disasters: **before** (preparedness), **during** (response) and **after** (recovery).
It replaces the pile of separate apps people juggle in a crisis (alerts, maps, news, chat, first aid, family tracking) and
**keeps working with no internet**.

```
INAE/
  beacon/     the Android app (Expo SDK 58, React Native 0.88, TypeScript + two Kotlin modules)
  server/     optional cloud: signed alerts, live reports, votes, moderator console, family sync, push
  vendor/     downloaded model files and samples (not source, not shipped in git)
```

## What is in it

| Feature | Where | Offline? |
|---|---|---|
| Three modes: **Kid** (colourful, mascot, drills, games, hold-to-SOS), **Parent** (child live location, safe zones, check-ins), **Adult** (dashboard, map, community, news, first aid) | `beacon/src/app/{kid,parent,adult}` | yes |
| Hindi + English everywhere, large text, high contrast, screen-reader labels, haptics, read-aloud | `src/i18n`, `src/state/settings.ts` | yes |
| Voice control ("Hey Beacon, find the nearest shelter") on Android's on-device recogniser | `modules/beacon-ai/.../VoiceEngine.kt`, `src/services/voice*.ts` | yes, when the Hindi/English voice pack is installed |
| Personas **Didi** (kids), **Dr. Asha** (first aid), **Captain Veer** (rescue). Answers come only from a curated local knowledge base | `src/ai/persona.ts`, `src/kb/` | yes |
| **Bluetooth mesh chat** modelled on bitchat: multi-hop relay (TTL 7), store-and-forward, Noise XX encryption, geohash channels, SOS, "I am safe", gateway | `src/mesh/` + `modules/beacon-mesh` (Kotlin radio only) | yes |
| **Live-verified reports**: in-app camera only (no gallery), AI + moderator screening, community "real / fake" votes, ~60-word news cards | `src/app/report`, `server/src/{reports,moderation}.ts` | capture offline, upload later |
| **Offline first-aid + "jugaad" guide**: photo or voice, a tiny vision model describes it, **Needle** picks the right guide, steps are shown and read aloud | `src/ai`, `src/vision`, `modules/beacon-ai` | yes |
| **Early warnings**: USGS earthquakes, Open-Meteo weather and air quality, NDMA SACHET / IMD, push via FCM, re-broadcast over the mesh | `src/alerts`, `server/src/{alerts,fcm}.ts` | cached + mesh |
| Shake-to-SOS, medical ID, offline maps (OpenStreetMap, shelters/hospitals), resource board, family reunification, drills, go-bag | various | yes |

## How the pieces fit

```
phone A ──BLE──> phone B ──BLE──> phone C ──(internet)──> server ──> FCM push, moderators, families
   │  SOS / chat / alerts hop between phones (signed, deduplicated, TTL-limited)
   └─ any phone with internet is a gateway: uploads what the mesh heard, brings official alerts back
```

* **Protocol logic is TypeScript** (`beacon/src/mesh`): packet format, relay rules, Noise sessions, courier envelopes, gossip
  sync, fragmentation. It runs unchanged in Node, so the whole mesh is tested on a simulated network.
* **The only Bluetooth code is Kotlin** (`modules/beacon-mesh`): advertise, scan, connect, length-framed byte transport.
  A foreground service keeps it alive with the screen off.
* **Needle** (Cactus) runs natively through a small JNI bridge (`modules/beacon-ai`) against `libneedle.a` (arm64).
  It does what Needle is for: it picks *which tool* to call from text. The content shown is always from the curated KB,
  so nothing medical is ever generated.
* **Hermes cannot run WebAssembly**, so the Needle WASM build is not used. Needle's native Android engine is.
  On non-arm64 devices (emulators) the JNI layer builds as a stub and the app falls back to the keyword router.
* **SmolVLM-256M** (photo → text) runs through ONNX Runtime (`onnxruntime-react-native`). It is an optional one-time
  download of about 260 MB (Settings → Offline photo helper). Without it the photo button offers a picker of common
  situations instead.

## Run it

Prerequisites: Node 22+, JDK 17, Android SDK (+ NDK 30 and CMake 4.1.2 on Windows, see below).

```bash
# 1. the app
cd beacon
npm install                     # also applies patches/ via patch-package
npx expo prebuild --platform android
cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64
adb install -r app/build/outputs/apk/debug/app-debug.apk
cd .. && npx expo start         # then open the app (dev client) on the phone/emulator

# 2. the optional server
cd ../server
npm install
MOD_TOKEN=choose-a-secret npm start     # http://localhost:8787, moderator console at /mod
#   ANTHROPIC_API_KEY=...        turns on AI pre-screening of reports (otherwise all go to moderators)
#   FIREBASE_SERVICE_ACCOUNT=... turns on real FCM push (otherwise it logs)
# put the server URL in the app: Settings → Beacon server (the public key is fetched automatically)
```

### Tests

```bash
cd beacon && npm test           # mesh protocol, alerts, knowledge base, router, personas, maps, vision
cd server && npm test           # HTTP API end to end, auth, moderation decisions
npm run typecheck               # in both
```

The vision test needs the model files in `vendor/smolvlm` (`node scripts/fetch-models.mjs smolvlm` from `beacon/`); it skips itself when absent.

### Windows build notes (all handled by `beacon/plugins/withNdkVersion.js` and `patches/`)

* React Native 0.88 asks for NDK 27.1, but these libraries need C++20 and an NDK ≥ 27. The plugin pins an installed NDK (30).
* Native libraries create object paths over 260 characters. Windows long paths are on, but the default CMake 3.22 ships
  Ninja 1.10, which still fails. The plugin selects CMake 4.1.2 (Ninja 1.12).
* `onnxruntime-react-native` 1.24 uses a Gradle class removed in Gradle 9; `patches/` fixes it.

## What is verified, and what is not

Verified here (automated):
* Mesh protocol: relay to 7 hops and no further, dedup, fragmentation, Noise XX, replay and forgery rejection, sealed
  couriers for out-of-range recipients, gossip sync, restart persistence, trusted-gateway alert verification.
* Server API, signature auth, family zones, report lifecycle, votes, moderation decision logic (against a stubbed model).
* Knowledge base completeness (every guide bilingual, emergencies mention 112/101), Hindi and English matching.
* SmolVLM pipeline on a real photograph (Node); the Android app builds, installs and runs on an emulator, including
  onboarding in Hindi, kid and adult dashboards, SOS hold-to-send, tab navigation, and live NDMA alert fetching.

**Not verified, because it needs hardware or credentials I do not have:**
* Bluetooth radio between real phones (the emulator has no BLE). Run two phones side by side before relying on it.
* Needle inference (arm64 only): the engine links and loads in the build, but the model has not been run on a device.
* The real Claude moderation call (no API key here), FCM delivery (needs `google-services.json` + a service account).
* The on-device vision model through `onnxruntime-react-native` (the TypeScript pipeline is verified in Node; the native
  runtime path is not).
* Offline Hindi voice needs the Hindi language pack installed on the phone.

Known limits: no Play Integrity attestation of camera captures (a signed capture proof binds pixels, time and place to
the device key, but a rooted phone could still lie); Needle's speech model does not cover Hindi, so voice uses Android's
recogniser; maps are an OpenStreetMap vector area you download once, not a tile basemap; the mesh does not use LZ4
compression yet; gossip sync uses Golomb-coded filters but not bitchat's exact courier copy budgets.

## Beacon Hub (desktop)

Small agents on your computer that watch weather, air, quakes, official alerts and family health, and warn the family early.

```
cd hub
npm install
npm start          # engine + local UI; prints http://127.0.0.1:4747/?t=<token>
npm run mcp        # same tools over MCP stdio, for Claude Code / Codex / Gemini CLI
npm test
```

- Templates for disaster, help, medicine, child play and preparedness. Add a rule in plain words: "if heat index > 41 and Maa's heart rate > 110 alert me".
- Every message goes through an approval gate (first send per channel asks) and is written to `audit.jsonl`. Health data is encrypted on disk and only the short approved alert text ever leaves the computer.
- Telegram: paste a BotFather token, press "Get pairing code", send `/start <code>` in the family group.
- Phone: "Pair a phone" shows a QR; scan it in Beacon > Desktop hub. Alerts arrive through the Beacon server relay (`server/src/relay.ts`).
- Brain: none (built-in rules), an external CLI (`claude`, `codex`, `gemini`) or the Anthropic API (Haiku 5.5 rewrites wording; numbers it did not get are rejected).
- `BEACON_HUB_OFFLINE=1` uses built-in sample data. `BEACON_SERVER` points at the Beacon server (default http://127.0.0.1:8787).
