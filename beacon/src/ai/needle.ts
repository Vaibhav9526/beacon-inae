import native from '../../modules/beacon-ai';
import type { NeedleEngine } from './router';
import { SYSTEM_PROMPT, TOOLS, type ToolCall } from './tools';

export interface NeedleStatus {
  state: 'unavailable' | 'ready' | 'failed';
  error?: string;
}

let starting: Promise<NeedleStatus> | null = null;
let status: NeedleStatus = { state: 'unavailable' };

/** Loads the on-device Needle engine once. Safe to call repeatedly. */
export function startNeedle(): Promise<NeedleStatus> {
  if (!native) return Promise.resolve(status);
  starting ??= native
    .needleStart(SYSTEM_PROMPT, JSON.stringify(TOOLS))
    .then((r): NeedleStatus => (status = r.ok ? { state: 'ready' } : { state: 'failed', error: r.error ?? 'unknown' }))
    .catch((e): NeedleStatus => (status = { state: 'failed', error: String(e?.message ?? e) }));
  return starting;
}

export const needleStatus = () => status;

/** The engine the router uses, or null when Needle is not available on this device. */
export const needleEngine: NeedleEngine = {
  async complete(text) {
    const s = await startNeedle();
    if (s.state !== 'ready' || !native) throw new Error(s.error ?? 'needle unavailable');
    const raw = await native.needleComplete(text);
    const j = JSON.parse(raw) as { function_calls?: ToolCall[]; confidence?: number | null; success?: boolean; error?: string };
    if (j.success === false) throw new Error(j.error ?? 'needle error');
    return { calls: j.function_calls ?? [], confidence: j.confidence ?? null };
  },
};

export const needleSupported = native != null;
