import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MAX_MEMBERS, MAX_MESSAGES, Members } from './members.ts';
import type { GroupMessage } from './types.ts';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'members-')), 'members.json');

/** A group with one adult (the person who set it up). */
function groupWithAdult(now?: () => number) {
  const m = new Members(tmpFile(), now);
  const adult = m.add(null, { name: 'Vaibhav', role: 'adult' });
  return { m, adult };
}

const msg = (i: number): GroupMessage => ({ id: `g${i}`, from: 'hub', fromName: 'Hub', text: `hi ${i}`, at: i, kind: 'text' });

test('the first member must be an adult, and actor may be null', () => {
  const m = new Members(tmpFile());
  assert.throws(() => m.add(null, { name: 'Child', role: 'child' }), /first member must be an adult/);
  assert.throws(() => m.add(null, { name: 'Elder', role: 'elder' }), /first member must be an adult/);
  const first = m.add(null, { name: 'Vaibhav', role: 'adult' });
  assert.equal(first.role, 'adult');
  assert.equal(m.list().length, 1);
});

test('after the first member, only an existing adult can add members', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  assert.throws(() => m.add(null, { name: 'X', role: 'child' }), /Only an adult can add members/);
  assert.throws(() => m.add(elder.id, { name: 'X', role: 'child' }), /Only an adult can add members/);
  assert.throws(() => m.add('nobody', { name: 'X', role: 'child' }), /Only an adult can add members/);
  const kid = m.add(adult.id, { name: 'Kid', role: 'child' });
  assert.equal(kid.addedBy, adult.id);
});

test('a group holds at most 12 members', () => {
  const { m, adult } = groupWithAdult();
  for (let i = 1; i < MAX_MEMBERS; i++) m.add(adult.id, { name: `M${i}`, role: 'child' });
  assert.equal(m.list().length, MAX_MEMBERS);
  assert.throws(() => m.add(adult.id, { name: 'one too many', role: 'child' }), /at most 12/);
});

test('a name is required', () => {
  const m = new Members(tmpFile());
  assert.throws(() => m.add(null, { name: '   ', role: 'adult' }), /needs a name/);
});

test('only adults remove members, and the last adult cannot be removed', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  assert.throws(() => m.remove(elder.id, adult.id), /Only an adult can remove members/);
  assert.throws(() => m.remove(null, elder.id), /Only an adult can remove members/);
  assert.throws(() => m.remove(adult.id, adult.id), /last adult/);
  m.remove(adult.id, elder.id);
  assert.equal(m.get(elder.id), undefined);
});

test('an adult can remove another adult when more than one exists', () => {
  const { m, adult } = groupWithAdult();
  const second = m.add(adult.id, { name: 'Partner', role: 'adult' });
  m.remove(second.id, adult.id);
  assert.equal(m.get(adult.id), undefined, 'the second adult removed the first');
  assert.equal(m.list().length, 1);
});

test('update: adults can change anyone', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const updated = m.update(adult.id, elder.id, { name: 'Ma', role: 'child', healthName: 'Maa' });
  assert.equal(updated.name, 'Ma');
  assert.equal(updated.role, 'child');
  assert.equal(updated.healthName, 'Maa');
});

test('update: others can change only their own name and look', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const look = { hair: 2, skin: 1, color: '#ff0000' };
  assert.equal(m.update(elder.id, elder.id, { name: 'Ma', look }).look?.color, '#ff0000');
  assert.throws(() => m.update(elder.id, elder.id, { role: 'adult' }), /only your own name or look/);
  assert.throws(() => m.update(elder.id, adult.id, { name: 'Hacked' }), /Only an adult can change another member/);
  assert.throws(() => m.update(null, elder.id, { name: 'x' }), /Only a member can change members/);
});

test('the last adult cannot be demoted', () => {
  const { m, adult } = groupWithAdult();
  assert.throws(() => m.update(adult.id, adult.id, { role: 'elder' }), /Cannot demote the last adult/);
  const second = m.add(adult.id, { name: 'Partner', role: 'adult' });
  m.update(adult.id, second.id, { role: 'elder' });
  assert.equal(m.get(second.id)?.role, 'elder');
});

test('invite: 8 characters from A-Z and 2-9, expiring in 7 days', () => {
  let t = 1_000_000;
  const { m, adult } = groupWithAdult(() => t);
  const inv = m.createInvite(adult.id);
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  assert.equal(inv.memberId, adult.id);
  assert.equal(inv.expiresAt, t + 7 * 24 * 3600_000);
  assert.throws(() => m.createInvite('nobody'), /No such member/);
});

test('invite is one-time: redeeming links the device and consumes the code', () => {
  let t = 1_000_000;
  const { m, adult } = groupWithAdult(() => t);
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const inv = m.createInvite(elder.id);
  const got = m.redeemInvite(inv.code, 'phone-A');
  assert.ok(got);
  assert.equal(got.id, elder.id);
  assert.equal(got.deviceId, 'phone-A');
  assert.equal(got.joinedAt, t);
  assert.equal(m.byDevice('phone-A')?.id, elder.id);
  assert.equal(m.redeemInvite(inv.code, 'phone-B'), null, 'second use fails');
});

test('invite codes are case-insensitive and unknown codes return null', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const inv = m.createInvite(elder.id);
  assert.equal(m.redeemInvite(inv.code.toLowerCase(), 'phone-A')?.id, elder.id);
  assert.equal(m.redeemInvite('ZZZZZZZZ', 'phone-A'), null);
});

test('an expired invite does not redeem', () => {
  let t = 1_000_000;
  const { m, adult } = groupWithAdult(() => t);
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const inv = m.createInvite(elder.id);
  t = inv.expiresAt;
  assert.equal(m.redeemInvite(inv.code, 'phone-A'), null);
  assert.equal(m.get(elder.id)?.deviceId, undefined);
});

test('a new invite replaces the old one for the same member', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const first = m.createInvite(elder.id);
  const second = m.createInvite(elder.id);
  assert.equal(m.redeemInvite(first.code, 'phone-A'), null);
  assert.equal(m.redeemInvite(second.code, 'phone-A')?.id, elder.id);
});

test('one phone belongs to one member: redeeming for a new member moves the device', () => {
  const { m, adult } = groupWithAdult();
  const a = m.add(adult.id, { name: 'A', role: 'elder' });
  const b = m.add(adult.id, { name: 'B', role: 'elder' });
  m.redeemInvite(m.createInvite(a.id).code, 'phone-X');
  m.redeemInvite(m.createInvite(b.id).code, 'phone-X');
  assert.equal(m.get(a.id)?.deviceId, undefined);
  assert.equal(m.byDevice('phone-X')?.id, b.id);
});

test('removing a member drops their invites', () => {
  const { m, adult } = groupWithAdult();
  const elder = m.add(adult.id, { name: 'Maa', role: 'elder' });
  const inv = m.createInvite(elder.id);
  m.remove(adult.id, elder.id);
  assert.equal(m.redeemInvite(inv.code, 'phone-A'), null);
});

test('messages keep only the last 200, and recent(n) returns the newest n oldest first', () => {
  const { m } = groupWithAdult();
  for (let i = 0; i < MAX_MESSAGES + 25; i++) m.addMessage(msg(i));
  const all = m.recent(1000);
  assert.equal(all.length, MAX_MESSAGES);
  assert.equal(all[0]!.id, 'g25');
  assert.equal(all.at(-1)!.id, `g${MAX_MESSAGES + 24}`);
  const last3 = m.recent(3);
  assert.deepEqual(
    last3.map((x) => x.id),
    [`g${MAX_MESSAGES + 22}`, `g${MAX_MESSAGES + 23}`, `g${MAX_MESSAGES + 24}`],
  );
  assert.equal(m.recent().length, 50);
});

test('exportPublic gives only id, name, role and look', () => {
  const { m, adult } = groupWithAdult();
  const look = { hair: 1, skin: 2, color: '#00ff00' };
  m.add(adult.id, { name: 'Maa', role: 'elder', healthName: 'Maa', look });
  const pub = m.exportPublic();
  assert.deepEqual(pub[0], { id: adult.id, name: 'Vaibhav', role: 'adult' });
  assert.deepEqual(pub[1], { id: pub[1]!.id, name: 'Maa', role: 'elder', look });
  assert.ok(!JSON.stringify(pub).includes('healthName'));
});

test('persistence: state survives a reload, and no temp file is left behind', () => {
  const file = tmpFile();
  const m1 = new Members(file);
  const adult = m1.add(null, { name: 'Vaibhav', role: 'adult' });
  const elder = m1.add(adult.id, { name: 'Maa', role: 'elder' });
  m1.redeemInvite(m1.createInvite(elder.id).code, 'phone-A');
  m1.addMessage(msg(1));
  assert.ok(existsSync(file));
  assert.ok(!existsSync(file + '.tmp'), 'the temp file was renamed away');

  const m2 = new Members(file);
  assert.equal(m2.list().length, 2);
  assert.equal(m2.byDevice('phone-A')?.name, 'Maa');
  assert.equal(m2.recent().length, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).members.length, 2);
});

test('a missing file starts an empty group', () => {
  const m = new Members(join(mkdtempSync(join(tmpdir(), 'members-')), 'nested', 'none.json'));
  assert.deepEqual(m.list(), []);
  assert.deepEqual(m.recent(), []);
});
