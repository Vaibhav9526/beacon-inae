import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { Alert, Persona } from './types.ts';
import { parseRule } from './parseRule.ts';
import type { Rule } from './types.ts';

export const HAIKU = 'claude-haiku-5-5';

/** Small text-in/text-out model. Anything can implement it: the API, or an external CLI the user already has. */
export type Brain = (system: string, user: string) => Promise<string>;

export function anthropicBrain(apiKey: string, model = HAIKU): Brain {
  const client = new Anthropic({ apiKey });
  return async (system, user) => {
    const r = await client.messages.create({ model, max_tokens: 300, system, messages: [{ role: 'user', content: user }] });
    return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  };
}

/** `claude -p`, `codex exec`, `gemini -p`: the prompt goes in as one argument, the answer comes back on stdout. */
export function cliBrain(cmd: 'claude' | 'codex' | 'gemini', timeoutMs = 60_000): Brain {
  const args = (p: string) => (cmd === 'claude' ? ['-p', p] : cmd === 'codex' ? ['exec', p] : ['-p', p]);
  return (system, user) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args(`${system}\n\n${user}`), { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const t = setTimeout(() => {
        child.kill();
        reject(new Error(`${cmd} timed out`));
      }, timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(t);
        code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(`${cmd} exited ${code}`));
      });
    });
}

const WRITER = [
  'You write one short family alert for a disaster-readiness app.',
  'Use ONLY the facts given. Do not add numbers, places, medicines or advice that are not in them.',
  'Keep every number exactly as given. Plain calm English, at most 30 words, no emojis, no markdown.',
  'If it is about health, end with a pointer to call the doctor or 112 when the facts say urgent.',
].join(' ');

const numbers = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * Haiku rewrites the deterministic alert text. The result is kept only if it is short and every number in it
 * appears in the original: a model may reword, never invent a reading.
 */
export function haikuWriter(brain: Brain) {
  return async (alert: Alert, fallback: string, persona?: Persona): Promise<string | null> => {
    const system = persona ? `${WRITER} Voice: ${persona.voice} Do not add a name or sign-off.` : WRITER;
    const text = (await brain(system, `Severity: ${alert.severity}\nFacts: ${fallback}`)).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 280) return null;
    const allowed = new Set(numbers(fallback));
    return numbers(text).every((n) => allowed.has(n)) ? text : null;
  };
}

const RULE_SYSTEM =
  'Turn the sentence into JSON {"mode":"all"|"any","conditions":[{"metric":string,"op":">"|">="|"<"|"<=","value":number}],"severity":"watch"|"warning"|"severe","message":string}. ' +
  'Metrics: temp_c, heat_index_c, humidity_pct, wind_kmh, rain_mm_24h, aqi, pm25, quake_max_mag, hr:<Name>, spo2:<Name>. Reply with JSON only.';

/** Plain-form rule: the regex parser first (instant, offline); Haiku only when it cannot understand. */
export async function ruleFromText(text: string, brain?: Brain): Promise<{ rule: Rule; via: 'parser' | 'haiku' } | null> {
  const p = parseRule(text);
  if (p && p.confidence >= 0.6) return { rule: p.rule, via: 'parser' };
  if (!brain) return p ? { rule: p.rule, via: 'parser' } : null;
  try {
    const raw = await brain(RULE_SYSTEM, text);
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { mode: 'all' | 'any'; conditions: Rule['when']['conditions']; severity: Rule['severity']; message: string };
    if (!Array.isArray(j.conditions) || j.conditions.length === 0) return p ? { rule: p.rule, via: 'parser' } : null;
    return { rule: { id: `r-${Date.now().toString(36)}`, name: text.slice(0, 40), when: { mode: j.mode === 'any' ? 'any' : 'all', conditions: j.conditions }, severity: j.severity, message: j.message }, via: 'haiku' };
  } catch {
    return p ? { rule: p.rule, via: 'parser' } : null;
  }
}
