# WP7 Medical ID card with QR (task for the OpenCode worker)

Idea source: HelpID (QR/NFC medical profile) from `docs/research-github-fdroid.md`. Read `docs/master-plan.md` and `beacon/AGENTS.md` first. The orchestrator reviews your diff and wires navigation. Other workers are editing other files at the same time, so touch ONLY the files listed here. No git, no commits. Checks: `cd beacon && npx tsc --noEmit && npm test`.

Design rules: Poppins, vivid tinted cards via `useTheme()` `p.tint.*` (black ink), black pill `Btn`, Deco stickers from `src/components/Deco.tsx`, `Screen`/`Card`/`Txt` from `src/components`, bold big headings, radius 24, no emojis, calm 200ms ease-out motion (no springs). Hindi and English: small inline `{en, hi}` pairs like `src/app/adult/more.tsx`.

## Goal

A responder (or any stranger) can scan a QR code on the person's phone with their own phone camera, with no internet and no app, and read the medical essentials as plain text. Also a full-screen "Show to responder" card that is readable at arm's length.

## Files you own

- `src/services/medicalCard.ts` (new, pure, no react-native imports)
- `src/services/__tests__/medicalCard.test.ts` (new)
- `src/components/MedicalQr.tsx` (new)
- `src/app/medical.tsx` (existing screen: add the card entry points only; keep every existing field and behaviour)

## 1. medicalCard.ts

Read `src/app/medical.tsx` and `src/state/settings.ts` first to see what the Medical ID stores (name, blood group, allergies, conditions, medicines, emergency contacts, notes).

- `buildCardText(profile, lang)` returns compact plain text, at most about 450 characters so the QR stays scannable, in this order: name, blood group, allergies, conditions, medicines, emergency contacts with numbers, a final line "Call 112". Skip empty fields. Truncate long fields with an ellipsis, never drop allergies or blood group.
- `buildVCard(profile)` returns a vCard 3.0 string (FN, NOTE with medical text, TEL for each emergency contact with a TYPE label). Escape commas, semicolons and newlines per the vCard spec.
- `qrMatrix(text)` returns a boolean[][] using the `qrcode` npm package (`QRCode.create(text, { errorCorrectionLevel: 'M' })`, read `modules.data` and `modules.size`). Install it with `npm i qrcode` inside `beacon` (it is pure JavaScript; add `@types/qrcode` as a dev dependency). If the text does not fit, fall back to level 'L', then trim optional fields until it fits.
- Tests: all fields appear in order; empty fields skipped; length cap respected and allergies/blood group survive truncation; vCard escaping; `qrMatrix` returns a square matrix with the three finder patterns in the corners.

## 2. MedicalQr.tsx

`MedicalQr({ text, size })` renders the matrix with `react-native-svg` (one `Path` built from run-length rows for speed, white quiet zone of 4 modules, black modules on white regardless of theme so cameras read it).

## 3. medical.tsx

- Add a pink tinted card at the top, "Medical card", with a small QR preview and two pill buttons: "Show to responder" and "Share text" (React Native `Share.share`).
- "Show to responder" opens a full-screen modal: pure white background, giant bold name, blood group in a huge red pill, allergies and conditions in large type, the emergency contacts as big tappable `tel:` rows, the QR code at the bottom, and a "Close" pill. Raise screen brightness only if `expo-brightness` is already installed; otherwise skip that.
- If the profile is empty, show a friendly empty state with a Deco sticker and a "Fill in your details" hint instead of a blank QR.

When finished, print a 4 line summary including anything you could not verify.
