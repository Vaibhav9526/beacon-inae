import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { create } from 'zustand';
import { Screen } from '../components/Screen';
import { Appear, Badge, Btn, Card, Chip, IconTile, Press, Row, Txt, useTheme } from '../components/ui';
import { useLocal } from '../i18n';
import type { T } from '../kb/types';
import { type PublicMessage } from '../mesh/node';
import {
  type Choice,
  type DrillMsg,
  type DrillState,
  END_GRACE_MS,
  type Grade,
  JOIN_WINDOW_MS,
  PROMPT_MS,
  SCENARIO_IDS,
  type ScenarioId,
  bestChoice,
  leaderboard,
  newDrillId,
  parseDrillMessage,
  replay,
  scenarioById,
  scoreAnswer,
  serialiseDrillMessage,
} from '../services/familyDrill';
import * as haptics from '../services/haptics';
import { useMesh } from '../services/mesh';
import { useSettings } from '../state/settings';
import { radius } from '../theme';

// ---- copy (English / Hindi pairs) ----------------------------------------------------------

const PAIR_TITLE: T = ['Family drill', 'परिवार अभ्यास'];
const PAIR_TAG_NOTE: T = ['A practice only. It never triggers real alerts.', 'यह सिर्फ़ अभ्यास है। इससे असली अलर्ट नहीं बजते।'];
const PAIR_RANGE: T = ['Only phones within Bluetooth range get it.', 'सिर्फ़ ब्लूटूथ की दूरी में मौजूद फ़ोन इसे पाते हैं।'];
const PAIR_START: T = ['Start a drill for everyone nearby', 'आस-पास सबके लिए अभ्यास शुरू करें'];
const PAIR_CHOOSE: T = ['Choose a scenario', 'परिस्थिति चुनें'];
const PAIR_NO_RADIO: T = [
  'Bluetooth is off or not available here, so the drill cannot reach others.',
  'यहाँ ब्लूटूथ बंद है या उपलब्ध नहीं, इसलिए अभ्यास दूसरों तक नहीं पहुँचेगा।',
];
const PAIR_JOIN_LINE: T = ['{who} started a drill: {scenario}. Join?', '{who} ने अभ्यास शुरू किया: {scenario}। जुड़ें?'];
const PAIR_JOIN: T = ['Join', 'जुड़ें'];
const PAIR_NOT_NOW: T = ['Not now', 'अभी नहीं'];
const PAIR_QUESTION: T = ['Question', 'प्रश्न'];
const PAIR_NEXT: T = ['Next', 'आगे'];
const PAIR_FINISH: T = ['Finish', 'पूरा करें'];
const PAIR_LEAVE: T = ['Leave drill', 'अभ्यास छोड़ें'];
const PAIR_TIMES_UP: T = ['Time is up. No answer scores 0.', 'समय खत्म। बिना जवाब के 0 अंक।'];
const PAIR_GOOD: T = ['Good', 'बढ़िया'];
const PAIR_BETTER: T = ['Better:', 'और बेहतर:'];
const PAIR_POINTS: T = ['points', 'अंक'];
const PAIR_WAITING: T = ['Waiting for the others', 'बाक़ी लोगों का इंतज़ार'];
const PAIR_WAIT_NOTE: T = ['Scores come in as others finish. The board opens shortly.', 'बाक़ी लोग पूरा करेंगे तो अंक आएँगे। बोर्ड थोड़ी देर में खुलेगा।'];
const PAIR_SHOW_BOARD: T = ['Show scoreboard now', 'अभी स्कोरबोर्ड दिखाएँ'];
const PAIR_BOARD: T = ['Scoreboard', 'स्कोरबोर्ड'];
const PAIR_RUN_AGAIN: T = ['Run again', 'फिर से चलाएँ'];
const PAIR_AVG: T = ['avg reaction', 'औसत प्रतिक्रिया'];
const PAIR_ANSWERED: T = ['answered', 'जवाब दिए'];
const PAIR_YOU: T = ['you', 'आप'];
const PAIR_NOBODY: T = ['Nobody answered yet.', 'अभी किसी ने जवाब नहीं दिया।'];
const PAIR_ME: T = ['Me', 'मैं'];

const CHOICE_TINTS = ['blue', 'yellow', 'lilac'] as const;

// ---- join hook -----------------------------------------------------------------------------

/** Drill ids this phone has joined or dismissed. Lives in memory, so a restart offers the banner again. */
const useDismissed = create<{ ids: string[]; add: (id: string) => void }>((set) => ({
  ids: [],
  add: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
}));

/** The channel drills travel on: the same neighbourhood channel the community chat uses by default. */
function useDrillChannel(): string {
  const channels = useMesh((s) => s.channels);
  return channels[1] ?? channels[0] ?? 'geo:local';
}

function drillFeed(chat: PublicMessage[], channel: string) {
  const items: { msg: DrillMsg; ts: number }[] = [];
  const startTs: Record<string, number> = {};
  for (const m of chat) {
    if (m.channel !== channel && m.channel !== 'geo:local') continue;
    const msg = parseDrillMessage(m.text);
    if (!msg) continue;
    items.push({ msg, ts: m.timestamp });
    if (msg.t === 'start' && startTs[msg.id] === undefined) startTs[msg.id] = m.timestamp;
  }
  return { items, startTs };
}

export interface IncomingDrill {
  id: string;
  scenario: ScenarioId;
  by: string;
}

/**
 * The newest drill start that this phone has not joined or dismissed, not yet ended, and recent enough.
 * Any screen can use it to show a banner; the route itself only shows one while it is open.
 */
export function useIncomingDrill(): IncomingDrill | null {
  const channel = useDrillChannel();
  const chat = useMesh((s) => s.chat);
  const dismissed = useDismissed((s) => s.ids);
  return useMemo(() => {
    const { items, startTs } = drillFeed(chat, channel);
    const state = replay(items);
    const now = Date.now();
    let found: IncomingDrill | null = null;
    let foundTs = -Infinity;
    for (const d of Object.values(state.drills)) {
      const ts = startTs[d.id] ?? 0;
      if (d.ended || dismissed.includes(d.id)) continue;
      if (now - ts > JOIN_WINDOW_MS || ts - now > 60_000) continue; // allow a minute of clock skew
      if (ts > foundTs) {
        found = { id: d.id, scenario: d.scenario, by: d.by };
        foundTs = ts;
      }
    }
    return found;
  }, [chat, channel, dismissed]);
}

// ---- screen --------------------------------------------------------------------------------

interface LocalRun {
  id: string;
  scenario: ScenarioId;
  /** true on the phone that pressed start: it sends `end` after the grace period */
  host: boolean;
  index: number;
  shownAt: number;
  pick: { choiceId: string; grade: Grade; atMs: number } | null;
  finishedAt: number | null;
  endSent: boolean;
}

const freshRun = (id: string, scenario: ScenarioId, host: boolean): LocalRun => {
  const now = Date.now();
  return { id, scenario, host, index: 0, shownAt: now, pick: null, finishedAt: null, endSent: false };
};

export default function FamilyDrill() {
  const { p } = useTheme();
  const L = useLocal();
  const channel = useDrillChannel();
  const chat = useMesh((s) => s.chat);
  const radio = useMesh((s) => s.radioAvailable);
  const start = useMesh((s) => s.start);
  const refreshChannels = useMesh((s) => s.refreshChannels);
  const sendChat = useMesh((s) => s.sendChat);
  const nickname = useSettings((s) => s.nickname);
  const kidName = useSettings((s) => s.kidName);
  const me = (nickname || kidName || '').trim().slice(0, 32) || 'Me';

  const [scenario, setScenario] = useState<ScenarioId>('earthquake');
  const [run, setRun] = useState<LocalRun | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const incoming = useIncomingDrill();
  const dismissed = useDismissed((s) => s.ids);
  const dismiss = useDismissed((s) => s.add);

  useEffect(() => {
    void start().then(() => refreshChannels()).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const state: DrillState = useMemo(() => {
    const { items } = drillFeed(chat, channel);
    return replay(items);
  }, [chat, channel]);

  const rec = run ? state.drills[run.id] : undefined;
  const ended = !!rec?.ended || !!run?.endSent;
  const board = !!run && (ended || (!!run.finishedAt && now - run.finishedAt >= END_GRACE_MS));
  const ticking = !!run && !board;

  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [ticking]);

  const send = (msg: DrillMsg) => {
    const text = serialiseDrillMessage(msg);
    if (text) sendChat(channel, text, 'chat');
  };

  const endDrill = (id: string) => {
    send({ t: 'end', id });
    setRun((r) => (r && r.id === id ? { ...r, endSent: true } : r));
  };

  // the host closes the drill for everyone once the grace period after its own finish has passed
  useEffect(() => {
    if (!run || !run.host || !run.finishedAt || run.endSent) return;
    const t = setTimeout(() => endDrill(run.id), END_GRACE_MS);
    return () => clearTimeout(t);
  }, [run?.id, run?.host, run?.finishedAt, run?.endSent]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => {
    const id = newDrillId();
    send({ t: 'start', id, scenario, startedAt: Date.now(), by: me });
    dismiss(id);
    setRun(freshRun(id, scenario, true));
    haptics.success();
  };

  const join = (d: IncomingDrill) => {
    dismiss(d.id);
    setRun(freshRun(d.id, d.scenario, false));
  };

  const choose = (c: Choice) => {
    if (!run || run.pick || run.finishedAt) return;
    const atMs = Math.max(0, Date.now() - run.shownAt);
    if (atMs >= PROMPT_MS) return; // time is up for this question
    send({ t: 'answer', id: run.id, who: me, choiceId: c.id, atMs });
    setRun({ ...run, pick: { choiceId: c.id, grade: c.grade, atMs } });
    if (c.grade === 'best') haptics.success();
    else haptics.warn();
  };

  const next = () => {
    if (!run) return;
    const t = Date.now();
    if (run.index + 1 >= scenarioById(run.scenario).prompts.length) setRun({ ...run, pick: null, finishedAt: t });
    else setRun({ ...run, index: run.index + 1, shownAt: t, pick: null });
  };

  const DrillTag = (
    <Row style={{ gap: 8, flexWrap: 'wrap' }}>
      <Badge soft label="DRILL" color={p.tint.blue.ink} />
      <Txt size={12.5} color={p.muted} style={{ flex: 1 }}>
        {L(PAIR_TAG_NOTE)}
      </Txt>
    </Row>
  );

  // ---- start card ----
  if (!run) {
    return (
      <Screen title={L(PAIR_TITLE)}>
        <Appear>{DrillTag}</Appear>
        {incoming && !dismissed.includes(incoming.id) ? (
          <Appear>
            <Card tint="blue" style={{ gap: 12, padding: 16, borderRadius: 24 }}>
              <Badge soft label="DRILL" color={p.tint.blue.ink} />
              <Txt size={15} weight="600" color={p.tint.blue.ink}>
                {L(PAIR_JOIN_LINE).replace('{who}', incoming.by).replace('{scenario}', L(scenarioById(incoming.scenario).title))}
              </Txt>
              <Row style={{ gap: 8 }}>
                <Btn label={L(PAIR_JOIN)} size="sm" onPress={() => join(incoming)} />
                <Btn label={L(PAIR_NOT_NOW)} size="sm" kind="ghost" onPress={() => dismiss(incoming.id)} />
              </Row>
            </Card>
          </Appear>
        ) : null}
        <Appear index={1}>
          <Card style={{ gap: 14, padding: 16 }}>
            <Txt size={15} weight="600">
              {L(PAIR_CHOOSE)}
            </Txt>
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {SCENARIO_IDS.map((id) => (
                <Chip key={id} label={L(scenarioById(id).title)} active={scenario === id} onPress={() => setScenario(id)} />
              ))}
            </Row>
            <Txt size={12.5} color={p.muted}>
              {L(PAIR_RANGE)}
            </Txt>
            {radio ? null : (
              <Txt size={12.5} color={p.tint.pink.ink}>
                {L(PAIR_NO_RADIO)}
              </Txt>
            )}
            <Btn label={L(PAIR_START)} size="lg" onPress={begin} disabled={!radio} />
          </Card>
        </Appear>
      </Screen>
    );
  }

  const sc = scenarioById(run.scenario);
  const total = sc.prompts.length;

  // ---- scoreboard ----
  if (board) {
    const rows = leaderboard(state, run.id);
    return (
      <Screen title={L(PAIR_TITLE)}>
        <Appear>{DrillTag}</Appear>
        <Appear index={1}>
          <Card tint="yellow" style={{ gap: 4, padding: 16, borderRadius: 24 }}>
            <Badge soft label="DRILL" color={p.tint.yellow.ink} />
            <Txt size={19} weight="700" color={p.tint.yellow.ink}>
              {L(PAIR_BOARD)}
            </Txt>
            <Txt size={13} color={p.tint.yellow.ink}>
              {L(sc.title)}
            </Txt>
          </Card>
        </Appear>
        {rows.length === 0 ? (
          <Txt size={14} color={p.muted} style={{ textAlign: 'center', paddingVertical: 20 }}>
            {L(PAIR_NOBODY)}
          </Txt>
        ) : null}
        {rows.map((r, i) => {
          const tone = i === 0 ? 'green' : i === 1 ? 'blue' : 'lilac';
          const mine = r.who === me;
          return (
            <Appear key={r.who} index={i + 2}>
              <Card tint={tone} style={{ padding: 14, borderRadius: 24 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: 10, flex: 1 }}>
                    <Txt size={18} weight="700" color={p.tint[tone].ink}>
                      {i + 1}
                    </Txt>
                    <View style={{ flex: 1 }}>
                      <Txt size={15} weight="600" color={p.tint[tone].ink}>
                        {r.who}
                        {mine ? ` (${L(PAIR_YOU)})` : ''}
                      </Txt>
                      <Txt size={12} color={p.tint[tone].ink}>
                        {r.answered}/{total} {L(PAIR_ANSWERED)} · {L(PAIR_AVG)} {r.answered ? (r.avgMs / 1000).toFixed(1) : '–'} s
                      </Txt>
                    </View>
                  </Row>
                  <Txt size={20} weight="700" color={p.tint[tone].ink}>
                    {r.score}
                  </Txt>
                </Row>
              </Card>
            </Appear>
          );
        })}
        <Btn label={L(PAIR_RUN_AGAIN)} size="lg" onPress={() => setRun(null)} style={{ marginTop: 6 }} />
      </Screen>
    );
  }

  // ---- waiting ----
  if (run.finishedAt) {
    return (
      <Screen title={L(PAIR_TITLE)}>
        <Appear>{DrillTag}</Appear>
        <Appear index={1}>
          <Card style={{ alignItems: 'center', gap: 14, paddingVertical: 28, paddingHorizontal: 18 }}>
            <IconTile name="shield" tint="blue" size={60} />
            <Txt size={17} weight="600" style={{ textAlign: 'center' }}>
              {L(PAIR_WAITING)}
            </Txt>
            <Txt size={13} color={p.muted} style={{ textAlign: 'center' }}>
              {L(PAIR_WAIT_NOTE)}
            </Txt>
            {run.host ? <Btn label={L(PAIR_SHOW_BOARD)} kind="secondary" onPress={() => endDrill(run.id)} /> : null}
          </Card>
        </Appear>
      </Screen>
    );
  }

  // ---- live question ----
  const prompt = sc.prompts[run.index];
  const elapsed = now - run.shownAt;
  const remaining = Math.max(0, PROMPT_MS - elapsed);
  const timedOut = !run.pick && remaining <= 0;
  const locked = !!run.pick || timedOut;
  const best = bestChoice(run.scenario, run.index);
  const bestLabel = best ? L(best.label) : '';
  const revealed = run.pick ? scoreAnswer(run.pick.grade, run.pick.atMs) : 0;
  const ringColor = remaining > 5000 ? p.tint.blue.ink : p.tint.pink.ink;

  return (
    <Screen title={L(PAIR_TITLE)}>
      <Appear>{DrillTag}</Appear>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={13} weight="600" color={p.muted}>
          {L(sc.title)} · {L(PAIR_QUESTION)} {run.index + 1} / {total}
        </Txt>
        {locked ? null : (
          <Btn label={L(PAIR_LEAVE)} size="sm" kind="ghost" onPress={() => setRun(null)} />
        )}
      </Row>

      <Appear key={`q${run.index}`}>
        <Card style={{ alignItems: 'center', gap: 14, paddingVertical: 20, paddingHorizontal: 16 }}>
          <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={132} height={132}>
              <Circle cx={66} cy={66} r={56} stroke={p.border} strokeWidth={10} fill="none" />
              <Circle
                cx={66}
                cy={66}
                r={56}
                stroke={ringColor}
                strokeWidth={10}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 56}`}
                strokeDashoffset={2 * Math.PI * 56 * (1 - remaining / PROMPT_MS)}
                transform="rotate(-90 66 66)"
              />
            </Svg>
            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <Txt size={30} weight="700">
                {Math.ceil(remaining / 1000)}
              </Txt>
              <Txt size={11} color={p.muted}>
                s
              </Txt>
            </View>
          </View>
          <Txt size={17} weight="600" style={{ textAlign: 'center' }}>
            {L(prompt.question)}
          </Txt>
        </Card>
      </Appear>

      <View style={{ gap: 10 }}>
        {prompt.choices.map((c, k) => {
          const chosen = run.pick?.choiceId === c.id;
          const isBest = c.grade === 'best';
          const tone = run.pick || timedOut
            ? isBest
              ? 'green'
              : chosen
                ? 'pink'
                : CHOICE_TINTS[k % CHOICE_TINTS.length]
            : CHOICE_TINTS[k % CHOICE_TINTS.length];
          const ink = p.tint[tone].ink;
          return (
            <Appear key={`${run.index}-${c.id}`} index={k}>
              <Press accessibilityRole="button" accessibilityState={{ disabled: locked }} disabled={locked} onPress={() => choose(c)} haptic={false}>
                <Card tint={tone} style={{ padding: 14, borderRadius: 24, opacity: locked && !chosen && !isBest ? 0.6 : 1 }}>
                  <Txt size={15} weight="500" color={ink}>
                    {L(c.label)}
                  </Txt>
                </Card>
              </Press>
            </Appear>
          );
        })}
      </View>

      {locked ? (
        <Appear>
          <Card tint={run.pick?.grade === 'best' ? 'green' : 'peach'} style={{ gap: 8, padding: 14, borderRadius: radius.lg }}>
            {run.pick ? (
              <Txt size={15} weight="700" color={p.tint[run.pick.grade === 'best' ? 'green' : 'peach'].ink}>
                {run.pick.grade === 'best' ? L(PAIR_GOOD) : `${L(PAIR_BETTER)} ${bestLabel}`}
              </Txt>
            ) : (
              <Txt size={15} weight="700" color={p.tint.peach.ink}>
                {L(PAIR_TIMES_UP)} {L(PAIR_BETTER)} {bestLabel}
              </Txt>
            )}
            <Txt size={13.5} color={p.tint[run.pick?.grade === 'best' ? 'green' : 'peach'].ink}>
              {L(prompt.why)}
            </Txt>
            {run.pick ? (
              <Txt size={12.5} color={p.tint[run.pick.grade === 'best' ? 'green' : 'peach'].ink}>
                +{revealed} {L(PAIR_POINTS)} · {(run.pick.atMs / 1000).toFixed(1)} s
              </Txt>
            ) : null}
            <Btn label={run.index + 1 >= total ? L(PAIR_FINISH) : L(PAIR_NEXT)} onPress={next} style={{ marginTop: 4 }} />
          </Card>
        </Appear>
      ) : null}
    </Screen>
  );
}
