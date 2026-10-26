import { Linking, View } from 'react-native';
import React, { useMemo } from 'react';
import { Screen } from '../components/Screen';
import { Switch } from '../components/Switch';
import { Appear, Btn, Card, Row, SectionTitle, Txt, useTheme } from '../components/ui';
import { relativeTime, useLang, useLocal } from '../i18n';
import { compareVersions, currentVersion } from '../services/updates';
import { useUpdateCheck, useUpdates } from '../state/updates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const STEPS: readonly (readonly [string, string])[] = [
  ['Download: tap Download update and wait for the file.', 'डाउनलोड: "Download update" दबाएँ और फ़ाइल आने तक रुकें।'],
  ['Open the file: tap the notification, or open Downloads.', 'फ़ाइल खोलें: नोटिफ़िकेशन दबाएँ, या डाउनलोड फ़ोल्डर खोलें।'],
  ['If asked, allow installs from this source.', 'अगर पूछे, तो इस स्रोत से इंस्टॉल की अनुमति दें।'],
  ['Install: tap Install, then Open.', 'इंस्टॉल: "Install" दबाएँ, फिर "Open" दबाएँ।'],
];

export default function UpdateScreen() {
  const { p } = useTheme();
  const local = useLocal();
  const lang = useLang();
  const { latest, status, check } = useUpdateCheck();
  const includeBeta = useUpdates((s) => s.includeBeta);
  const setIncludeBeta = useUpdates((s) => s.setIncludeBeta);
  const lastCheckedAt = useUpdates((s) => s.lastCheckedAt);
  const current = useMemo(() => currentVersion(), []);

  const newer = latest && compareVersions(latest.version, current) > 0 ? latest : null;
  const checking = status === 'checking';

  const statusLine = (() => {
    if (checking) return local(['Checking…', 'जाँच हो रही है…'] as const);
    if (status === 'offline') return local(['You are offline. Connect to the internet and check again.', 'आप ऑफ़लाइन हैं। इंटरनेट से जुड़कर फिर जाँचें।'] as const);
    if (status === 'rate-limited') return local(['The update server is busy for now. Try again later.', 'अपडेट सर्वर अभी व्यस्त है। बाद में फिर कोशिश करें।'] as const);
    if (status === 'error') return local(['Could not read the update list. Try again later.', 'अपडेट की सूची नहीं पढ़ी जा सकी। बाद में फिर कोशिश करें।'] as const);
    if (!newer && (status === 'current' || status === 'available')) return local(['You have the latest version.', 'आपके पास नवीनतम वर्ज़न है।'] as const);
    return null;
  })();

  const sha = newer?.sha256 ?? null;
  const shortSha = sha ? `${sha.slice(0, 8)}…${sha.slice(-8)}` : null;

  return (
    <Screen title={local(['Update', 'अपडेट'] as const)}>
      <Appear>
        <Card tint="lilac" style={{ gap: 4 }}>
          <Txt size={13}>{local(['Installed version', 'इंस्टॉल वर्ज़न'] as const)}</Txt>
          <Txt size={30} weight="700">
            {current}
          </Txt>
        </Card>
      </Appear>

      {newer ? (
        <>
          <SectionTitle>{local(['Latest version', 'नवीनतम वर्ज़न'] as const)}</SectionTitle>
          <Card style={{ gap: 8 }}>
            <Txt size={18} weight="700">
              {newer.version}
            </Txt>
            <Txt size={13} color={p.muted}>
              {[
                shortDate(newer.publishedAt),
                newer.sizeBytes > 0 ? `${(newer.sizeBytes / 1048576).toFixed(1)} MB` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Txt>
            {newer.notes ? (
              <Txt size={14} style={{ marginTop: 4 }}>
                {newer.notes}
              </Txt>
            ) : null}
            <Txt size={12} color={p.muted} style={{ marginTop: 4 }}>
              {shortSha
                ? `SHA-256: ${shortSha}`
                : local(['SHA-256: not published with this release', 'SHA-256: इस रिलीज़ के साथ नहीं दिया गया'] as const)}
            </Txt>
          </Card>

          <Btn
            label={local(['Download update', 'अपडेट डाउनलोड करें'] as const)}
            icon="download"
            onPress={() => void Linking.openURL(newer.url).catch(() => undefined)}
          />
        </>
      ) : null}

      <SectionTitle>{local(['How to install', 'इंस्टॉल कैसे करें'] as const)}</SectionTitle>
      <Card style={{ gap: 10 }}>
        {STEPS.map((s, i) => (
          <Txt key={s[0]} size={14}>
            {`${i + 1}  `}
            {local(s)}
          </Txt>
        ))}
      </Card>

      <SectionTitle>{local(['Check', 'जाँच'] as const)}</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Btn
          kind="secondary"
          label={checking ? local(['Checking…', 'जाँच हो रही है…'] as const) : local(['Check again', 'फिर से जाँचें'] as const)}
          disabled={checking}
          onPress={() => void check(true)}
        />
        {statusLine ? (
          <Txt size={13.5} color={p.muted}>
            {statusLine}
          </Txt>
        ) : null}
        {lastCheckedAt ? (
          <Txt size={12} color={p.muted}>
            {local([`Last checked ${relativeTime(lastCheckedAt, lang)}`, `आखिरी जाँच ${relativeTime(lastCheckedAt, lang)}`] as const)}
          </Txt>
        ) : null}
        <View style={{ height: 1, backgroundColor: p.border }} />
        <Row style={{ justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt size={15} weight="600">
              {local(['Include test versions', 'टेस्ट वर्ज़न शामिल करें'] as const)}
            </Txt>
            <Txt size={12.5} color={p.muted}>
              {local(['Beta builds may have bugs.', 'बीटा बिल्ड में गड़बड़ियाँ हो सकती हैं।'] as const)}
            </Txt>
          </View>
          <Switch
            value={includeBeta}
            accessibilityLabel={local(['Include test versions', 'टेस्ट वर्ज़न शामिल करें'] as const)}
            onValueChange={(on) => {
              setIncludeBeta(on);
              void check(true);
            }}
          />
        </Row>
      </Card>

      <Card tint="yellow" style={{ gap: 6 }}>
        <Txt size={13.5}>
          {local([
            'Updates replace the app but keep your data. If the install says the app was signed differently, the old copy was a developer build: back up what you need and uninstall it once.',
            'अपडेट ऐप को बदलता है, पर आपका डेटा रखता है। अगर इंस्टॉल कहे कि ऐप अलग तरीके से साइन किया गया है, तो पुरानी कॉपी डेवलपर बिल्ड थी: जो चाहिए उसका बैकअप लें और उसे एक बार अनइंस्टॉल करें।',
          ] as const)}
        </Txt>
      </Card>
    </Screen>
  );
}
