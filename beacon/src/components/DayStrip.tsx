import React from 'react';
import { View } from 'react-native';
import { Icon } from './Icon';
import { Appear, Txt, useTheme } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today 25 Oct", for the header under the greeting. */
export function dateLine(): string {
  const d = new Date();
  return `Today ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Three days either side of today as tall pills. Today is solid (black, or white in dark mode) with a filled star above it.
 * `doneDays` takes local `yyyy-m-d` keys; those past days show an outlined star. The app keeps no per-day history,
 * so screens pass nothing and only today is marked.
 */
export function DayStrip({ doneDays = [] }: { doneDays?: string[] }) {
  const { p } = useTheme();
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const days = [-3, -2, -1, 0, 1, 2, 3].map((o) => {
    const d = new Date(base);
    d.setDate(base.getDate() + o);
    return { key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, wd: WEEKDAYS[d.getDay()], n: d.getDate(), today: o === 0 };
  });
  const todayBg = p.dark ? '#FFFFFF' : '#000000';
  const todayFg = p.dark ? '#000000' : '#FFFFFF';

  return (
    <Appear>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {days.map((d, i) => {
          const done = doneDays.includes(d.key);
          return (
            <Appear key={d.key} index={i} style={{ flex: 1 }}>
              <View style={{ alignItems: 'center', gap: 6 }} accessibilityLabel={`${d.wd} ${d.n}${d.today ? ', today' : ''}`}>
                <View style={{ height: 16, justifyContent: 'center' }}>
                  {d.today ? (
                    <Icon name="star" size={14} color="#E9B44C" fill="#E9B44C" />
                  ) : done ? (
                    <Icon name="star" size={14} color={p.muted} strokeWidth={1.6} fill="none" />
                  ) : null}
                </View>
                <View
                  style={{
                    width: '100%',
                    height: 68,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    backgroundColor: d.today ? todayBg : p.card,
                    borderWidth: d.today ? 0 : 1,
                    borderColor: p.border,
                  }}>
                  <Txt size={11.5} weight="500" color={d.today ? todayFg : p.muted}>
                    {d.wd}
                  </Txt>
                  <Txt size={18} weight="700" color={d.today ? todayFg : p.text}>
                    {d.n}
                  </Txt>
                </View>
              </View>
            </Appear>
          );
        })}
      </View>
    </Appear>
  );
}
