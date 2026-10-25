# Similar projects for Beacon (research, 2026-10-25)

Stars and licences from GitHub (`gh`), checked today. "Other" means GitHub could not classify the licence; check the LICENSE file before reusing any code.

## Most relevant projects

| # | Project | Link | What it does | Stars / licence | Idea Beacon can borrow |
|---|---|---|---|---|---|
| 1 | bitchat | github.com/permissionlesstech/bitchat | BLE mesh chat, multi-hop relay (up to 7 hops), Noise encryption, store-and-forward, triple-tap emergency wipe | 36,823 / Unlicense | Multi-hop relay, panic wipe, no-account design |
| 2 | bitchat-android | github.com/permissionlesstech/bitchat-android | Android port of bitchat | 7,881 / GPLv3 | Reference for Android BLE mesh; idea only |
| 3 | Meshtastic firmware | github.com/meshtastic/firmware | LoRa off-grid mesh; text, location, telemetry | 8,474 / GPLv3 | Node health and telemetry screen; optional LoRa bridge idea |
| 4 | Meshtastic-Android | github.com/meshtastic/Meshtastic-Android | Android client: node list, channels, map | 1,885 / GPLv3 | Channel concept, node-status UI |
| 5 | Briar | github.com/briar/briar | Encrypted P2P messenger over Bluetooth, Wi-Fi and Tor, no server | 710 / "Other" (verify) | Serverless sync; QR-based contact verification |
| 6 | Ushahidi platform | github.com/ushahidi/platform | Crowdsourced crisis reports via SMS, email, web; map; moderation | 732 / "Other" (verify) | Multi-channel intake and moderation queue for citizen reports |
| 7 | Sahana Eden (legacy) | github.com/sahana/eden-legacy | Humanitarian platform: shelters, missing persons, relief | 409 / "Other" (verify) | Field set for family reunification and shelter registry |
| 8 | SahanaEden (fork) | github.com/luisibanez/SahanaEden | Emergency cycle: mitigate, prepare, respond, recover | 29 / MIT | Organise drills and guides by phase |
| 9 | OmniMesh (lablab.ai, Pilani Crusaders) | lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii/pilani-crusaders/omnimesh-the-phone-that-calls-for-help-itself | On-device AI detects collapse or stillness, then sends an SOS over a BLE mesh with store-and-forward | Hackathon, no stars | Auto-SOS from accelerometer fall or stillness detection |
| 10 | ARCNET, Smart India Hackathon 2025 winner | news.vidyaacademy.ac.in/?p=76352 | Offline Bluetooth mesh disaster communication; first prize | News item, not a repo | Validates the Indian government hackathon track for this idea |
| 11 | AI-Disaster-Alert-Navi | github.com/imshota1009/AI-Disaster-Alert-Navi | Earthquake info, evacuation sites, news, checklists | 3 / none | Evacuation-site map layer |
| 12 | offline-first-aid-app | github.com/Naty4wof/offline-first-aid-app | Offline first-aid advisor with NLP and offline map | 0 / none | Closest competitor to Beacon's guide; compare features |
| 13 | dharura-ai | github.com/gabrielmahia/dharura-ai | Kenya NDMA-style alerts, Red Cross contacts, evacuation guides | 0 / none | Local emergency-contacts directory |
| 14 | floodwatch-kenya | github.com/gabrielmahia/floodwatch-kenya | Flood risk monitoring with NDMA alerts and satellite data | 1 / none | County-level risk view on top of NDMA feed |

## Features many of these have that Beacon may lack

Checked against the Beacon description only. Confirm in the code before acting.

1. Multi-hop relay with store-and-forward and delivery acknowledgements (bitchat, Meshtastic).
2. Panic or emergency wipe (bitchat).
3. Fall or stillness auto-SOS from sensors (OmniMesh).
4. SMS fallback for reports and alerts (Ushahidi).
5. Shelter and evacuation-site map layer (Sahana, AI-Disaster-Alert-Navi).
6. Local emergency-contacts directory (dharura-ai).
7. Mesh node health and telemetry view (Meshtastic).
8. Ingest of standard alert feeds (CAP) beyond the NDMA and USGS sources.

## Top 5 suggestions, ranked by value

1. **Auto-SOS from the accelerometer.** Detect a fall or prolonged stillness and start the SOS countdown, with cancel. This is high value for a disaster app and low cost, since Beacon already has SOS and the BLE mesh.
2. **Confirm multi-hop relay, store-and-forward and delivery receipts.** If they are missing, bitchat's design (Unlicense) is a good reference to study. Write your own code and do not copy it without checking the licence.
3. **Add an SMS fallback and a shelter map.** SMS covers phones without data. Shelter and evacuation sites are the most-requested field data in this category. Sahana's shelter and missing-person fields are a good model for the family reunification data.
4. **Panic wipe and mesh health screen.** A triple-tap wipe protects users in danger. A Meshtastic-style node list with battery, hop count and last-seen time helps users trust the mesh.
5. **Organise drills and guides by the disaster cycle (prepare, respond, recover).** This is a cheap content and UX change, taken from Sahana's model.

## Licence notes

- Safe to study and adapt the idea: all projects above.
- Do not copy code from GPLv3 projects (bitchat-android, Meshtastic) into Beacon unless you plan to release Beacon under GPLv3.
- Briar, Ushahidi and Sahana show "Other" on GitHub. Read their LICENSE files before any reuse.
- bitchat is Unlicense (public domain), so it is the most permissive source here.

## Coverage limits

- `gh search` returned mostly tiny repos (0 to 3 stars) for the offline-SOS and mesh queries. Winner pages on Devpost, Devfolio, Hackster, Product Hunt and F-Droid were not browsed; the search results pointed to hackathon news instead.
- The Google Solution Challenge search found no confirmed offline disaster winner.
