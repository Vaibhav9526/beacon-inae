// Tolerant CSV import for health readings (exports from fitness bands, spreadsheets, hand-made sheets).

import type { HealthReading } from './types.ts';

type Field = 'member' | 'time' | 'hr' | 'spo2' | 'steps' | 'sleep';

const ALIASES: Record<string, Field> = {
  member: 'member', name: 'member', person: 'member',
  time: 'time', timestamp: 'time', date: 'time', datetime: 'time',
  hr: 'hr', heart_rate: 'hr', pulse: 'hr', bpm: 'hr',
  spo2: 'spo2', oxygen: 'spo2', o2: 'spo2',
  steps: 'steps',
  sleep: 'sleep', sleep_h: 'sleep', sleep_hours: 'sleep',
};

/** Splits CSV text into rows of cells. Handles quoted fields (with "" escapes and embedded newlines), CRLF, LF and CR. */
function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endCell(); i++; continue; }
    if (ch === '\r') { endRow(); i += src[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** Epoch seconds (< 1e11), epoch ms, or any Date.parse-able string (ISO preferred). */
function parseTime(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
    return Number.isFinite(ms) ? ms : undefined;
  }
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Leading number, so "98%" -> 98 and "7,500" -> 7500. */
function parseNum(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const m = /^-?\d+(\.\d+)?/.exec(s.trim().replace(/,/g, ''));
  return m ? Number(m[0]) : undefined;
}

/**
 * Parses health readings from CSV text. Rows without a usable time or without any
 * recognisable value are counted in `skipped`. A missing or empty member cell uses `defaultMember`.
 */
export function parseHealthCsv(
  text: string,
  defaultMember = 'Maa',
): { readings: HealthReading[]; skipped: number } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  const readings: HealthReading[] = [];
  let skipped = 0;
  if (rows.length === 0) return { readings, skipped };

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = new Map<Field, number>();
  header.forEach((h, idx) => {
    const field = ALIASES[h];
    if (field && !col.has(field)) col.set(field, idx);
  });

  const cellOf = (row: string[], field: Field): string | undefined => {
    const idx = col.get(field);
    return idx === undefined ? undefined : row[idx];
  };

  for (const row of rows.slice(1)) {
    const at = parseTime(cellOf(row, 'time') ?? '');
    if (at === undefined) { skipped++; continue; }

    const hr = parseNum(cellOf(row, 'hr'));
    const spo2 = parseNum(cellOf(row, 'spo2'));
    const steps = parseNum(cellOf(row, 'steps'));
    const sleepHours = parseNum(cellOf(row, 'sleep'));
    if (hr === undefined && spo2 === undefined && steps === undefined && sleepHours === undefined) {
      skipped++;
      continue;
    }

    const member = cellOf(row, 'member')?.trim() || defaultMember;
    const r: HealthReading = { member, at };
    if (hr !== undefined) r.hr = hr;
    if (spo2 !== undefined) r.spo2 = spo2;
    if (steps !== undefined) r.steps = steps;
    if (sleepHours !== undefined) r.sleepHours = sleepHours;
    readings.push(r);
  }
  return { readings, skipped };
}
