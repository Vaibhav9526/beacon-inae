import { createIdentity } from '../identity';
import { MeshNode, type Scheduler } from '../node';
import { MemoryNetwork } from '../transport';

/** Deterministic clock: timers only fire when the test advances time. */
export class VirtualClock implements Scheduler {
  t = 1_700_000_000_000;
  private timers: { at: number; fn: () => void; every?: number; dead: boolean }[] = [];

  now() {
    return this.t;
  }
  after(ms: number, fn: () => void) {
    const e = { at: this.t + ms, fn, dead: false };
    this.timers.push(e);
    return () => {
      e.dead = true;
    };
  }
  every(ms: number, fn: () => void) {
    const e = { at: this.t + ms, fn, every: ms, dead: false };
    this.timers.push(e);
    return () => {
      e.dead = true;
    };
  }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      this.timers = this.timers.filter((x) => !x.dead);
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      if (next.every) next.at += next.every;
      else next.dead = true;
      next.fn();
    }
    this.t = end;
    await flush();
  }
}

export const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

export interface World {
  clock: VirtualClock;
  net: MemoryNetwork;
  nodes: Record<string, MeshNode>;
  add(name: string, opts?: { trusted?: Uint8Array[] }): MeshNode;
}

export function world(): World {
  const clock = new VirtualClock();
  const net = new MemoryNetwork();
  const nodes: Record<string, MeshNode> = {};
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return {
    clock,
    net,
    nodes,
    add(name, opts) {
      const t = net.create(name);
      const n = new MeshNode(createIdentity(), t, {
        nickname: name,
        scheduler: clock,
        rand,
        trustedGateways: opts?.trusted,
      });
      nodes[name] = n;
      return n;
    },
  };
}
