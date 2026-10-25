/** Byte pipe between phones. The mesh node never touches Bluetooth directly. */
export interface Transport {
  onPacket(cb: (link: string, data: Uint8Array) => void): void;
  onLink(cb: (link: string, up: boolean) => void): void;
  send(link: string, data: Uint8Array): void;
  broadcast(data: Uint8Array, exceptLink?: string): void;
  links(): string[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** In-memory network for tests and the simulator: a graph of nodes with explicit adjacency. */
export class MemoryNetwork {
  private nodes = new Map<string, MemoryTransport>();
  dropRate = 0;

  create(name: string) {
    const t = new MemoryTransport(name, this);
    this.nodes.set(name, t);
    return t;
  }

  connect(a: string, b: string) {
    this.nodes.get(a)!.up(b);
    this.nodes.get(b)!.up(a);
  }

  disconnect(a: string, b: string) {
    this.nodes.get(a)!.down(b);
    this.nodes.get(b)!.down(a);
  }

  deliver(from: string, to: string, data: Uint8Array) {
    if (this.dropRate && Math.random() < this.dropRate) return;
    const dst = this.nodes.get(to);
    if (!dst || !dst.connected.has(from)) return;
    const copy = data.slice();
    queueMicrotask(() => dst.receive(from, copy));
  }
}

export class MemoryTransport implements Transport {
  connected = new Set<string>();
  private packetCb: ((l: string, d: Uint8Array) => void) | null = null;
  private linkCb: ((l: string, up: boolean) => void) | null = null;
  sentBytes = 0;
  constructor(readonly name: string, private net: MemoryNetwork) {}

  onPacket(cb: (link: string, data: Uint8Array) => void) {
    this.packetCb = cb;
  }
  onLink(cb: (link: string, up: boolean) => void) {
    this.linkCb = cb;
  }
  up(peer: string) {
    this.connected.add(peer);
    this.linkCb?.(peer, true);
  }
  down(peer: string) {
    this.connected.delete(peer);
    this.linkCb?.(peer, false);
  }
  receive(from: string, data: Uint8Array) {
    this.packetCb?.(from, data);
  }
  send(link: string, data: Uint8Array) {
    this.sentBytes += data.length;
    this.net.deliver(this.name, link, data);
  }
  broadcast(data: Uint8Array, except?: string) {
    for (const l of this.connected) if (l !== except) this.send(l, data);
  }
  links() {
    return [...this.connected];
  }
  async start() {}
  async stop() {}
}
