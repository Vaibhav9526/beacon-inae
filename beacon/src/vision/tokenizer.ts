// Byte-level BPE (GPT-2 family) built from a Hugging Face tokenizer.json. SmolVLM uses it with a "split digits" step
// in front of the usual byte-level regex.

interface TokenizerJson {
  model: { vocab: Record<string, number>; merges: (string | [string, string])[] };
  added_tokens: { id: number; content: string; special: boolean }[];
}

/** GPT-2's reversible byte <-> printable-unicode table. */
function byteTables() {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const enc = new Map<number, string>();
  const dec = new Map<string, number>();
  bs.forEach((b, i) => {
    enc.set(b, String.fromCharCode(cs[i]));
    dec.set(String.fromCharCode(cs[i]), b);
  });
  return { enc, dec };
}

const { enc: BYTE_ENC, dec: BYTE_DEC } = byteTables();
const GPT2 = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export class Tokenizer {
  private vocab: Map<string, number>;
  private rev: string[] = [];
  private rank = new Map<string, number>();
  private cache = new Map<string, number[]>();
  readonly special = new Map<string, number>();

  constructor(json: TokenizerJson) {
    this.vocab = new Map(Object.entries(json.model.vocab));
    for (const [tok, id] of this.vocab) this.rev[id] = tok;
    json.model.merges.forEach((m, i) => this.rank.set(Array.isArray(m) ? `${m[0]} ${m[1]}` : m, i));
    for (const t of json.added_tokens) {
      this.rev[t.id] = t.content;
      this.special.set(t.content, t.id);
    }
  }

  id(token: string): number {
    const v = this.special.get(token) ?? this.vocab.get(token);
    if (v === undefined) throw new Error(`unknown token ${token}`);
    return v;
  }

  private bpe(word: string): number[] {
    const hit = this.cache.get(word);
    if (hit) return hit;
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.rank.get(`${parts[i]} ${parts[i + 1]}`);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    const ids = parts.map((p) => {
      const v = this.vocab.get(p);
      if (v === undefined) throw new Error(`token not in vocab: ${p}`);
      return v;
    });
    this.cache.set(word, ids);
    return ids;
  }

  /** Plain text -> ids (no special tokens are parsed out of the text). */
  encode(text: string): number[] {
    const out: number[] = [];
    // step 1: every digit is its own piece
    const segments: string[] = [];
    let run = '';
    for (const ch of text) {
      if (ch >= '0' && ch <= '9') {
        if (run) segments.push(run);
        segments.push(ch);
        run = '';
      } else run += ch;
    }
    if (run) segments.push(run);
    // step 2: byte-level regex split, then BPE
    for (const seg of segments) {
      for (const piece of seg.match(GPT2) ?? []) {
        const mapped = [...new TextEncoder().encode(piece)].map((b) => BYTE_ENC.get(b)!).join('');
        out.push(...this.bpe(mapped));
      }
    }
    return out;
  }

  decode(ids: number[], skipSpecial = true): string {
    const bytes: number[] = [];
    for (const id of ids) {
      const tok = this.rev[id];
      if (tok === undefined) continue;
      if (this.special.has(tok)) {
        if (!skipSpecial) bytes.push(...new TextEncoder().encode(tok));
        continue;
      }
      for (const ch of tok) {
        const b = BYTE_DEC.get(ch);
        if (b !== undefined) bytes.push(b);
      }
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }
}
