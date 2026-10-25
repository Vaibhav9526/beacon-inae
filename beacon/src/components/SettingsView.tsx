import { router } from 'expo-router';
import React, { useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import { needleStatus, needleSupported, startNeedle } from '../ai/needle';
import { DISCLAIMER } from '../kb';
import { useLang, useT } from '../i18n';
import { cloud, cloudConfigured } from '../services/cloud';
import { type VoiceRole, useEleven } from '../services/elevenlabs';
import { speak } from '../services/speech';
import { useMesh } from '../services/mesh';
import { visionStatus } from '../services/vision';
import { VLM_TOTAL, ortAvailable, useVlm } from '../services/vlm';
import { voiceStatus, voiceSupported } from '../services/voice';
import { useSettings } from '../state/settings';
import { radius } from '../theme';
import { Icon } from './Icon';
import { Btn, Card, Chip, Row, SectionTitle, Txt, useTheme } from './ui';

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const { p } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt size={14} weight="500">
          {label}
        </Txt>
        {hint ? (
          <Txt size={11.5} color={p.muted}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.card} accessibilityLabel={label} />
    </Row>
  );
}

export function SettingsView() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const s = useSettings();
  const mesh = useMesh();
  const eleven = useEleven();
  const vlm = useVlm();
  const [url, setUrl] = useState(s.serverUrl);
  const [key, setKey] = useState(s.serverKey);
  const [xi, setXi] = useState('');
  const [xiMsg, setXiMsg] = useState('');
  const [test, setTest] = useState('');
  const [vision, setVision] = useState('');
  const v = voiceSupported() ? voiceStatus() : null;

  React.useEffect(() => {
    void vlm.check();
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
    const r = await eleven.save(xi);
    setXiMsg(r.ok ? 'saved' : (r.error ?? 'failed'));
    if (r.ok) setXi('');
  };

  const input = { backgroundColor: p.cardAlt, borderRadius: radius.md, paddingHorizontal: 12, height: 40, color: p.text, fontSize: 13, fontFamily: 'Lexend_400Regular', paddingVertical: 0 } as const;
  const roles: VoiceRole[] = ['didi', 'asha', 'veer'];

  return (
    <View style={{ gap: 12 }}>
      <SectionTitle>{t('language')}</SectionTitle>
      <Card style={{ gap: 12 }}>
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
      </Card>

      <SectionTitle>Voice</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Toggle label={t('readAloudSetting')} value={s.readAloud} onChange={(x) => s.set({ readAloud: x })} />
        {s.mode !== 'kid' ? <Toggle label={t('voiceControl')} value={s.voiceControl} onChange={(x) => s.set({ voiceControl: x })} hint={v ? (v.onDevice ? 'on-device' : v.available ? 'uses the offline pack when installed' : t('voiceUnavailable')) : t('voiceUnavailable')} /> : null}
        <Row style={{ gap: 8 }}>
          <Icon name="mic" size={14} color={p.muted} />
          <Txt size={13} weight="500" style={{ flex: 1 }}>
            ElevenLabs voices
          </Txt>
          {eleven.has ? <Txt size={11.5} color={p.ok}>on</Txt> : <Txt size={11.5} color={p.muted}>off</Txt>}
        </Row>
        <Txt size={11.5} color={p.muted}>
          Natural Hindi and English speech and transcription. The key stays in this phone's secure storage. Without it the phone's own voice is used.
        </Txt>
        {eleven.has ? (
          <View style={{ gap: 8 }}>
            {roles.map((r) => (
              <Row key={r} style={{ justifyContent: 'space-between' }}>
                <Txt size={12.5} color={p.muted} style={{ textTransform: 'capitalize' }}>
                  {r}
                </Txt>
                <Btn size="sm" kind="secondary" icon="speaker" label={eleven.voices[r]?.name ?? '—'} onPress={() => void speak(lang === 'hi' ? 'नमस्ते, मैं आपकी मदद के लिए यहाँ हूँ।' : 'Hello, I am here to help.', lang, r)} />
              </Row>
            ))}
            <Btn size="sm" kind="ghost" label={t('remove')} onPress={() => void eleven.clear()} />
          </View>
        ) : (
          <>
            <TextInput value={xi} onChangeText={setXi} placeholder="ElevenLabs API key" placeholderTextColor={p.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={input} />
            <Row>
              <Btn size="sm" label={t('save')} onPress={() => void saveXi()} disabled={!xi.trim()} />
              {xiMsg ? <Txt size={12} color={p.muted}>{xiMsg}</Txt> : null}
            </Row>
          </>
        )}
      </Card>

      {s.mode !== 'kid' ? (
        <Card>
          <Toggle label={t('shakeSos')} value={s.shakeSos} onChange={(x) => s.set({ shakeSos: x })} />
        </Card>
      ) : null}

      <SectionTitle>{t('photoHelper')}</SectionTitle>
      <Card style={{ gap: 8 }}>
        <Txt size={11.5} color={p.muted}>
          {t('photoHelperHint')}
        </Txt>
        {!ortAvailable() ? (
          <Txt size={12.5} color={p.warn}>
            This build does not include the photo helper yet. Install the latest build to use it.
          </Txt>
        ) : vlm.status === 'downloading' ? (
          <View style={{ gap: 6 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: p.cardAlt, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(vlm.progress * 100)}%`, height: 6, backgroundColor: p.accent }} />
            </View>
            <Txt size={11.5} color={p.muted}>
              {Math.round(vlm.progress * 100)}% · {Math.round((vlm.progress * VLM_TOTAL) / 1e6)} / {Math.round(VLM_TOTAL / 1e6)} MB
            </Txt>
          </View>
        ) : vlm.status === 'ready' ? (
          <Row>
            <Icon name="check" size={14} color={p.ok} />
            <Txt size={13} weight="500" color={p.ok} style={{ flex: 1 }}>
              {t('ready')}
            </Txt>
            <Btn size="sm" kind="ghost" label={t('remove')} onPress={() => void vlm.remove()} />
          </Row>
        ) : (
          <Btn size="sm" icon="download" label={`${t('download')} · ${Math.round(VLM_TOTAL / 1e6)} MB`} onPress={() => void vlm.download()} />
        )}
        {vlm.error ? (
          <Txt size={12} color={p.danger}>
            {vlm.error}
          </Txt>
        ) : null}
      </Card>

      <SectionTitle>{t('server')}</SectionTitle>
      <Card style={{ gap: 8 }}>
        <Txt size={11.5} color={p.muted}>
          {t('serverHint')}
        </Txt>
        <TextInput value={url} onChangeText={setUrl} placeholder="https://beacon.example.org" placeholderTextColor={p.muted} autoCapitalize="none" autoCorrect={false} style={input} />
        <TextInput value={key} onChangeText={setKey} placeholder="server public key (filled in on connect)" placeholderTextColor={p.muted} autoCapitalize="none" autoCorrect={false} style={input} />
        <Row>
          <Btn size="sm" label={t('save')} onPress={() => void saveServer()} />
          {test ? <Txt size={12} color={p.muted}>{test}</Txt> : !cloudConfigured() ? <Txt size={12} color={p.muted}>offline only</Txt> : null}
        </Row>
      </Card>

      <SectionTitle>Status</SectionTitle>
      <Card style={{ gap: 3 }}>
        <Txt size={12.5}>Mesh radio: {mesh.radioAvailable ? mesh.status : 'not in this build'} · {mesh.neighbours} nearby</Txt>
        <Txt size={12.5}>
          Needle: {needleSupported ? needleStatus().state : 'native module missing'}
          {needleStatus().error ? ` · ${needleStatus().error}` : ''}
        </Txt>
        <Txt size={12.5}>Photo helper: {vision || 'not checked'}</Txt>
        <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
          <Btn size="sm" kind="secondary" icon="refresh" label="Re-check" onPress={() => void startNeedle().then(() => void visionStatus().then((x) => setVision(x.available ? 'ready' : (x.reason ?? 'unavailable'))))} />
        </View>
      </Card>

      <Card style={{ gap: 8 }}>
        <Btn
          label={t('switchMode')}
          kind="secondary"
          onPress={() => {
            s.set({ onboarded: false, mode: null });
            router.replace('/welcome');
          }}
        />
        <Txt size={11} color={p.muted}>
          {DISCLAIMER[lang === 'hi' ? 1 : 0]}
        </Txt>
      </Card>
    </View>
  );
}
