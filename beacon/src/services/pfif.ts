// Google Person Finder interchange (PFIF 1.4). Pure TypeScript: no react-native imports, so it runs in tests and in Node.
//
// Mapping between the app's status and PFIF note status:
//   safe     -> believed_alive     (read back as safe)
//   found    -> believed_alive     (PFIF has no separate "found"; read back as safe)
//   looking  -> information_sought (read back as looking)
//   unknown  -> no status element  (read back as unknown)
// Coordinates are not part of the exchanged XML; they stay on the device.

export type PersonStatus = 'safe' | 'looking' | 'found' | 'unknown';

export interface PersonRecord {
  id: string;
  fullName: string;
  status: PersonStatus;
  note?: string;
  lat?: number;
  lon?: number;
  /** ms since epoch when the record was made or last changed */
  at: number;
  /** who or what supplied the record, written as PFIF author_name */
  source: string;
}

const NS = 'http://zesty.ca/pfif/1.4';

const STATUS_TO_PFIF: Record<PersonStatus, string | null> = {
  safe: 'believed_alive',
  found: 'believed_alive',
  looking: 'information_sought',
  unknown: null,
};

const PFIF_TO_STATUS: Record<string, PersonStatus> = {
  believed_alive: 'safe',
  is_note_author: 'safe',
  information_sought: 'looking',
  believed_missing: 'looking',
  believed_dead: 'unknown',
};

// XML 1.0 forbids most control characters, so they are dropped rather than escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const escapeXml = (s: string) =>
  s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_m, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'amp') return '&';
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const isoAt = (ms: number, fallback: number) => new Date(Number.isFinite(ms) && ms > 0 ? ms : fallback).toISOString();

/** Builds a PFIF 1.4 document: one person per record, each with one note carrying its status. */
export function toPfif(records: PersonRecord[], now: number = Date.now()): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', `<pfif:pfif xmlns:pfif="${NS}">`];
  for (const r of records) {
    const date = isoAt(r.at, now);
    const author = escapeXml(r.source || 'Beacon');
    out.push('  <pfif:person>');
    out.push(`    <pfif:person_record_id>${escapeXml(r.id)}</pfif:person_record_id>`);
    out.push(`    <pfif:entry_date>${date}</pfif:entry_date>`);
    out.push(`    <pfif:author_name>${author}</pfif:author_name>`);
    out.push(`    <pfif:source_date>${date}</pfif:source_date>`);
    out.push(`    <pfif:full_name>${escapeXml(r.fullName)}</pfif:full_name>`);
    out.push('  </pfif:person>');

    out.push('  <pfif:note>');
    out.push(`    <pfif:note_record_id>${escapeXml(r.id)}-note</pfif:note_record_id>`);
    out.push(`    <pfif:person_record_id>${escapeXml(r.id)}</pfif:person_record_id>`);
    out.push(`    <pfif:entry_date>${date}</pfif:entry_date>`);
    out.push(`    <pfif:author_name>${author}</pfif:author_name>`);
    out.push(`    <pfif:source_date>${date}</pfif:source_date>`);
    out.push(`    <pfif:text>${escapeXml(r.note ?? '')}</pfif:text>`);
    const st = STATUS_TO_PFIF[r.status] ?? null;
    if (st) out.push(`    <pfif:status>${st}</pfif:status>`);
    out.push('  </pfif:note>');
  }
  out.push('</pfif:pfif>');
  return out.join('\n');
}

const TAG = (name: string) => `<(?:[A-Za-z_][\\w.-]*:)?${name}>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}>`;
const BLOCK_RE = (name: string) => new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}>`, 'g');

const field = (block: string, name: string): string | undefined => {
  const m = new RegExp(TAG(name)).exec(block);
  return m ? unescapeXml(m[1].trim()) : undefined;
};

/** Tolerant, regex-based reader for PFIF documents. Unknown or missing status becomes 'unknown'. */
export function fromPfif(xml: string): PersonRecord[] {
  if (typeof xml !== 'string' || !xml.trim()) return [];

  // collect every note first, keyed by the person it belongs to (the last note wins)
  const notes = new Map<string, { text?: string; status: PersonStatus }>();
  for (const [, body] of xml.matchAll(BLOCK_RE('note'))) {
    const pid = field(body, 'person_record_id');
    if (!pid) continue;
    const raw = field(body, 'status');
    const status: PersonStatus = raw ? PFIF_TO_STATUS[raw] ?? 'unknown' : 'unknown';
    const text = field(body, 'text');
    notes.set(pid, { text: text || undefined, status });
  }

  const people: PersonRecord[] = [];
  // strip notes so their date and author fields are not read as the person's own
  const personsXml = xml.replace(BLOCK_RE('note'), '');
  for (const [, body] of personsXml.matchAll(BLOCK_RE('person'))) {
    const id = field(body, 'person_record_id');
    if (!id) continue;
    const note = notes.get(id);
    const entry = field(body, 'entry_date') ?? '';
    const parsed = Date.parse(entry);
    people.push({
      id,
      fullName: field(body, 'full_name') ?? '',
      status: note?.status ?? 'unknown',
      note: note?.text,
      at: Number.isFinite(parsed) ? parsed : 0,
      source: field(body, 'author_name') ?? '',
    });
  }
  return people;
}
