import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icon';
import { PixelAvatar, SPECIES, buddy } from '../../components/PixelAvatar';
import { Screen } from '../../components/Screen';
import { Stars } from '../../components/Stars';
import { Appear, Btn, Card, IconTile, Press, Row, type TintName, Txt, useTheme } from '../../components/ui';
import { type StringKey, useLocal, useT } from '../../i18n';
import { BAG_ITEMS, SAFE_CARDS } from '../../kb/kidDrills';
import { BAG_LIVES, DCH_MOVES, DCH_ROUNDS, bagIsOver, bagStars, dchStars, dchTap, dchTick, dchTimeLimit, isSafeAnswerRight, pickBagRound, pickSafeRound, safeStars, shuffle, type DchMove } from '../../kb/kidGames';
import { useSettings } from '../../state/settings';

/** Haptic tick on right or wrong answers, only when the child has haptics on. */
const buzz = (ok: boolean) => {
  if (Platform.OS !== 'web' && useSettings.getState().haptics) Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
};

// ---------- shared pieces ----------

/** Plain-language instructions with a big Start button. Every game opens with one. */
function Intro({ icon, tint, text, onStart }: { icon: IconName; tint: TintName; text: string; onStart: () => void }) {
  const t = useT();
  return (
    <Appear>
      <Card style={{ alignItems: 'center', gap: 16, paddingTop: 40, paddingBottom: 28, paddingHorizontal: 18 }}>
        <IconTile name={icon} tint={tint} size={72} />
        <Txt size={16} weight="500" style={{ textAlign: 'center' }}>
          {text}
        </Txt>
        <Btn label={t('gameStart')} size="lg" onPress={onStart} />
      </Card>
    </Appear>
  );
}

/** End screen: star rating, score, Play again and Back. Saves the best star count for this game. */
function Result({ id, stars, score, onAgain }: { id: string; stars: 1 | 2 | 3; score: string; onAgain: () => void }) {
  const { p } = useTheme();
  const t = useT();
  const avatar = useSettings((s) => s.kidAvatar);
  const setStars = useSettings((s) => s.setStars);
  useEffect(() => {
    setStars(`game-${id}`, stars);
  }, [id, stars, setStars]);
  return (
    <Appear>
      <Card style={{ alignItems: 'center', gap: 14, paddingTop: 36, paddingBottom: 24, paddingHorizontal: 18 }}>
        <PixelAvatar spec={buddy(SPECIES[avatar % SPECIES.length])} size={84} bg={p.tint.yellow.bg} animated />
        <Stars n={stars} size={28} />
        <Txt size={20} weight="600" style={{ textAlign: 'center' }}>
          {stars === 3 ? t('gameWellDone') : t('gameGoodTry')}
        </Txt>
        <Txt size={14} color={p.muted}>
          {t('gameScore')}: {score}
        </Txt>
        <Row style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Btn label={t('gamePlayAgain')} icon="refresh" kind="secondary" onPress={onAgain} />
          <Btn label={t('back')} onPress={() => router.back()} />
        </Row>
      </Card>
    </Appear>
  );
}

// ---------- 1. pack the go-bag ----------
function BagGame() {
  const { p } = useTheme();
  const L = useLocal();
  const t = useT();
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  const items = useMemo(() => pickBagRound(BAG_ITEMS), [round]);
  const [taken, setTaken] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const goodTotal = items.filter((i) => i.good).length;
  const packed = taken.filter((k) => items[k].good).length;
  const over = bagIsOver(mistakes, packed, goodTotal);

  const tap = (k: number) => {
    if (taken.includes(k) || over) return;
    const it = items[k];
    setTaken([...taken, k]);
    buzz(it.good);
    if (it.good) setMsg({ ok: true, text: t('gameBagGood') });
    else {
      setMistakes((m) => m + 1);
      setMsg({ ok: false, text: `${L(it.name)}: ${t('notNeeded')}` });
    }
  };

  const again = () => {
    setRound((r) => r + 1);
    setTaken([]);
    setMistakes(0);
    setMsg(null);
  };

  if (!started) return <Intro icon="learn" tint="green" text={t('gameBagHow')} onStart={() => setStarted(true)} />;
  if (over)
    return <Result id="bag" stars={bagStars(mistakes, packed === goodTotal)} score={`${packed} / ${goodTotal}`} onAgain={again} />;

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={14} weight="600">
          {t('gameScore')}: {packed} / {goodTotal}
        </Txt>
        <Row style={{ gap: 4 }}>
          {Array.from({ length: BAG_LIVES }, (_, i) => (
            <Icon key={i} name="heart" size={18} color={p.danger} fill={i < BAG_LIVES - mistakes ? p.danger : 'none'} />
          ))}
        </Row>
      </Row>
      <View style={{ minHeight: 40, justifyContent: 'center' }}>
        {msg ? (
          <Txt size={14} weight="600" color={msg.ok ? p.ok : p.danger} style={{ textAlign: 'center' }}>
            {msg.text}
          </Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((it, k) => {
          const gone = taken.includes(k);
          const col = gone ? (it.good ? p.ok : p.danger) : p.text;
          return (
            <Appear key={`${round}-${k}`} index={k} style={{ width: '31.5%' }}>
              <Press accessibilityRole="button" accessibilityLabel={L(it.name)} onPress={() => tap(k)} style={{ minHeight: 88 }}>
                <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 4, borderColor: gone ? col : p.border, opacity: gone && it.good ? 0.5 : 1 }}>
                  <Icon name={it.icon as IconName} size={24} color={col} />
                  <Txt size={12} style={{ textAlign: 'center' }} numberOfLines={2}>
                    {L(it.name)}
                  </Txt>
                </Card>
              </Press>
            </Appear>
          );
        })}
      </View>
    </View>
  );
}

// ---------- 2. safe or not ----------
function SafeGame() {
  const { p } = useTheme();
  const L = useLocal();
  const t = useT();
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState(0);
  const cards = useMemo(() => pickSafeRound(SAFE_CARDS), [round]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [ans, setAns] = useState<boolean | null>(null);

  if (!started) return <Intro icon="shield" tint="lilac" text={t('gameSafeHow')} onStart={() => setStarted(true)} />;
  if (i >= cards.length)
    return (
      <Result
        id="safe"
        stars={safeStars(score, cards.length)}
        score={`${score} / ${cards.length}`}
        onAgain={() => {
          setRound((r) => r + 1);
          setI(0);
          setScore(0);
          setAns(null);
        }}
      />
    );

  const c = cards[i];
  const answer = (v: boolean) => {
    if (ans !== null) return;
    setAns(v);
    const ok = isSafeAnswerRight(c, v);
    buzz(ok);
    if (ok) setScore((s) => s + 1);
  };
  const answered = ans !== null;
  const ok = answered && isSafeAnswerRight(c, ans);

  return (
    <View style={{ gap: 14 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={13} color={p.muted}>
          {i + 1} / {cards.length}
        </Txt>
        <Txt size={13} weight="600">
          {t('gameScore')}: {score}
        </Txt>
      </Row>
      <Appear key={i}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 30 }}>
          <Txt size={19} weight="600" style={{ textAlign: 'center', paddingHorizontal: 10 }}>
            {L(c.text)}
          </Txt>
        </Card>
      </Appear>
      <Row style={{ gap: 10 }}>
        {[true, false].map((v) => {
          const right = answered && v === c.safe;
          const wrongPick = answered && ans === v && v !== c.safe;
          return (
            <Press key={String(v)} accessibilityRole="button" accessibilityLabel={v ? t('gameSafeYes') : t('gameSafeNo')} onPress={() => answer(v)} disabled={answered} style={{ flex: 1, minHeight: 96, opacity: answered && !right && !wrongPick ? 0.4 : 1 }}>
              <Card style={{ alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 18, borderColor: right ? p.ok : wrongPick ? p.danger : p.border, flex: 1 }}>
                <Icon name={v ? 'check' : 'close'} size={22} color={v ? p.ok : p.danger} />
                <Txt size={14} weight="600">
                  {v ? t('gameSafeYes') : t('gameSafeNo')}
                </Txt>
              </Card>
            </Press>
          );
        })}
      </Row>
      {answered ? (
        <Appear>
          <View style={{ gap: 10 }}>
            <Card tint={ok ? 'green' : 'peach'}>
              <Txt size={14} weight="600" color={p.dark ? p.text : '#1D1D22'}>
                {ok ? t('gameRight') : t('gameNotQuite')}
              </Txt>
              <Txt size={13.5} color={p.dark ? p.text : '#1D1D22'} style={{ marginTop: 4 }}>
                {L(c.why)}
              </Txt>
            </Card>
            <Btn
              label={t('gameNext')}
              size="lg"
              onPress={() => {
                setAns(null);
                setI(i + 1);
              }}
            />
          </View>
        </Appear>
      ) : null}
    </View>
  );
}

// ---------- 3. drop, cover, hold ----------
const MOVE_KEY: Record<DchMove, StringKey> = { drop: 'gameMoveDrop', cover: 'gameMoveCover', hold: 'gameMoveHold' };

function DchGame() {
  const { p } = useTheme();
  const t = useT();
  const [phase, setPhase] = useState<'intro' | 'play' | 'end'>('intro');
  const [round, setRound] = useState(0);
  const [need, setNeed] = useState(0);
  const [wins, setWins] = useState(0);
  const limit = dchTimeLimit(round);
  const [left, setLeft] = useState(limit);
  const [order, setOrder] = useState<readonly DchMove[]>(() => shuffle(DCH_MOVES));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shake = useRef(new Animated.Value(0)).current;

  // gentle shake while the earthquake is on
  useEffect(() => {
    if (phase !== 'play') return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(shake, { toValue: 3, duration: 70, useNativeDriver: true }), Animated.timing(shake, { toValue: -3, duration: 70, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [phase, shake]);

  // each round: reset the bar and tick it down every 100 ms
  useEffect(() => {
    if (phase !== 'play') return;
    setLeft(limit);
    const h = setInterval(() => setLeft((l) => dchTick(l)), 100);
    return () => clearInterval(h);
  }, [phase, round, limit]);

  const endRound = (won: boolean) => {
    buzz(won);
    if (won) setWins((w) => w + 1);
    setMsg({ ok: won, text: won ? t('gameDchWon') : t('gameDchLost') });
    if (round + 1 >= DCH_ROUNDS) {
      setPhase('end');
      return;
    }
    setRound((r) => r + 1);
    setNeed(0);
    setOrder(shuffle(DCH_MOVES));
  };

  // time ran out: the round is lost
  useEffect(() => {
    if (phase === 'play' && left === 0) endRound(false);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = (move: DchMove) => {
    const r = dchTap(need, DCH_MOVES.indexOf(move));
    if (r === 'fail') return endRound(false);
    if (r === 'complete') return endRound(true);
    buzz(true);
    setNeed(need + 1);
  };

  if (phase === 'intro') return <Intro icon="mountain" tint="peach" text={t('gameDchHow')} onStart={() => setPhase('play')} />;
  if (phase === 'end')
    return (
      <Result
        id="dch"
        stars={dchStars(wins)}
        score={`${wins} / ${DCH_ROUNDS}`}
        onAgain={() => {
          setRound(0);
          setWins(0);
          setNeed(0);
          setMsg(null);
          setOrder(shuffle(DCH_MOVES));
          setPhase('play');
        }}
      />
    );

  return (
    <Animated.View style={{ gap: 14, transform: [{ translateX: shake }] }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={13} color={p.muted}>
          {t('gameScore')}: {wins} / {DCH_ROUNDS}
        </Txt>
        <Txt size={13} color={p.muted}>
          {round + 1} / {DCH_ROUNDS}
        </Txt>
      </Row>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: p.border, overflow: 'hidden' }}>
        <View style={{ width: `${(left / limit) * 100}%`, height: 6, backgroundColor: left < 1 ? p.danger : p.text }} />
      </View>
      <View style={{ minHeight: 40, justifyContent: 'center' }}>
        {msg ? (
          <Txt size={13.5} weight="600" color={msg.ok ? p.ok : p.danger} style={{ textAlign: 'center' }}>
            {msg.text}
          </Txt>
        ) : null}
      </View>
      <Txt size={26} weight="600" style={{ textAlign: 'center' }}>
        {t(MOVE_KEY[DCH_MOVES[need]])}
      </Txt>
      <View style={{ gap: 10 }}>
        {order.map((m) => (
          <Press key={m} accessibilityRole="button" accessibilityLabel={t(MOVE_KEY[m])} onPress={() => tap(m)} style={{ minHeight: 64 }}>
            <Card style={{ padding: 18 }}>
              <Row style={{ gap: 14 }}>
                <Icon name={m === 'drop' ? 'download' : m === 'cover' ? 'shield' : 'lock'} size={22} />
                <Txt size={17} weight="600">
                  {t(MOVE_KEY[m])}
                </Txt>
              </Row>
            </Card>
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}

// ---------- screen ----------
const TITLE: Record<string, StringKey> = { bag: 'gameBagTitle', safe: 'gameSafeTitle', dch: 'gameDchTitle' };

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const key = TITLE[String(id)];
  if (!key)
    return (
      <Screen title={t('back')}>
        <Txt size={16} style={{ textAlign: 'center', paddingTop: 30 }}>
          {t('gameNotFound')}
        </Txt>
      </Screen>
    );
  return (
    <Screen title={t(key)} mode="kid">
      {String(id) === 'bag' ? <BagGame /> : String(id) === 'safe' ? <SafeGame /> : <DchGame />}
    </Screen>
  );
}
