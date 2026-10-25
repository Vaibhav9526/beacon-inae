import Anthropic from '@anthropic-ai/sdk';

export interface Screening {
  /** What the system decided to do with the post. Humans can always overrule. */
  decision: 'approve' | 'review';
  category: string;
  /** ~60 word neutral summary shown on the news card. */
  summary: string;
  concerns: string[];
  authenticity: 'likely' | 'uncertain' | 'suspicious';
  relevant: boolean;
  source: 'ai' | 'heuristic';
}

export interface ScreenInput {
  caption: string;
  lat: number;
  lon: number;
  capturedAt: number;
  delayed: boolean;
  /** JPEG/PNG/WebP bytes of the photo, or of a poster frame for a video. */
  image?: { data: Buffer; mime: string };
  kind: 'photo' | 'video';
}

export interface Screener {
  screen(i: ScreenInput): Promise<Screening>;
}

const MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean', description: 'Does it show a disaster, its effects, or a local safety situation?' },
    authenticity: { type: 'string', enum: ['likely', 'uncertain', 'suspicious'] },
    category: { type: 'string', enum: ['flood', 'fire', 'earthquake', 'storm', 'landslide', 'heat', 'accident', 'infrastructure', 'medical', 'help_needed', 'other'] },
    concerns: { type: 'array', items: { type: 'string' }, description: 'Short reasons for doubt: screenshot UI, watermark, edited look, stock photo, inconsistent weather, personal data, graphic injury, etc.' },
    safe_to_publish: { type: 'boolean', description: 'False for graphic gore, identifiable victims, nudity, hate, or private information.' },
    summary: { type: 'string', description: 'Neutral description of what is visible, at most 55 words, no speculation.' },
  },
  required: ['relevant', 'authenticity', 'category', 'concerns', 'safe_to_publish', 'summary'],
  additionalProperties: false,
} as const;

const SYSTEM =
  'You pre-screen citizen photos posted to a disaster safety app, before human moderators and the community vote on them. ' +
  'The photo was captured live inside the app (no gallery uploads). You are one layer of several, so be calibrated: ' +
  'mark "suspicious" only for concrete signs (screenshot or app UI, watermarks, obvious editing or AI-generated look, stock or news-agency imagery, ' +
  'content that contradicts the stated place or conditions). Say "uncertain" when you simply cannot tell. ' +
  'Never identify real people. Describe only what is visible. The caption and location are claims by the poster, not facts.';

export class ClaudeScreener implements Screener {
  private client: Pick<Anthropic, 'beta'>;
  constructor(apiKey?: string, client?: Pick<Anthropic, 'beta'>) {
    this.client = client ?? new Anthropic(apiKey ? { apiKey } : undefined);
  }

  async screen(i: ScreenInput): Promise<Screening> {
    if (!i.image) return heuristic(i, 'no image to inspect');
    try {
      const mediaType = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(i.image.mime) ? i.image.mime : 'image/jpeg') as 'image/jpeg';
      const res = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 1500,
        // Opt in to server-side fallback so a policy decline on a hard disaster photo is retried rather than dropped.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: i.image.data.toString('base64') } },
              {
                type: 'text',
                text:
                  `Poster's caption: ${JSON.stringify(i.caption.slice(0, 300))}\n` +
                  `Claimed location: ${i.lat.toFixed(3)}, ${i.lon.toFixed(3)}\n` +
                  `Captured: ${new Date(i.capturedAt).toISOString()}${i.delayed ? ' (uploaded later, phone was offline)' : ''}\n` +
                  `Media: ${i.kind}${i.kind === 'video' ? ' (this image is a poster frame)' : ''}`,
              },
            ],
          },
        ],
      });
      if (res.stop_reason === 'refusal') return heuristic(i, 'model declined; needs a human');
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return heuristic(i, 'no verdict');
      const v = JSON.parse(text.text) as {
        relevant: boolean;
        authenticity: Screening['authenticity'];
        category: string;
        concerns: string[];
        safe_to_publish: boolean;
        summary: string;
      };
      const ok = v.relevant && v.authenticity === 'likely' && v.safe_to_publish && i.kind === 'photo';
      return {
        decision: ok ? 'approve' : 'review',
        category: v.category,
        summary: clip60(v.summary),
        concerns: v.concerns.slice(0, 6),
        authenticity: v.authenticity,
        relevant: v.relevant,
        source: 'ai',
      };
    } catch (e) {
      // Never auto-approve when the check itself failed.
      return heuristic(i, e instanceof Anthropic.APIError ? `AI check unavailable (${e.status})` : 'AI check failed');
    }
  }
}

/** Fallback when no AI verdict exists: everything goes to human moderators. */
export function heuristic(i: ScreenInput, why: string): Screening {
  return {
    decision: 'review',
    category: 'other',
    summary: clip60(i.caption || 'Citizen report awaiting review.'),
    concerns: [why],
    authenticity: 'uncertain',
    relevant: true,
    source: 'heuristic',
  };
}

export function clip60(text: string): string {
  const words = text.trim().split(/\s+/);
  return words.length <= 60 ? words.join(' ') : words.slice(0, 58).join(' ') + '…';
}
