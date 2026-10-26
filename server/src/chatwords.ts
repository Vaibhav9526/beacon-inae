/**
 * A short blocklist for the public chat: slurs and abuse in English, Hinglish (Roman letters) and Hindi (Devanagari).
 * Whole words only, compared after lowercasing and simple leetspeak normalisation (see chat.ts).
 * The server filter is a first line of defence; reports and moderators do the rest.
 */
export const BLOCKED_WORDS: readonly string[] = [
  // English
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'dickhead', 'slut', 'whore', 'cunt', 'nigger', 'nigga', 'faggot', 'retard',
  // Hinglish
  'madarchod', 'maderchod', 'behenchod', 'bhenchod', 'benchod', 'chutiya', 'chutiye', 'gandu', 'harami', 'haramzada', 'haramzade', 'randi', 'bhosdi', 'bhosdike', 'bhosadi', 'lauda', 'lund', 'kutta', 'kamina', 'kamini',
  // Hindi
  'मादरचोद', 'बहनचोद', 'भेनचोद', 'चूतिया', 'चुतिया', 'गांडू', 'हरामी', 'हरामज़ादा', 'हरामजादा', 'रंडी', 'भोसड़ीके', 'कुत्ता', 'कमीना',
];
