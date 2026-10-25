# Research: new similar projects from GitHub and F-Droid

Seen 2026-10-25. Excludes projects already in `similar-projects.md` (bitchat, Meshtastic, OmniMesh, Ushahidi, Sahana, offline-first-aid-app, ARCNET).

Licence notes: "none" means GitHub reported no licence. "Other" or NOASSERTION means a non-standard or unparsed licence. GPL, AGPL and non-commercial terms are marked **ideas only**. Stars and licence come from `gh` output. "Updated" is GitHub `updatedAt` from search unless marked as API `pushed`.

## Projects (25)

| # | Project | Link | Stars | Licence | Updated | What it is | What Beacon could learn |
|---|---|---|---|---|---|---|---|
| 1 | crisis-mesh-messenger (FundacjaHospicjum) | https://github.com/FundacjaHospicjum/crisis-mesh-messenger | 199 | Other (NOASSERTION) | 2026-10-14 (API pushed 2025-10-12) | Infrastructure-free device-to-device mesh messaging for crisis comms | Closest direct peer to Beacon's BLE mesh. Compare message UX and offline delivery. Licence unclear, so **ideas only**. |
| 2 | flare-gun (igatha) | https://github.com/igatha/flare-gun | 343 | MIT | search truncated (API pushed 2025-05-02) | Offline SOS "digital flare-gun" for war and disaster, iOS and Android | SOS as a simple, low-power, repeated broadcast signal. MIT, so code is reusable. |
| 3 | DisasterNet (AbhinavXJ) | https://github.com/AbhinavXJ/DisasterNet | 101 | none | 2026-10-15 | Emergency communication that works without internet | Second offline-comms reference for mesh routing and fallback. **Ideas only**. |
| 4 | allReady (HTBox) | https://github.com/HTBox/allReady | 887 | MIT | 2026-10-16 | Preparedness campaign platform for humanitarian groups | Campaign and drill scheduling for Beacon's drills feature. |
| 5 | Resgrid Core | https://github.com/Resgrid/Core | 233 | Apache-2.0 | 2026-10-24 | Open CAD, shift, personnel and AVL platform for emergency services | Responder-side roster and unit-status model for the Hub. |
| 6 | eol-dr (potatoqualitee) | https://github.com/potatoqualitee/eol-dr | 4864 | none | 2026-10-25 | Crowd-sourced guide for family handover when the tech-savvy member is gone | Family handover sheet, aligned with reunification and emergency info. **Ideas only** (no licence). |
| 7 | SLM-medical (ahmadjawad533) | https://github.com/ahmadjawad533/SLM-medical | 11 | none | 2026-10-24 | Flutter offline first-aid: quantized on-device LLM, local RAG, voice, rule-based triage, Android and Raspberry Pi | Nearest to Beacon's offline first-aid design. Rules first, then RAG fallback. Pi as a hub node. Check overlap with offline-first-aid-app. **Ideas only**. |
| 8 | Offline-First-Emergency-Coordination-System (Anbu-00001) | https://github.com/Anbu-00001/Offline-First-Emergency-Coordination-System | 4 | GPL-3.0 | API pushed 2026-04-02 | P2P mesh, offline geospatial routing, on-device ML triage | Same combination as Beacon (mesh plus triage). **Ideas only** (GPL). |
| 9 | AzSoS (TheGreatAzizi) | https://github.com/TheGreatAzizi/AzSoS | 5 | MIT | 2026-10-01 | Offline-first emergency content cache and package format | Signed content-bundle format for syncing guides over BLE or USB. |
| 10 | offline-survival-manual (designproart) | https://github.com/designproart/offline-survival-manual | 25 | none | 2026-10-13 | Offline preparedness and tactical first-aid manual, zero dependencies | Static offline guide content for comparison. **Ideas only**. |
| 11 | AI-Disaster-Alert-Navi (imshota1009) | https://github.com/imshota1009/AI-Disaster-Alert-Navi | 3 | Apache-2.0 | 2026-07-04 | One-stop prep app: quake info, evacuation sites, news, checklists, 4 languages | Very close feature overlap. Compare how it structures multilingual strings. |
| 12 | SOS-alerter (dhilipmpms) | https://github.com/dhilipmpms/SOS-alerter | 34 | GPL-3.0 | 2026-09-09 | Privacy-first SOS messages and live location to trusted contacts | Trusted-contact live location flow. **Ideas only** (GPL). |
| 13 | HelpID-Android (akyourowngames) | https://github.com/akyourowngames/HelpID-Android | 1 | MIT | 2026-09-17 | QR and NFC emergency medical profile for responders | Offline medical ID card on Beacon's medical screen. Tiny repo, but the idea is notable. |
| 14 | catch-app (jaghathsarveshs) | https://github.com/jaghathsarveshs/catch-app | 1 | MIT | 2026-10-01 | Offline, voice-guided maternal emergency companion in regional languages, one-tap SOS | Voice-first offline guidance in regional languages (Hindi and others). |
| 15 | FirstSight (safishamsi) | https://github.com/safishamsi/FirstSight | 31 | Other | 2026-10-14 | First-aid guidance with clinical GraphRAG grounded in JRCALC 2022 | Grounding first-aid answers in a cited guideline graph. **Ideas only** (licence unclear). |
| 16 | Flood-Rainfall-Disaster-Prediction-Website (Sparxxz) | https://github.com/Sparxxz/Flood-Rainfall-Disaster-Prediction-Website | 61 | MIT | 2026-09-14 | Advance flood warning from rainfall analysis | Rainfall-threshold alert logic for early warnings. |
| 17 | Hyperlocal flash flood risk-response (ABDULMUNAFZ) | https://github.com/ABDULMUNAFZ/Hyperlocal-Intelligence-for-Flash-Flood-Prediction-Risk--Response | 20 | Apache-2.0 | 2026-10-17 | SIH 2026 flash-flood risk response for hilly regions, IoT data | Hyperlocal risk-to-response flow for the early-warning screen. |
| 18 | ghadi (uditmahato) | https://github.com/uditmahato/ghadi | 0 | MIT | 2026-10-01 | Seismic detection of flood surges, emits a CAP alert | Shows a CAP output format for alerts. |
| 19 | weather-mcp (weatherintouch) | https://github.com/weatherintouch/weather-mcp | 0 | MIT | 2026-07-26 | Weather and official CAP alerts from 7 countries as an MCP server, no key | Directly usable as a Hub MCP tool for CAP ingest. |
| 20 | cap-composer (wmo-raf) | https://github.com/wmo-raf/cap-composer | 15 | MIT | 2026-10-06 | Authoring tool for CAP v1.2 weather warnings | Standard-conformant alert export and ingest for the Hub. |
| 21 | GlobalQuake (xspanger3770) | https://github.com/xspanger3770/GlobalQuake | 409 | none | 2026-10-14 | Global quake monitoring with its own early-warning estimate | Station-based local detection concept. **Ideas only**. |
| 22 | EQMonitor (YumNumm) | https://github.com/YumNumm/EQMonitor | 254 | MIT | 2026-10-24 | Earthquake monitoring app | Quake feed and alert presentation. |
| 23 | Strażnik (cukierrro) | https://github.com/cukierrro/Straznik | 43 | Other | 2026-10-25 | Unofficial early-warning fusion of government feeds, media and ADS-B, with Android app | Multi-source fusion with each source labelled. **Ideas only** (licence unclear). |
| 24 | apoyo-venezuela (javierdejesusda) | https://github.com/javierdejesusda/apoyo-venezuela | 1 | MIT | 2026-09-21 | Mobile-first PWA for quake relief: zones, needs, structural status, verified numbers | Citizen structural-status report type for AI-verified reports. |
| 25 | awesome-disastertech (DisasterTechCrew) | https://github.com/DisasterTechCrew/awesome-disastertech | 51 | none | 2026-10-18 | Curated list of disaster-tech projects (57 entries when fetched) | Reference list for the next research pass. Entries include Crisis CleanUp, disaster.radio, GDACS, InaSAFE, HazMapper and Google Person Finder. |

Not included: MapSwipe (171 stars, Other licence) and fAIr and ayudapy (AGPL-3.0) were seen but left out to keep the list to 25. Both fit the AI-verified reports idea and are **ideas only** if used.

## F-Droid

- F-Droid pages fetched: `?q=emergency`, `?q=mesh`, `?q=first+aid`. These were category browse views, not real search results. They show a sample of apps and no licences.
- Emergency-relevant apps seen: SOS Ring (VIP calls audible in silent mode), Nightblast (encrypted SMS alerts to contacts), FMD edge (remote device location), CPR Beat (CPR metronome), Read Me Offline (on-device read-aloud), Offline Translator (on-device translation and TTS), TyphoonEye (typhoon tracker), Message487 (forwards notifications to webhooks).
- Briar, Berty and Serval did not appear on the pages fetched. The F-Droid pages do not show licences, so none are reported here.

## Not covered (rate limit)

GitHub search quota hit 0 at about 17:43 UTC. These queries failed with HTTP 403 and were not run: `emergency mesh messaging lora`, `family reunification disaster`, `missing persons disaster app`, `citizen reporting disaster app`, `offline maps disaster android`, `on-device llm first aid`, `disaster drill app`. Re-run them after the search quota resets.

## Patterns and gaps

1. Offline mesh is thin. Only crisis-mesh-messenger, DisasterNet and a few stale BLE repos are close, and most lack a licence.
2. First-aid with an on-device LLM and rules is emerging (SLM-medical, FirstSight, llama-first-aid). Few cite guidelines.
3. Alert standards are in use. CAP appears in weather-mcp, cap-composer, ghadi and Straznik, so CAP ingest is a clear Hub feature.
4. Earthquake apps focus on feed and alert display. Few give per-location predicted intensity.
5. Family and medical ID is an open gap. HelpID (QR/NFC) and eol-dr (handover) are the only close examples.
6. Multilingual, offline voice is rare. catch-app and AI-Disaster-Alert-Navi are the closest.
7. Citizen damage reporting is common but mostly prototypes with 1 to 2 stars (rapida-crisis-mapping, apoyo-venezuela).
8. Verification of citizen reports is mostly crowd-tasking (MapSwipe) or AGPL platforms. Few use AI verification.
9. Licences are the main obstacle. Most mesh and first-aid repos have no licence or GPL, so they are ideas only.
10. F-Droid has few emergency apps in the pages fetched, so mesh and SOS ideas come mostly from GitHub.
