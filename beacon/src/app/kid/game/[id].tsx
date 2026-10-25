import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, View } from 'react-native';
import { Icon, type IconName } from '../../../components/Icon';
import { PixelAvatar, SPECIES, buddy } from '../../../components/PixelAvatar';
import { Screen } from '../../../components/Screen';
import { Stars } from '../../../components/Stars';
import { Appear, Btn, Card, IconTile, Press, Row, Txt, useTheme } from '../../../components/ui';
import { useLocal, useT } from '../../../i18n';
import { BAG_ITEMS, SAFE_CARDS } from '../../../kb/kidDrills';
import { useSettings } from '../../../state/settings';

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
const buzz = (ok: boolean) => {
  if (Platform.OS !== 'web' && useSettings.getState().haptics) Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
};

function Result({ stars, id, onAgain }: { stars: number; id: string; onAgain: () => void }) {
  const { p } = useTheme();
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const avatar = useSettings((s) => s.kidAvatar);
  const setStars = useSettings((s) => s.setStars);
  useEffect(() => setStars('game-' + id, stars), [id, stars, setStars]);
  return (
    <Appear>
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 30 }}>
        <PixelAvatar spec={buddy(SPECIES[avatar % SPECIES.length])} size={84} bg={p.tint.yellow.bg} animated />
        <Stars n={stars} size={26} />
        <Txt size={20} weight="600">
          {lang === 'hi' ? 'शाबाश!' : 'Well done!'}
        </Txt>
        <Row style={{ gap: 8 }}>
          <Btn label={lang === 'hi' ? 'फिर से' : 'Play again'} icon="refresh" kind="secondary" onPress={onAgain} />
          <Btn label={t('done')} onPress={() => router.back()} />
        </Row>
      </View>
    </Appear>
  );
}

// ---------- 1. pack the go-bag ----------
function BagGame() {
  const { p } = useTheme();
  const L = useLocal();
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const [round, setRound] = useState(0);
  const items = useMemo(() => shuffle([...shuffle(BAG_ITEMS.filter((i) => i.good)).slice(0, 6), ...shuffle(BAG_ITEMS.filter((i) => !i.good)).slice(0, 5)]), [round]);
  const [taken, setTaken] = useState<Set<number>>(new Set());
  const [lives, setLives] = useState(3);
  const [msg, setMsg] = useState('');
  const good = items.filter((i) => i.good).length;
  const packed = [...taken].filter((i) => items[i].good).length;
  const mistakes = 3 - lives;
  const over = lives === 0 || packed === good;

  const tap = (k: number) => {
    if (taken.has(k) || over) return;
    const it = items[k];
    setTaken(new Set([...taken, k]));
    buzz(it.good);
    if (!it.good) {
      setLives((l) => l - 1);
      setMsg(`${L(it.name)}: ${t('notNeeded')}`);
    } else setMsg('');
  };

  if (over)
    return (
      <Result
        id="bag"
        stars={lives === 0 ? 1 : mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1}
        onAgain={() => {
          setRound((r) => r + 1);
          setTaken(new Set());
          setLives(3);
          setMsg('');
        }}
      />
    );
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 6 }}>
          <Icon name="learn" size={15} color={p.muted} />
          <Txt size={13} weight="500">
            {packed}/{good}
          </Txt>
        </Row>
        <Row style={{ gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <Icon key={i} name="heart" size={15} color={p.danger} fill={i < lives ? p.danger : 'none'} />
          ))}
        </Row>
      </Row>
      <Txt size={13} color={p.muted}>
        {lang === 'hi' ? 'सिर्फ़ वही चुनो जो आपात स्थिति में ज़रूरी है।' : 'Tap only what you would need in an emergency.'}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((it, k) => {
          const gone = taken.has(k);
          return (
            <Appear key={`${round}-${k}`} index={k} style={{ width: '31.5%' }}>
              <Press accessibilityRole="button" accessibilityLabel={L(it.name)} onPress={() => tap(k)}>
                <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 4, borderColor: gone ? (it.good ? p.ok : p.danger) : p.border, opacity: gone && it.good ? 0.5 : 1 }}>
                  <Icon name={it.icon as IconName} size={22} color={gone ? (it.good ? p.ok : p.danger) : p.text} />
                  <Txt size={11} style={{ textAlign: 'center' }} numberOfLines={2}>
                    {L(it.name)}
                  </Txt>
                </Card>
              </Press>
            </Appear>
          );
        })}
      </View>
      {msg ? (
        <Txt size={12.5} weight="500" color={p.danger} style={{ textAlign: 'center' }}>
          {msg}
        </Txt>
      ) : null}
    </View>
  );
}

// ---------- 2. safe or not ----------
function SafeGame() {
  const { p } = useTheme();
  const L = useLocal();
  const lang = useSettings((s) => s.lang);
  const [round, setRound] = useState(0);
  const cards = useMemo(() => shuffle(SAFE_CARDS).slice(0, 8), [round]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [ans, setAns] = useState<boolean | null>(null);
  if (i >= cards.length)
    return (
      <Result
        id="safe"
        stars={score >= cards.length ? 3 : score >= cards.length - 2 ? 2 : 1}
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
    const ok = v === c.safe;
    buzz(ok);
    if (ok) setScore((s) => s + 1);
  };
  return (
    <View style={{ gap: 14 }}>
      <Txt size={12} color={p.muted} style={{ textAlign: 'center' }}>
        {i + 1} / {cards.length}
      </Txt>
      <Appear key={i}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 30 }}>
          <Txt size={19} weight="600" style={{ textAlign: 'center', paddingHorizontal: 10 }}>
            {L(c.text)}
          </Txt>
        </Card>
      </Appear>
      <Row style={{ gap: 10 }}>
        {[true, false].map((v) => {
          const chosen = ans === v;
          const right = ans !== null && v === c.safe;
          return (
            <Press key={String(v)} accessibilityRole="button" onPress={() => answer(v)} style={{ flex: 1, opacity: ans !== null && !chosen && !right ? 0.4 : 1 }}>
              <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 16, borderColor: right ? p.ok : chosen ? p.danger : p.border }}>
                <Icon name={v ? 'check' : 'close'} size={20} color={v ? p.ok : p.danger} />
                <Txt size={13.5} weight="600">
                  {v ? (lang === 'hi' ? 'सुरक्षित' : 'Safe') : lang === 'hi' ? 'सुरक्षित नहीं' : 'Not safe'}
                </Txt>
              </Card>
            </Press>
          );
        })}
      </Row>
      {ans !== null ? (
        <Appear>
          <View style={{ gap: 10 }}>
            <Card tint={ans === c.safe ? 'green' : 'peach'}>
              <Txt size={13.5} color={p.dark ? p.text : '#1D1D22'}>
                {L(c.why)}
              </Txt>
            </Card>
            <Btn
              label={lang === 'hi' ? 'अगला' : 'Next'}
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
const MOVES: { key: string; icon: IconName; en: string; hi: string }[] = [
  { key: 'drop', icon: 'download', en: 'DROP', hi: 'झुको' },
  { key: 'cover', icon: 'shield', en: 'COVER', hi: 'ढको' },
  { key: 'hold', icon: 'lock', en: 'HOLD ON', hi: 'पकड़ो' },
];

function DchGame() {
  const { p } = useTheme();
  const lang = useSettings((s) => s.lang);
  const [phase, setPhase] = useState<'ready' | 'play' | 'end'>('ready');
  const [round, setRound] = useState(0);
  const [need, setNeed] = useState(0);
  const [win, setWin] = useState(0);
  const [left, setLeft] = useState(4);
  const [order, setOrder] = useState(() => shuffle(MOVES));
  const shake = useRef(new Animated.Value(0)).current;
  const limit = [4, 3, 2.4][Math.min(round, 2)];
  const rounds = 3;

  useEffect(() => {
    if (phase !== 'play') return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(shake, { toValue: 3, duration: 70, useNativeDriver: true }), Animated.timing(shake, { toValue: -3, duration: 70, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [phase, shake]);

  useEffect(() => {
    if (phase !== 'play') return;
    setLeft(limit);
    const h = setInterval(() => setLeft((l) => Math.max(0, +(l - 0.1).toFixed(1))), 100);
    return () => clearInterval(h);
  }, [phase, round, limit]);

  useEffect(() => {
    if (phase === 'play' && left === 0) fail();
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextRound = (won: boolean) => {
    if (won) setWin((w) => w + 1);
    if (round + 1 >= rounds) setPhase('end');
    else {
      setRound((r) => r + 1);
      setNeed(0);
      setOrder(shuffle(MOVES));
    }
  };
  const fail = () => {
    buzz(false);
    nextRound(false);
  };
  const tap = (k: number) => {
    if (k !== need) return fail();
    buzz(true);
    if (need === 2) nextRound(true);
    else setNeed(need + 1);
  };

  if (phase === 'end')
    return (
      <Result
        id="dch"
        stars={Math.max(1, win)}
        onAgain={() => {
          setRound(0);
          setWin(0);
          setNeed(0);
          setOrder(shuffle(MOVES));
          setPhase('ready');
        }}
      />
    );
  if (phase === 'ready')
    return (
      <Appear>
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 30 }}>
          <IconTile name="mountain" tint="peach" size={64} />
          <Txt size={16} weight="500" style={{ textAlign: 'center', paddingHorizontal: 10 }}>
            {lang === 'hi' ? 'भूकंप! सही क्रम में टैप करो: झुको, ढको, पकड़ो' : 'Earthquake! Tap in the right order: drop, cover, hold on.'}
          </Txt>
          <Btn label={lang === 'hi' ? 'शुरू' : 'Start'} onPress={() => setPhase('play')} />
        </View>
      </Appear>
    );
  return (
    <Animated.View style={{ gap: 14, transform: [{ translateX: shake }] }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: p.border, overflow: 'hidden' }}>
        <View style={{ width: `${(left / limit) * 100}%`, height: 4, backgroundColor: left < 1 ? p.danger : p.text }} />
      </View>
      <Txt size={26} weight="600" style={{ textAlign: 'center' }}>
        {lang === 'hi' ? MOVES[need].hi : MOVES[need].en}
      </Txt>
      <Txt size={12} color={p.muted} style={{ textAlign: 'center' }}>
        {round + 1} / {rounds} · {need} / 3
      </Txt>
      <View style={{ gap: 10 }}>
        {order.map((m) => (
          <Press key={m.key} accessibilityRole="button" onPress={() => tap(MOVES.findIndex((x) => x.key === m.key))}>
            <Card style={{ padding: 16 }}>
              <Row style={{ gap: 14 }}>
                <Icon name={m.icon} size={20} />
                <Txt size={16} weight="600">
                  {lang === 'hi' ? m.hi : m.en}
                </Txt>
              </Row>
            </Card>
          </Press>
        ))}
      </View>
    </Animated.View>
  );
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const L = useLocal();
  const title = id === 'bag' ? (['Pack the go-bag', 'गो-बैग भरो'] as const) : id === 'safe' ? (['Safe or not?', 'सुरक्षित या नहीं?'] as const) : (['Drop, cover, hold', 'झुको, ढको, पकड़ो'] as const);
  return <Screen title={L(title)}>{id === 'bag' ? <BagGame /> : id === 'safe' ? <SafeGame /> : <DchGame />}</Screen>;
}
