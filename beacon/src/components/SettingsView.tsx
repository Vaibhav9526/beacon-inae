import { router } from 'expo-router';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { needleStatus, needleSupported, startNeedle } from '../ai/needle';
import { DISCLAIMER } from '../kb';
import { useLang, useT } from '../i18n';
import { cloud, cloudConfigured } from '../services/cloud';
import { resetTtsStatus, ttsStatus, type VoiceRole, useEleven } from '../services/elevenlabs';
import { speak } from '../services/speech';
import { setLifeboat } from '../services/lifeboat';
import { useMesh } from '../services/mesh';
import { visionStatus } from '../services/vision';
import { voiceStatus, voiceSupported } from '../services/voice';
import { useLifeboat } from '../state/lifeboat';
import Constants from 'expo-constants';
import { useQuakeSettings } from '../state/quakeSettings';
import { useSettings } from '../state/settings';
import { radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { PhotoHelperCard } from './PhotoHelperCard';
import { Switch } from './Switch';
import { Btn, Card, Chip, Row, Txt, type TintName } from './ui';

/** One label + switch row. Text takes the ink of the tinted tile it sits in. */
function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt size={14} weight="500">
          {label}
        </Txt>
        {hint ? (
          <Txt size={11.5} style={{ opacity: 0.75 }}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </Row>
  );
}

/** Shake warning switch and its How it works link, shown in the Safety tile. */
function QuakeRow() {
  const lang = useLang();
  const enabled = useQuakeSettings((x) => x.enabled);
  const setEnabled = useQuakeSettings((x) => x.set);
  return (
    <View style={{ gap: 8 }}>
      <Toggle
        label={lang === 'hi' ? 'शेक वॉर्निंग' : 'Shake warning'}
        value={enabled}
        onChange={setEnabled}
        hint={lang === 'hi' ? 'पास के फ़ोन झटके पर सहमत हों तो चेतावनी। आधिकारिक अलर्ट का विकल्प नहीं।' : 'Nearby phones agree on strong shaking and warn you. Not a substitute for official alerts.'}
      />
      <Row style={{ justifyContent: 'flex-end' }}>
        <Btn size="sm" kind="secondary" label={lang === 'hi' ? 'यह कैसे काम करता है' : 'How it works'} onPress={() => router.push('/quake' as never)} />
      </Row>
    </View>
  );
}

/** Lifeboat mode switch and its Open link, shown in the Safety tile. */
function LifeboatRow() {
  const active = useLifeboat((x) => x.active);
  return (
    <View style={{ gap: 8 }}>
      <Toggle
        label="Lifeboat mode"
        value={active}
        onChange={(x) => setLifeboat(x)}
        hint="Makes the battery last longer: slower checks and no wake word. SOS and shake stay on."
      />
      <Row style={{ justifyContent: 'flex-end' }}>
        <Btn size="sm" kind="secondary" label="Open" onPress={() => router.push('/lifeboat' as never)} />
      </Row>
    </View>
  );
}

/** Header row of a settings tile: a white icon well and a bold title. */
function Head({ icon, title }: { icon: IconName; title: string }) {
  return (
    <Row style={{ gap: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color="#17171B" />
      </View>
      <Txt size={17} weight="700" style={{ flex: 1 }}>
        {title}
      </Txt>
    </Row>
  );
}

/** A rounded, vivid tile that groups one theme of settings. The tint sets the colour; the ink follows it. */
function Tile({ tint, children }: { tint: TintName; children: React.ReactNode }) {
  return (
    <Card tint={tint} style={{ gap: 12, padding: 16, borderRadius: 28 }}>
      {children}
    </Card>
  );
}

export function SettingsView() {
  const t = useT();
  const lang = useLang();
  const s = useSettings();
  const mesh = useMesh();
  const eleven = useEleven();
  const [url, setUrl] = useState(s.serverUrl);
  const [key, setKey] = useState(s.serverKey);
  const [xi, setXi] = useState('');
  const [xiMsg, setXiMsg] = useState('');
  const [voiceMsg, setVoiceMsg] = useState('');
  const [test, setTest] = useState('');
  const [vision, setVision] = useState('');
  const v = voiceSupported() ? voiceStatus() : null;

  React.useEffect(() => {
    void eleven.load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveServer = async () => {
    s.set({ serverUrl: url.trim(), serverKey: key.trim() });
    setTest('…');
    try {
      const r = await cloud.get<{ ok: boolean }>('/health');
      const pk = await cloud.get<{ publicKey: string }>('/v1/pubkey');
      if (!key.trim()) {
        s.set({ serverKey: pk.publicKey });
        setKey(pk.publicKey);
      }
      setTest(r.ok ? 'connected' : 'not reachable');
    } catch (e) {
      setTest((e as Error).message);
    }
  };

  const saveXi = async () => {
    setXiMsg('…');
    try {
      const r = await eleven.save(xi);
      if (r.ok) {
        setXi('');
        setXiMsg(
          r.voicesListed === false
            ? 'Key saved. Speech works. (Your key cannot list voices, so default voices are used.) / कुंजी सेव हो गई। बोलना काम करता है। (आपकी कुंजी आवाज़ों की सूची नहीं देख सकती, इसलिए डिफ़ॉल्ट आवाज़ें उपयोग होंगी।)'
            : 'Key saved. Speech works. / कुंजी सेव हो गई। बोलना काम करता है।',
        );
      } else {
        setXiMsg(`Key not saved: ${r.error ?? 'failed'} / कुंजी सेव नहीं हुई`);
      }
    } catch (e) {
      setXiMsg(`Key not saved: ${(e as Error).message ?? e} / कुंजी सेव नहीं हुई`);
    }
  };

  const testVoiceXi = async () => {
    setVoiceMsg('…');
    resetTtsStatus();
    try {
      await speak('Hello from Beacon', 'en', 'default');
      const st = ttsStatus();
      if (!st) setVoiceMsg('Speech did not start, the phone voice was used. / आवाज़ शुरू नहीं हुई');
      else if (st.ok) setVoiceMsg('It worked. / काम कर गया');
      else setVoiceMsg(`${st.reason ?? 'ElevenLabs failed'}, the phone voice was used. / आवाज़ नहीं चली, फ़ोन की आवाज़ उपयोग हुई`);
    } catch (e) {
      setVoiceMsg(`${(e as Error).message ?? e} / आवाज़ नहीं चली`);
    }
  };

  // text fields on a vivid tile: a soft white well with dark text, readable in both themes
  const input = { backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: radius.md, paddingHorizontal: 12, height: 40, color: '#17171B', fontSize: 13, fontFamily: 'Poppins_400Regular', paddingVertical: 0 } as const;
  const roles: VoiceRole[] = ['didi', 'asha', 'veer'];
  const divider = { height: 1, backgroundColor: 'rgba(0,0,0,0.12)' } as const;

  return (
    <View style={{ gap: 12 }}>
      {/* Look & language */}
      <Tile tint="lilac">
        <Head icon="language" title={lang === 'hi' ? 'रूप और भाषा' : 'Look and language'} />
        <Row style={{ gap: 6 }}>
          <Chip label="English" active={lang === 'en'} onPress={() => s.set({ lang: 'en' })} />
          <Chip label="हिन्दी" active={lang === 'hi'} onPress={() => s.set({ lang: 'hi' })} />
        </Row>
        <Row style={{ gap: 6 }}>
          {(['system', 'light', 'dark'] as const).map((a) => (
            <Chip key={a} label={a} icon={a === 'dark' ? 'moon' : a === 'light' ? 'sun' : 'phoneMobile'} active={s.appearance === a} onPress={() => s.set({ appearance: a })} />
          ))}
        </Row>
        <Toggle label={t('largeText')} value={s.largeText} onChange={(x) => s.set({ largeText: x })} />
        <Toggle label={t('highContrast')} value={s.highContrast} onChange={(x) => s.set({ highContrast: x })} />
        <Toggle label={t('haptics')} value={s.haptics} onChange={(x) => s.set({ haptics: x })} />
      </Tile>

      {/* Voice */}
      <Tile tint="blue">
        <Head icon="speaker" title="Voice" />
        <Toggle label={t('readAloudSetting')} value={s.readAloud} onChange={(x) => s.set({ readAloud: x })} />
        {s.mode !== 'kid' ? <Toggle label={t('voiceControl')} value={s.voiceControl} onChange={(x) => s.set({ voiceControl: x })} hint={v ? (v.onDevice ? 'on-device' : v.available ? 'uses the offline pack when installed' : t('voiceUnavailable')) : t('voiceUnavailable')} /> : null}
        <Row style={{ gap: 8 }}>
          <Icon name="mic" size={14} />
          <Txt size={13} weight="600" style={{ flex: 1 }}>
            ElevenLabs voices
          </Txt>
          <Txt size={12} weight="600" style={{ opacity: eleven.has ? 1 : 0.7 }}>
            {eleven.has ? 'on' : 'off'}
          </Txt>
        </Row>
        <Txt size={11.5} style={{ opacity: 0.8 }}>
          Natural Hindi and English speech and transcription. The key stays in this phone's secure storage. Without it the phone's own voice is used.
        </Txt>
        {eleven.has ? (
          <View style={{ gap: 8 }}>
            {roles.map((r) => (
              <Row key={r} style={{ justifyContent: 'space-between' }}>
                <Txt size={12.5} style={{ textTransform: 'capitalize', opacity: 0.85 }}>
                  {r}
                </Txt>
                <Btn size="sm" kind="secondary" icon="speaker" label={eleven.voices[r]?.name ?? '—'} onPress={() => void speak(lang === 'hi' ? 'नमस्ते, मैं आपकी मदद के लिए यहाँ हूँ।' : 'Hello, I am here to help.', lang, r)} />
              </Row>
            ))}
            <Row>
              <Btn size="sm" kind="secondary" icon="speaker" label="Test voice" onPress={() => void testVoiceXi()} />
              {voiceMsg ? (
                <Txt size={12} style={{ opacity: 0.85, flexShrink: 1 }}>
                  {voiceMsg}
                </Txt>
              ) : null}
            </Row>
            {xiMsg ? (
              <Txt size={12} style={{ opacity: 0.85 }}>
                {xiMsg}
              </Txt>
            ) : null}
            {!eleven.voicesListed ? (
              <Txt size={11.5} style={{ opacity: 0.8 }}>
                Your key cannot list voices, so default voices are used. / आपकी कुंजी आवाज़ों की सूची नहीं देख सकती, इसलिए डिफ़ॉल्ट आवाज़ें उपयोग होंगी।
              </Txt>
            ) : null}
            <Btn size="sm" kind="ghost" label={t('remove')} onPress={() => void eleven.clear()} />
          </View>
        ) : (
          <>
            <TextInput value={xi} onChangeText={setXi} placeholder="ElevenLabs API key" placeholderTextColor="#5B6490" autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
            <Row>
              <Btn size="sm" label={t('save')} onPress={() => void saveXi()} disabled={!xi.trim()} />
              {xiMsg ? (
                <Txt size={12} style={{ opacity: 0.85 }}>
                  {xiMsg}
                </Txt>
              ) : null}
            </Row>
          </>
        )}
      </Tile>

      {/* Safety & alerts (not shown in kid mode) */}
      {s.mode !== 'kid' ? (
        <Tile tint="pink">
          <Head icon="siren" title={lang === 'hi' ? 'सुरक्षा और अलर्ट' : 'Safety and alerts'} />
          <Toggle label={t('shakeSos')} value={s.shakeSos} onChange={(x) => s.set({ shakeSos: x })} />
          <Toggle
            label="Fall detection"
            value={s.fallDetect}
            onChange={(x) => s.set({ fallDetect: x })}
            hint="If a hard fall is followed by stillness, Beacon asks if you are okay and sends an SOS if you do not answer"
          />
          <QuakeRow />
          <LifeboatRow />
        </Tile>
      ) : null}

      {/* Photo helper */}
      <View style={{ gap: 8 }}>
        <PhotoHelperCard />
        <Row style={{ justifyContent: 'flex-end' }}>
          <Btn size="sm" kind="secondary" icon="camera" label={lang === 'hi' ? 'फोटो जाँच खोलें' : 'Open Photo check'} onPress={() => router.push('/photo' as never)} />
        </Row>
      </View>

      {/* Server & data */}
      <Tile tint="green">
        <Head icon="cpu" title={t('server')} />
        <Txt size={11.5} style={{ opacity: 0.85 }}>
          {t('serverHint')}
        </Txt>
        <TextInput value={url} onChangeText={setUrl} placeholder="https://beacon.example.org" placeholderTextColor="#3F6B45" autoCapitalize="none" autoCorrect={false} style={input} />
        <TextInput value={key} onChangeText={setKey} placeholder="server public key (filled in on connect)" placeholderTextColor="#3F6B45" autoCapitalize="none" autoCorrect={false} style={input} />
        <Row>
          <Btn size="sm" label={t('save')} onPress={() => void saveServer()} />
          {test ? (
            <Txt size={12} style={{ opacity: 0.85 }}>
              {test}
            </Txt>
          ) : !cloudConfigured() ? (
            <Txt size={12} style={{ opacity: 0.85 }}>
              offline only
            </Txt>
          ) : null}
        </Row>

        <View style={divider} />
        <Txt size={13} weight="700">
          Status
        </Txt>
        <View style={{ gap: 3 }}>
          <Txt size={12.5}>
            Mesh radio: {mesh.radioAvailable ? mesh.status : 'not in this build'} · {mesh.neighbours} nearby
          </Txt>
          <Txt size={12.5}>
            Needle: {needleSupported ? needleStatus().state : 'native module missing'}
            {needleStatus().error ? ` · ${needleStatus().error}` : ''}
          </Txt>
          <Txt size={12.5}>Photo helper: {vision || 'not checked'}</Txt>
        </View>
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn size="sm" kind="secondary" icon="refresh" label="Re-check" onPress={() => void startNeedle().then(() => visionStatus()).then((x) => setVision(x.available ? 'ready' : (x.reason ?? 'unavailable'))).catch(() => setVision('unavailable'))} />
        </View>

        <View style={divider} />
        <Row style={{ justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt size={14} weight="500">
              {lang === 'hi' ? 'ऐप अपडेट' : 'App updates'}
            </Txt>
            <Txt size={11.5} style={{ opacity: 0.75 }}>
              {lang === 'hi' ? 'इंस्टॉल किया गया संस्करण' : 'Installed version'} {Constants.expoConfig?.version ?? '1.0.0'}
            </Txt>
          </View>
          <Btn size="sm" kind="secondary" label={lang === 'hi' ? 'अपडेट जाँचें' : 'Check for updates'} onPress={() => router.push('/update' as never)} />
        </Row>

        <View style={divider} />
        <Btn
          label={t('switchMode')}
          kind="secondary"
          onPress={() => {
            s.set({ onboarded: false, mode: null });
            router.replace('/welcome');
          }}
        />
        <Txt size={11} style={{ opacity: 0.75 }}>
          {DISCLAIMER[lang === 'hi' ? 1 : 0]}
        </Txt>
      </Tile>
    </View>
  );
}
