export type ReadinessId = 'medical' | 'contacts' | 'gobag' | 'drills' | 'family' | 'shelter' | 'water' | 'hub';

export interface ReadinessInput {
  medicalIdFilled: boolean;
  emergencyContactsCount: number;
  goBagChecked: number;
  goBagTotal: number;
  drillsDone: number;
  drillsTotal: number;
  /** Best timed drill run. A fast run gives a small bonus, but it cannot replace actual practice. */
  bestDrillMs?: number;
  familyMembersLinked: number | boolean;
  shelterKnown: boolean;
  waterDaysAtHome?: number;
  hubPaired: boolean;
  /** Highest hazard level (0-3) for the saved place; higher risk makes the matching prep count more. */
  hazardLevelMax: number;
}

export interface ReadinessPart {
  id: ReadinessId;
  label: string;
  weight: number;
  done: boolean | number;
  hint: string;
}

export interface NextStep {
  id: ReadinessId;
  label: string;
  why: string;
}

export interface ReadinessResult {
  score: number;
  parts: ReadinessPart[];
  next: NextStep[];
}

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const ratio = (done: number, total: number) => (total > 0 ? clamp(done / total) : 0);
const linked = (n: number | boolean) => (typeof n === 'boolean' ? n : n > 0);

/**
 * Pure readiness score. Each check has a base weight; a higher local hazard makes shelter,
 * water, go-bag and drills matter more. The result is normalised back to 0-100 and the
 * three biggest gaps become the next steps.
 */
export function readinessScore(input: ReadinessInput): ReadinessResult {
  const risk = clamp(input.hazardLevelMax / 3);
  const contacts = ratio(input.emergencyContactsCount, 2);
  const gobag = ratio(input.goBagChecked, input.goBagTotal);
  const drillRate = ratio(input.drillsDone, input.drillsTotal);
  const drillTime = input.bestDrillMs == null ? 0 : clamp((180_000 - input.bestDrillMs) / 135_000);
  const drills = Math.min(1, drillRate + (input.bestDrillMs == null ? 0 : 0.1 * drillTime));
  const water = ratio(input.waterDaysAtHome ?? 0, 3);

  const rows: Array<Omit<ReadinessPart, 'weight'> & { base: number }> = [
    {
      id: 'medical',
      label: 'Medical ID',
      base: 16,
      done: input.medicalIdFilled,
      hint: 'Add your name, blood group and medicines so rescuers can help.',
    },
    {
      id: 'contacts',
      label: 'Emergency contacts',
      base: 14,
      done: contacts,
      hint: 'Save two people who should be called first.',
    },
    {
      id: 'gobag',
      label: 'Go-bag',
      base: 18 + 4 * risk,
      done: gobag,
      hint: 'Pack water, medicines, a torch, a power bank and copies of your papers.',
    },
    {
      id: 'drills',
      label: 'Drills',
      base: 18 + 2 * risk,
      done: drills,
      hint: 'Practise Drop, Cover, Hold On, the fire escape and your flood route.',
    },
    {
      id: 'family',
      label: 'Family link',
      base: 10,
      done: linked(input.familyMembersLinked),
      hint: 'Pair a family member so you can find each other after an alert.',
    },
    {
      id: 'shelter',
      label: 'Nearest shelter',
      base: 10 + 8 * risk,
      done: input.shelterKnown,
      hint: 'Find and save the nearest shelter and a route to it.',
    },
    {
      id: 'water',
      label: 'Home water',
      base: 6 + 6 * risk,
      done: water,
      hint: 'Keep three days of drinking water at home.',
    },
    {
      id: 'hub',
      label: 'Hub paired',
      base: 8,
      done: input.hubPaired,
      hint: 'Pair the desktop hub so it keeps watch while you sleep.',
    },
  ];

  const rawTotal = rows.reduce((sum, r) => sum + r.base, 0);
  const parts: ReadinessPart[] = rows.map((r) => {
    const weight = rawTotal > 0 ? (r.base / rawTotal) * 100 : 0;
    return {
      id: r.id,
      label: r.label,
      weight: Math.round(weight * 10) / 10,
      done: typeof r.done === 'boolean' ? r.done : Math.round(clamp(r.done) * 100) / 100,
      hint: r.hint,
    };
  });

  const score = Math.round(
    parts.reduce((sum, p) => {
      const completion = typeof p.done === 'boolean' ? (p.done ? 1 : 0) : clamp(p.done);
      return sum + (p.weight / 100) * completion * 100;
    }, 0),
  );

  const next = parts
    .map((p) => {
      const completion = typeof p.done === 'boolean' ? (p.done ? 1 : 0) : clamp(p.done);
      return { part: p, gap: p.weight * (1 - completion) };
    })
    .filter((x) => x.gap > 0.05)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map(({ part }) => ({ id: part.id, label: part.label, why: part.hint }));

  return { score: Math.max(0, Math.min(100, score)), parts, next };
}
