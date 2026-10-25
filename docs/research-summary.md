# Similar projects: summary and what to do about it

Sources (details and links in each file):
- `similar-projects.md` (first pass, GitHub)
- `research-devpost-devfolio.md` (20 hackathon projects)
- `research-github-fdroid.md` (25 repos)
- `research-launches-india.md` (18 apps and launches, official Indian apps)

Coverage limits: Devpost project pages returned HTTP 403, so those rows come from search snippets. GitHub search hit its rate limit during the second pass, so seven queries (LoRa mesh, family reunification, drill apps and others) need re-running. Hackathon prizes and years are unconfirmed for most rows. Hackathon "winner" claims are self-reported.

## Where Beacon stands

No project seen combines all four of: an offline Bluetooth mesh with SOS, an on-device first-aid guide, AI-verified citizen reports, and a desktop agent hub with personas. Each piece has peers; the combination does not.

Closest peers by piece:
- Mesh and SOS: bitchat (Unlicense, 36.8k stars), Meshtastic (GPLv3, ideas only), OmniMesh, crisis-mesh-messenger, flare-gun (MIT), Crisis Connect, ARCNET and MeshNet (hackathons).
- Offline first aid: offline-first-aid-app, SLM-medical, FirstSight, VitalCue and EverAid (hackathons, with a safety gate on AI answers).
- Citizen reports with AI checks: KHABAR and CoastWatch (hackathons), Ushahidi and Sahana (licence needs checking).
- Official alert sources: NDMA Sachet, IMD Mausam and Damini, Google Android Earthquake Alerts. These are one-way; Beacon's offline two-way SOS is the difference.

## Ranked ideas for Beacon

1. Fall and stillness SOS (OmniMesh idea). In progress: fall detection with a 30 second "Are you okay?" prompt.
2. Panic wipe (bitchat idea). Done: Privacy screen with a two-step erase.
3. Mesh health screen (Meshtastic idea): peers, relays, queue. In progress.
4. Medical ID as a QR code or NFC card for responders (HelpID-Android idea). Medical ID screen exists; a QR export is the gap.
5. CAP-style alert fields and ingestion of Sachet and IMD warnings. Partly done (NDMA and IMD sources); align fields to CAP.
6. Missing-person export in the PFIF format (Google Person Finder). New.
7. Shelter map and local contacts directory. The map has shelters; a contacts directory is new.
8. SMS fallback when a phone has signal but no data. New, needs a gateway decision.
9. weather-mcp (MIT) as a ready MCP tool for the Hub, instead of our own wrapper.

## Licence notes

Use as ideas only (GPL, AGPL, non-commercial or no licence): Meshtastic, SOS-alerter, Anbu-00001, ayudapy, fAIr, and any repo with no licence. Reusable code with permissive licences: bitchat (Unlicense), flare-gun (MIT), weather-mcp (MIT), cap-composer (MIT), HelpID-Android (MIT).
