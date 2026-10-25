export type Lang = 'en' | 'hi';

/** English / Hindi pair, always kept together so the two can never drift out of step. */
export type T = readonly [en: string, hi: string];
export const pick = (t: T, lang: Lang) => (lang === 'hi' ? t[1] : t[0]);

export type GuideKind = 'firstaid' | 'remedy' | 'disaster';

export interface Guide {
  id: string;
  kind: GuideKind;
  /** emergency = call 112 first; urgent = needs a clinician soon; minor = manage at home */
  level: 'emergency' | 'urgent' | 'minor';
  emoji: string;
  title: T;
  /** Words people (and the vision model) use for this situation. Used for offline matching. */
  keywords: T;
  steps: T[];
  avoid?: T[];
  /** Everyday things that can stand in for supplies (the "jugaad" part). */
  household?: T[];
  /** Phone number worth showing on this guide besides 112. */
  helpline?: { label: T; number: string };
  related?: string[];
}

export interface DisasterGuide {
  id: string;
  emoji: string;
  title: T;
  keywords: T;
  before: T[];
  during: T[];
  after: T[];
}

export const DISCLAIMER: T = [
  'Beacon gives general first-aid guidance, not a diagnosis. In an emergency call 112 first. Follow instructions from doctors and rescuers.',
  'Beacon सामान्य प्राथमिक उपचार की जानकारी देता है, निदान नहीं। आपात स्थिति में सबसे पहले 112 पर कॉल करें। डॉक्टर और बचाव दल की सलाह मानें।',
];

export const EMERGENCY_NUMBER = '112';
