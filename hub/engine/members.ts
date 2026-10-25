import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GroupMessage, Look, Member, MemberRole } from './types.ts';

export const MAX_MEMBERS = 12;
export const MAX_MESSAGES = 200;
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

export interface Invite {
  code: string;
  memberId: string;
  expiresAt: number;
}

export interface NewMember {
  name: string;
  role: MemberRole;
  healthName?: string;
  look?: Look;
}

export type MemberPatch = Partial<Pick<Member, 'name' | 'role' | 'healthName' | 'look'>>;

interface State {
  members: Member[];
  invites: Invite[];
  messages: GroupMessage[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * The family group: members, their roles, one-time invites and the last 200 group messages.
 * Persisted as JSON in `file`; every change is written atomically (temp file, then rename).
 */
export class Members {
  private state: State;

  constructor(
    private file: string,
    private now: () => number = () => Date.now(),
  ) {
    if (existsSync(file)) {
      const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>;
      this.state = { members: s.members ?? [], invites: s.invites ?? [], messages: s.messages ?? [] };
    } else {
      this.state = { members: [], invites: [], messages: [] };
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  private adults(): Member[] {
    return this.state.members.filter((m) => m.role === 'adult');
  }

  private isAdult(actor: string | null | undefined): boolean {
    return !!actor && this.adults().some((m) => m.id === actor);
  }

  list(): Member[] {
    return clone(this.state.members);
  }

  get(id: string): Member | undefined {
    const m = this.state.members.find((x) => x.id === id);
    return m ? clone(m) : undefined;
  }

  /** The member whose phone paired with this device id. */
  byDevice(deviceId: string): Member | undefined {
    const m = this.state.members.find((x) => x.deviceId === deviceId);
    return m ? clone(m) : undefined;
  }

  add(actor: string | null, input: NewMember): Member {
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('A member needs a name');
    if (this.state.members.length === 0) {
      if (input.role !== 'adult') throw new Error('The first member must be an adult');
    } else if (!this.isAdult(actor)) {
      throw new Error('Only an adult can add members');
    }
    if (this.state.members.length >= MAX_MEMBERS) throw new Error(`A group can have at most ${MAX_MEMBERS} members`);
    const member: Member = {
      id: randomBytes(6).toString('hex'),
      name,
      role: input.role,
      ...(input.healthName ? { healthName: input.healthName.trim() } : {}),
      ...(input.look ? { look: input.look } : {}),
      ...(actor ? { addedBy: actor } : {}),
    };
    this.state.members.push(member);
    this.save();
    return clone(member);
  }

  remove(actor: string | null, id: string): void {
    if (!this.isAdult(actor)) throw new Error('Only an adult can remove members');
    const target = this.state.members.find((m) => m.id === id);
    if (!target) throw new Error('No such member');
    if (target.role === 'adult' && this.adults().length === 1) throw new Error('Cannot remove the last adult');
    this.state.members = this.state.members.filter((m) => m.id !== id);
    this.state.invites = this.state.invites.filter((i) => i.memberId !== id);
    this.save();
  }

  /** Adults can change anyone. Anyone else can change only their own name and look. */
  update(actor: string | null, id: string, patch: MemberPatch): Member {
    const who = actor ? this.state.members.find((m) => m.id === actor) : undefined;
    if (!who) throw new Error('Only a member can change members');
    const target = this.state.members.find((m) => m.id === id);
    if (!target) throw new Error('No such member');
    if (who.role !== 'adult') {
      if (who.id !== id) throw new Error('Only an adult can change another member');
      const other = Object.keys(patch).filter((k) => k !== 'name' && k !== 'look');
      if (other.length) throw new Error('You can change only your own name or look');
    }
    if (patch.role && patch.role !== 'adult' && target.role === 'adult' && this.adults().length === 1) {
      throw new Error('Cannot demote the last adult');
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error('A member needs a name');
      target.name = name;
    }
    if (patch.role) target.role = patch.role;
    if (patch.healthName !== undefined) {
      if (patch.healthName) target.healthName = patch.healthName.trim();
      else delete target.healthName;
    }
    if (patch.look) target.look = patch.look;
    this.save();
    return clone(target);
  }

  /** A one-time code (8 characters) that lets a phone become this member. Valid for 7 days. */
  createInvite(memberId: string): Invite {
    if (!this.state.members.some((m) => m.id === memberId)) throw new Error('No such member');
    const bytes = randomBytes(8);
    // 32 symbols and 256 byte values: taking the byte modulo 32 is unbiased
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % 32]).join('');
    // a member has one live invite at a time; a new one replaces the old
    this.state.invites = this.state.invites.filter((i) => i.memberId !== memberId && i.expiresAt > this.now());
    const invite: Invite = { code, memberId, expiresAt: this.now() + INVITE_TTL_MS };
    this.state.invites.push(invite);
    this.save();
    return clone(invite);
  }

  /** Consumes the invite and links the device to its member. Returns null for unknown, used or expired codes. */
  redeemInvite(code: string, deviceId: string): Member | null {
    const key = String(code ?? '').trim().toUpperCase();
    const invite = this.state.invites.find((i) => i.code === key);
    if (!invite) return null;
    this.state.invites = this.state.invites.filter((i) => i.code !== key && i.expiresAt > this.now());
    const target = this.state.members.find((m) => m.id === invite.memberId);
    if (invite.expiresAt <= this.now() || !target) {
      this.save();
      return null;
    }
    // one phone is one member
    for (const m of this.state.members) if (m.deviceId === deviceId) delete m.deviceId;
    target.deviceId = deviceId;
    target.joinedAt = this.now();
    this.save();
    return clone(target);
  }

  addMessage(msg: GroupMessage): void {
    this.state.messages.push(clone(msg));
    this.state.messages = this.state.messages.slice(-MAX_MESSAGES);
    this.save();
  }

  /** The last n messages, oldest first. */
  recent(n = 50): GroupMessage[] {
    return clone(this.state.messages.slice(-n));
  }

  exportPublic(): Array<Pick<Member, 'id' | 'name' | 'role' | 'look'>> {
    return this.state.members.map((m) => ({ id: m.id, name: m.name, role: m.role, ...(m.look ? { look: m.look } : {}) }));
  }
}
