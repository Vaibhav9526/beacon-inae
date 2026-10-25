# Similar projects: Devpost, Devfolio and other hackathon galleries

Research date: 2026-10-25. Read-only. Sources were search snippets, plus WebFetch where the page loaded.

Access notes:
- All devpost.com/software/* pages tested (meshnet, suar, everaid, vitalcue, project-zufpg9vhn1y2) returned HTTP 403 to WebFetch. Those rows use search-snippet detail only.
- devfolio.co/projects/resq-fc4a loaded. The devfolio.co/projects index loaded but had no disaster projects.
- lablab.ai pages loaded. Hackathon prize and year are not all shown.
- Unstop and HackerEarth were not reachable by search. Nothing from them is listed.

## Projects

| # | Project | URL | Hackathon / year / prize | One-line summary | Tech stack | What is novel | What Beacon could learn |
|---|---|---|---|---|---|---|---|
| 1 | MeshNet | https://devpost.com/software/meshnet | Not shown (403) | BLE peer-to-peer messaging and map-based event sharing, up to 7 hops (about 700 m), motivated by the Iran internet blackout | BLE (stack not confirmed) | Multi-hop BLE mesh with shared map events | Hop-limited relay and map event sharing over mesh |
| 2 | SUAR | https://devpost.com/software/suar | Not shown (403) | Offline post-disaster rescue tracking. Broadcasts presence and GPS over BLE, no servers or accounts | React Native, TypeScript | Radar screen, assembly-point beacons, voice and haptic alerts for blind and Deaf users | Accessibility alerts and assembly-point beacons |
| 3 | EverAid | https://devpost.com/software/everaid | Not shown (403) | Offline-capable emergency toolkit with 80+ preloaded packs in 4 categories | Together AI for custom scenarios, local fallback for critical content | Pre-packaged offline content with an AI layer that is optional | Packaged offline content packs with a clear fallback |
| 4 | VitalCue | https://devpost.com/software/vitalcue | Not shown (403) | Flutter first-aid prototype. Core works with no AI, no account, no network | Flutter, optional Gemini or on-device Gemma | Escalates high-risk input to emergency calling before any AI reply, and labels AI output as unreviewed | Safety gate before the model answers; label AI output clearly |
| 5 | FirstAid AI | https://devpost.com/software/firstaid-4p2ljh | Not shown (403) | Web app that guides bystanders through choking and bleeding scenarios | Web (stack not confirmed) | Avoids diagnosis and dispatch claims | Scope limits in wording and disclaimers |
| 6 | ResQ App (team ReXa) | https://devfolio.co/projects/resq-fc4a | Magnathon 2.0, 2024 (prize not listed) | Disaster app for India, especially Kerala. Live color-coded alert map, resource listings, SOS with survival-time priority, 3D/VR safety tutorials | Firebase, Python, Android (Java/Kotlin) | SOS prioritized by estimated survival time; resource listings on the same map as evacuation routes | Urgency-ranked SOS queue; resource listings on the map |
| 7 | Family-finder disaster app (team on Devpost) | https://devpost.com/software/project-zufpg9vhn1y2 | Not shown (403) | Family search: look up a relative's recent location, and match photos with an image-similarity API | Flutter, Dialogflow, Firebase, OpenCV | Photo matching for family reunion; built in 36 hours | Family-search feature for Beacon's reunification flow |
| 8 | PREP | Link from CUNY eportfolio: https://openlab.citytech.cuny.edu/enkanta-eportfolio/prep | ByteHacks 2018, Best Hack (Food/Water/Shelter) | Cross-platform family disaster preparedness app. Weather alerts, supply kits, family contact | Not confirmed | Family preparedness checklist with contact tracking | Family plan and supply checklist |
| 9 | Mission Control: Earthquake Response | https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/shikigamis/mission-control-earthquake-response | AMD Developer Hackathon ACT II, 2026 (no prize shown) | Five AI agents read live USGS, OpenStreetMap and OpenWeatherMap data, then a commander agent builds a mission plan | AMD MI300X, Gemma 4, OpenRouter, Gemini, WebSocket, Vercel | Agents debate and synthesize; citation scoring checks each claim against the live data it cites | Grounding check on agent output; agent roles per disaster task |
| 10 | RescueEye Global | https://lablab.ai/ai-hackathons/internet-of-agents/ai-building/rescueeye-global | Internet of Agents Hackathon (Solana Skyline); submitted Sept 2025 | Geotagged incident pins on a live map, color-coded by type and severity. Live feeds from GDACS, USGS, ReliefWeb, OpenWeatherMap | React, Leaflet, Node/Express, OpenAI or Hugging Face | Combines official feeds with user reports on one severity map | Merge official feeds with citizen reports; severity-coded pins |
| 11 | KHABAR | Devpost profile pages only (exact project URL not captured) | Not shown | Citizens report emergencies by text, photo or voice. AI verifies incidents, prioritizes and dispatches | Not confirmed | AI verification of citizen reports | Verification and triage of citizen reports (Beacon's AI-verified reports) |
| 12 | CoastWatch | Not on Devpost. Source not captured | SIH 2026 (per student-team description) | Crowdsourced disaster sensing with AI-assisted verification, combined with official data | Not confirmed | Citizens as ground sensors | Same idea as Beacon's citizen reports |
| 13 | CrewOK | Source URL not captured | Claude Impact Labs deprem hackathon, Turkey | Bluetooth mesh messaging, hop-by-hop relay, no accounts or servers | Not confirmed | Bitchat-style mesh for an earthquake | Mesh messaging UX close to Beacon's BLE chat |
| 14 | DisasterHelpNet | https://www.scribd.com/presentation/858814902/DISASTERHELPNET-1-hackathon | Student hackathon (name and year not confirmed) | Offline SOS with Bluetooth and Wi-Fi Direct. Volunteers get distress calls and navigate to victims | Bluetooth, Wi-Fi Direct | Volunteer navigation to SOS senders | Responder-side navigation to SOS |
| 15 | ARCNET | https://news.vidyaacademy.ac.in/?p=76352 | Smart India Hackathon, First Prize (year not in snippet) | BLE multi-hop mesh app with an admin dashboard and SMS fallback | Jetpack Compose, foreground service | SMS fallback alongside the mesh | SMS fallback when mesh is idle |
| 16 | MeshWave | https://fossunited.org/hack/fosshack26/p/al2ifqgadc | FOSS Hack 2026 | Android chat relayed over BLE and Wi-Fi Direct with gossip routing | Android, BLE, Wi-Fi Direct | Gossip routing | Gossip routing for Beacon's mesh |
| 17 | BITWISE (SIH 2025) | https://ingenium.aot.edu.in/api/projects/2025/sih25008-bitwise/pdf | SIH 2025 (prize not shown) | Disaster-preparedness education app with gamified drills for earthquake, flood and fire | Not confirmed. Data from NDMA Sachet and INCOIS | Gamified drills for schools | Drill and learning modules; NDMA and INCOIS data feeds |
| 18 | Sahayog | https://anshul.is-a.dev/projects/sahayog/ | SIH 2024 finalist (per personal site) | Live incident maps with automated alerts. Status: in progress | Not confirmed | Incident map with auto alerts | Auto alerts from incident maps |
| 19 | Vinculum | https://computerscience.uchicago.edu/news/uchicago-cs-graduate-student-takes-prize-at-first-ever-vatican-city-hackath/ | First Vatican City hackathon (year not shown) | Missing-person matching through SMS, Messenger or web, with face recognition | ML, chatbot | SMS entry point for camps with no smartphones | SMS entry for family search |
| 20 | Nostradamus | https://github.com/MegaDevs/Nostradamus | Not shown | Phones in emergency mode broadcast position over BLE. Rescuer app detects them | Not confirmed | Also sends location to civil-defense servers | Negative example: sending location to central servers raises privacy issues |

Sources for rows 8 and 19 are search results: the CUNY eportfolio page (row 8) and the UChicago CS news item on the Vatican City hackathon (row 19: https://computerscience.uchicago.edu/news/uchicago-cs-graduate-student-takes-prize-at-first-ever-vatican-city-hackath/).

Not included: QuickAid (named in a search summary, but no URL was returned), Apada Sahayak (news item, not a hackathon), Crisis Connect (commercial, not a hackathon), Peerlist "1taphelp" (claims SIH 2020, not verified).

## Patterns and gaps

1. Offline BLE mesh SOS is common (MeshNet, SUAR, DisasterHelpNet, ARCNET, CrewOK, MeshWave). Beacon's mesh is not unusual, so the differentiator has to be the disaster workflow on top.
2. Many entries stop at "works offline" with no account or server. Few show how the mesh handles conflicting SOS or I-am-safe states.
3. Accessibility appears in only one entry (SUAR's voice and haptic alerts). Beacon's Hindi and English kid, parent and adult modes are a gap others have not filled.
4. AI first-aid entries (VitalCue, EverAid, FirstAid AI) show a safety-first pattern: escalate before the model answers, and label AI output clearly.
5. Citizen-report verification with AI (KHABAR, CoastWatch) is an active theme, which Beacon's AI-verified reports match.
6. Agent-based disaster coordination (Mission Control, RescueEye) uses USGS, GDACS and OpenWeatherMap feeds. Few of these reach offline phones; Beacon's hub-and-phone split is a gap.
7. Family reunification appears as photo matching (project 7, Vinculum) or SMS entry. Few projects handle reunification offline across a mesh.
8. India-specific data (NDMA Sachet, INCOIS, IMD) appears in SIH entries (BITWISE, ARCNET). Beacon's NDMA/IMD feeds fit this pattern.
9. Much of the material is from SIH and student hackathons, with thin verification of prizes or years. Confirm details before citing them.
10. No entry combines an offline mesh, a first-aid guide with on-device models, citizen reports and a desktop agent hub. This is the main gap to point to.
