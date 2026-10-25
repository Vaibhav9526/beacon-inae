// Pure helpers for signalling with a phone alone: Morse timing, SOS pattern, strobe schedule and a tone WAV.
// No native code here, so everything is testable in node.

/** One stretch of light or sound: on or off, for `units` time units (dot = 1 unit). */
export interface Step {
  on: boolean;
  units: number;
}

/** A timed step in milliseconds, ready for a strobe or a tone loop. */
export interface TimedStep {
  on: boolean;
  ms: number;
}

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

/**
 * Text to Morse timing with the standard 1:3:7 rules: a dot is 1 unit on, a dash 3 units on,
 * 1 unit off between the symbols of a letter, 3 units off between letters and 7 units off between words.
 * Characters without Morse code are skipped. The result has no trailing gap.
 */
export function morse(text: string): Step[] {
  const words = text
    .toUpperCase()
    .split(/\s+/)
    .map((w) => [...w].filter((c) => MORSE[c] !== undefined))
    .filter((w) => w.length > 0);
  const out: Step[] = [];
  words.forEach((letters, wi) => {
    if (wi > 0) out.push({ on: false, units: 7 });
    letters.forEach((ch, li) => {
      if (li > 0) out.push({ on: false, units: 3 });
      [...MORSE[ch]].forEach((sym, si) => {
        if (si > 0) out.push({ on: false, units: 1 });
        out.push({ on: true, units: sym === '.' ? 1 : 3 });
      });
    });
  });
  return out;
}

/** The distress signal `... --- ...` as timing steps. */
export function sosPattern(): Step[] {
  return morse('SOS');
}

/** Turns unit-based steps into millisecond steps for a strobe or a tone loop. */
export function strobeSchedule(pattern: Step[], unitMs: number): TimedStep[] {
  return pattern.map((s) => ({ on: s.on, ms: Math.round(s.units * unitMs) }));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/**
 * A sine tone as a complete 16-bit PCM mono WAV file, returned as base64 so it can be written to a file
 * and played by the audio player. `ms` is the length; a looping player repeats it seamlessly-enough for a siren.
 */
export function makeToneWav(freqHz: number, ms: number, sampleRate = 8000): string {
  const samples = Math.max(1, Math.round((sampleRate * ms) / 1000));
  const dataBytes = samples * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const view = new DataView(buf.buffer);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const amp = 0.6 * 32767;
  for (let i = 0; i < samples; i++) {
    const v = Math.round(amp * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
    view.setInt16(44 + i * 2, v, true);
  }
  return toBase64(buf);
}
