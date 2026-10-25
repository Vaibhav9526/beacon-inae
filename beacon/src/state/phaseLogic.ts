// Which phase of a disaster the person is in. Computed from what the phone already knows, never asked.
// Pure on purpose (no react-native imports) so it runs under the test runner.

export type Phase = 'prepare' | 'alert' | 'recover';

export interface PhaseAlert {
  severity: 'info' | 'watch' | 'warning' | 'severe';
  title: string;
  seenAt: number;
  expires?: number;
}

export interface PhaseInput {
  now: number;
  /** alerts that apply here and are still listed */
  alerts: PhaseAlert[];
  /** verified SOS messages heard on the mesh (timestamp in ms) */
  sosHeard: { timestamp: number; verified: boolean }[];
  /** this phone is broadcasting its own SOS */
  mySosActive: boolean;
  /** last time a warning or severe hazard was in force here (kept across restarts by the hook) */
  lastHazardAt?: number | null;
  /** the person pressed "I am safe" at this time */
  safeAt?: number | null;
  /** the person picked a phase by hand */
  override?: Phase | null;
}

export interface PhaseResult {
  phase: Phase;
  /** plain reasons, English; the UI shows the first as a subtitle */
  reasons: string[];
  /** the alert that put us in alert mode, or the strongest one being watched */
  lead?: PhaseAlert;
  /** watch-level alerts being followed while still in prepare */
  watching: number;
  /** ms timestamp the phase began, when known */
  since?: number;
}

const HOUR = 3600_000;
export const RECOVER_WINDOW = 72 * HOUR;
const FRESH_NO_EXPIRY = 24 * HOUR;
const SOS_FRESH = 30 * 60_000;

const rank = { info: 0, watch: 1, warning: 2, severe: 3 } as const;

const inForce = (a: PhaseAlert, now: number) => (a.expires ? a.expires > now : now - a.seenAt < FRESH_NO_EXPIRY);

export function computePhase(i: PhaseInput): PhaseResult {
  const live = i.alerts.filter((a) => inForce(a, i.now));
  const hazards = live.filter((a) => rank[a.severity] >= rank.warning).sort((a, b) => rank[b.severity] - rank[a.severity] || b.seenAt - a.seenAt);
  const watching = live.filter((a) => a.severity === 'watch').length;
  const freshSos = i.sosHeard.filter((s) => s.verified && i.now - s.timestamp < SOS_FRESH);

  if (i.override) return { phase: i.override, reasons: ['You chose this view'], lead: hazards[0], watching };

  if (hazards.length > 0) {
    const lead = hazards[0];
    return { phase: 'alert', reasons: [`${lead.severity === 'severe' ? 'Severe' : 'Warning'}: ${lead.title}`], lead, watching, since: lead.seenAt };
  }
  if (i.mySosActive) return { phase: 'alert', reasons: ['Your SOS is being sent'], watching };
  if (freshSos.length > 0) return { phase: 'alert', reasons: [`${freshSos.length} SOS heard nearby`], watching, since: Math.min(...freshSos.map((s) => s.timestamp)) };

  const last = i.lastHazardAt ?? null;
  if (last !== null && i.now - last < RECOVER_WINDOW) {
    // the sooner someone says they are safe the more the screen should be about the aftermath, so both reasons apply
    return {
      phase: 'recover',
      reasons: [i.safeAt && i.safeAt > last ? 'You are marked safe; the hazard has passed' : 'The hazard has passed; check on people and things'],
      watching,
      since: last,
    };
  }
  return { phase: 'prepare', reasons: watching > 0 ? [`Following ${watching} watch-level alert${watching > 1 ? 's' : ''}`] : ['No active alert near you'], lead: live[0], watching };
}

/** Should the hook remember "a hazard is in force now"? Used to keep the recover window after alerts expire. */
export const hazardInForce = (r: PhaseResult): boolean => r.phase === 'alert' && !!r.lead;

const HAZARD_WORDS: [string, RegExp][] = [
  ['earthquake', /earthquake|quake|seismic|tremor|भूकंप/i],
  ['tsunami', /tsunami|सुनामी/i],
  ['cyclone', /cyclone|storm surge|depression|चक्रवात/i],
  ['flood', /flood|inundat|heavy rain|rainfall|cloudburst|बाढ़|भारी बारिश/i],
  ['landslide', /landslide|mudslide|भूस्खलन/i],
  ['heatwave', /heat ?wave|heat index|extreme heat|लू/i],
  ['lightning', /lightning|thunder|बिजली/i],
];

/** Which disaster guide (an id from src/kb/disasters.ts) best matches an alert title; null when none does. */
export function hazardIdFor(title: string): string | null {
  for (const [id, re] of HAZARD_WORDS) if (re.test(title)) return id;
  return null;
}
