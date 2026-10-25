// Medical ID card text, vCard and QR matrix. Pure TypeScript: no react-native imports, so it runs in tests and in Node.
//
// The QR holds a short plain-text summary that any phone camera can read offline, with no app installed.
// The vCard is for the share sheet (contacts apps) and keeps the same facts plus the notes field.

import * as QRCode from 'qrcode';
import type { Lang } from '../kb/types';
import type { EmergencyContact, MedicalId } from '../state/settings';

export interface MedicalCardProfile extends MedicalId {
  contacts: EmergencyContact[];
}

/** Length cap for the QR text. Kept small so the symbol stays easy to scan at arm's length. */
export const MAX_CARD_LENGTH = 450;

type FieldKey = 'name' | 'bloodGroup' | 'allergies' | 'conditions' | 'medicines' | 'notes' | 'contacts';

const LABELS: Record<Lang, Record<FieldKey | 'call', string>> = {
  en: {
    name: 'Name',
    bloodGroup: 'Blood group',
    allergies: 'Allergies',
    conditions: 'Conditions',
    medicines: 'Medicines',
    notes: 'Notes',
    contacts: 'Emergency contacts',
    call: 'Call 112',
  },
  hi: {
    name: 'नाम',
    bloodGroup: 'रक्त समूह',
    allergies: 'एलर्जी',
    conditions: 'बीमारियाँ',
    medicines: 'दवाइयाँ',
    notes: 'टिप्पणी',
    contacts: 'आपातकालीन संपर्क',
    call: '112 पर कॉल करें',
  },
};

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const contactsValue = (contacts: EmergencyContact[]) =>
  contacts
    .map((c) => ({ name: clean(c.name), phone: clean(c.phone) }))
    .filter((c) => c.phone.length > 0)
    .map((c) => (c.name ? `${c.name} ${c.phone}` : c.phone))
    .join(', ');

interface Line {
  key: FieldKey;
  label: string;
  value: string;
  required: boolean;
}

/** Ordered field lines. Empty fields are skipped so the QR never carries blank labels. */
function fieldLines(profile: MedicalCardProfile, lang: Lang, includeNotes: boolean): Line[] {
  const L = LABELS[lang] ?? LABELS.en;
  const raw: { key: FieldKey; value: string; required: boolean }[] = [
    { key: 'name', value: clean(profile.fullName), required: false },
    { key: 'bloodGroup', value: clean(profile.bloodGroup), required: true },
    { key: 'allergies', value: clean(profile.allergies), required: true },
    { key: 'conditions', value: clean(profile.conditions), required: false },
    { key: 'medicines', value: clean(profile.medicines), required: false },
  ];
  if (includeNotes) raw.push({ key: 'notes', value: clean(profile.notes), required: false });
  raw.push({ key: 'contacts', value: contactsValue(profile.contacts), required: false });
  return raw.filter((r) => r.value.length > 0).map((r) => ({ ...r, label: L[r.key] }));
}

const clip = (value: string, max: number): string => {
  if (value.length <= max) return value;
  if (max <= 1) return '…';
  return `${value.slice(0, max - 1).trimEnd()}…`;
};

const MIN_VALUE = 2;

/** Draws the lines down to the cap by trimming the longest optional value first, then the required ones. */
function fitLines(lines: Line[], call: string): string {
  const values = lines.map((l) => l.value);
  const render = () => {
    const body = lines.map((l, i) => `${l.label}: ${values[i]}`).join('\n');
    return body ? `${body}\n${call}` : call;
  };

  let guard = 0;
  while (render().length > MAX_CARD_LENGTH && guard++ < 2000) {
    const excess = render().length - MAX_CARD_LENGTH;
    let index = -1;
    for (let pass = 0; pass < 2 && index < 0; pass++) {
      for (let i = 0; i < lines.length; i++) {
        const optional = !lines[i].required;
        if (pass === 0 && !optional) continue;
        if (values[i].length <= MIN_VALUE) continue;
        if (index < 0 || values[i].length > values[index].length) index = i;
      }
    }
    if (index < 0) break;
    const cut = Math.max(1, Math.min(excess, values[index].length - MIN_VALUE));
    values[index] = clip(values[index], values[index].length - cut);
  }
  return render();
}

/**
 * Compact plain text for the QR, in the order a responder needs it:
 * name, blood group, allergies, conditions, medicines, contacts, then "Call 112".
 * Long fields end in an ellipsis; allergies and blood group are always kept.
 */
export function buildCardText(profile: MedicalCardProfile, lang: Lang): string {
  return fitLines(fieldLines(profile, lang, false), LABELS[lang]?.call ?? LABELS.en.call);
}

const escapeVCard = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

/** vCard 3.0 for the share sheet: FN, NOTE with the medical text, and one TEL per emergency contact. */
export function buildVCard(profile: MedicalCardProfile): string {
  const name = clean(profile.fullName) || 'Medical ID';
  const noteLines = fieldLines(profile, 'en', true).map((l) => `${l.label}: ${l.value}`);
  const note = [...noteLines, LABELS.en.call].join('\n');

  const out = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard(name)}`,
    `N:${escapeVCard(name)};;;;`,
    `NOTE:${escapeVCard(note)}`,
  ];
  for (const contact of profile.contacts) {
    const phone = clean(contact.phone);
    if (phone) out.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`);
  }
  out.push('END:VCARD');
  return `${out.join('\r\n')}\r\n`;
}

const toMatrix = (modules: { size: number; data: Uint8Array }): boolean[][] => {
  const matrix: boolean[][] = [];
  for (let y = 0; y < modules.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < modules.size; x++) row.push(modules.data[y * modules.size + x] === 1);
    matrix.push(row);
  }
  return matrix;
};

/** Last resort if even level L overflows: drop or shorten the last content line, but keep the call line. */
function fitText(text: string): string {
  const lines = text.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const tail = /112/.test(last) ? lines.pop() ?? '' : '';
  const body = lines;
  const build = () => (tail ? [...body, tail].join('\n') : body.join('\n'));
  let guard = 0;
  while (body.length > 0 && guard++ < 500) {
    const candidate = build();
    try {
      QRCode.create(candidate, { errorCorrectionLevel: 'L' });
      return candidate;
    } catch {
      const line = body[body.length - 1];
      if (line.length > 8) body[body.length - 1] = `${line.slice(0, Math.floor(line.length * 0.8)).trimEnd()}…`;
      else body.pop();
    }
  }
  return tail || text.slice(0, 64);
}

/**
 * Boolean QR modules from the `qrcode` package. Level M first (good damage tolerance), then L, then a trimmed
 * copy if the text is too large for any symbol. The returned matrix is square with no quiet zone.
 */
export function qrMatrix(text: string): boolean[][] {
  const source = text && text.length > 0 ? text : ' ';
  for (const level of ['M', 'L'] as const) {
    try {
      return toMatrix(QRCode.create(source, { errorCorrectionLevel: level }).modules);
    } catch {
      // try the next level
    }
  }
  return toMatrix(QRCode.create(fitText(source), { errorCorrectionLevel: 'L' }).modules);
}
