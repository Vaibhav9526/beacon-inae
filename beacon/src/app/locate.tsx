import * as FS from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Vibration, View } from 'react-native';
import { LocatorMeter } from '../components/LocatorMeter';
import { Screen } from '../components/Screen';
import { Btn, Card, Txt, useTheme } from '../components/ui';
import { tap } from '../services/haptics';
import { beaconSchedule, beaconWav, isOnAt, SignalTracker, type TrackerOut } from '../services/locator';
import { sendSosNow } from '../services/sos';

export const LOCATE_ROUTE = '/locate';

type AudioMod = typeof import('expo-audio');
type KeepAwakeMod = typeof import('expo-keep-awake');
type Player = { play(): void; pause(): void; remove(): void; loop: boolean; volume: number; currentTime: number };
type Recorder = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; getStatus(): { metering?: number } };

// native modules are loaded lazily so a build without them still opens the screen
let audioMod: AudioMod | null | undefined;
function audio(): AudioMod | null {
  if (audioMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      audioMod = require('expo-audio') as AudioMod;
    } catch {
      audioMod = null;
    }
  }
  return audioMod;
}
let keepMod: KeepAwakeMod | null | undefined;
function keep(on: boolean) {
  try {
    if (keepMod === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      keepMod = require('expo-keep-awake') as KeepAwakeMod;
    }
    if (!keepMod) return;
    if (on) void keepMod.activateKeepAwakeAsync('locate').catch(() => {});
    else void keepMod.deactivateKeepAwake('locate').catch(() => {});
  } catch {
    keepMod = null;
  }
}

// the hook cannot be called conditionally, so pick a stand-in once when the module is missing
const mod0 = audio();
const useRecorder: AudioMod['useAudioRecorder'] = mod0 ? mod0.useAudioRecorder : ((() => null) as never);

function Bi({ en, hi, size = 14, weight = '400' }: { en: string; hi: string; size?: number; weight?: '400' | '600' | '700' }) {
  const { p } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Txt size={size} weight={weight}>
        {en}
      </Txt>
      <Txt size={size - 1.5} color={p.muted}>
        {hi}
      </Txt>
    </View>
  );
}

const NO_AUDIO = { en: 'Update the app to use this', hi: 'इसके लिए ऐप अपडेट करें' };

export default function LocateScreen() {
  const { p } = useTheme();
  const [mode, setMode] = useState<'choose' | 'trapped' | 'search'>('choose');
  return (
    <Screen title="Locate me / मुझे ढूँढो">
      <Card tint="yellow" style={{ marginBottom: 14 }}>
        <Bi
          weight="600"
          en="Works best within about 10 to 30 metres in a quiet place. It is a helper, not a guarantee."
          hi="शांत जगह में लगभग 10 से 30 मीटर के भीतर सबसे अच्छा काम करता है। यह एक मददगार है, गारंटी नहीं।"
        />
      </Card>
      {mode === 'choose' ? (
        <View style={{ gap: 12 }}>
          <Card tint="pink">
            <Bi weight="700" size={18} en="I am trapped" hi="मैं फँसा हूँ" />
            <View style={{ height: 8 }} />
            <Bi en="Make my phone a loud beacon so rescuers can find me." hi="मेरे फ़ोन को तेज़ बीकन बनाएँ ताकि बचावकर्मी मुझे ढूँढ सकें।" />
            <View style={{ height: 12 }} />
            <Btn size="lg" label="I am trapped / मैं फँसा हूँ" kind="danger" onPress={() => setMode('trapped')} style={{ minHeight: 56 }} />
          </Card>
          <Card tint="blue">
            <Bi weight="700" size={18} en="I am searching" hi="मैं ढूँढ रहा हूँ" />
            <View style={{ height: 8 }} />
            <Bi en="Listen for a beacon and walk toward it." hi="बीकन की आवाज़ सुनें और उसकी ओर चलें।" />
            <View style={{ height: 12 }} />
            <Btn size="lg" label="I am searching / मैं ढूँढ रहा हूँ" onPress={() => setMode('search')} style={{ minHeight: 56 }} />
          </Card>
        </View>
      ) : mode === 'trapped' ? (
        <Trapped onDone={() => setMode('choose')} />
      ) : (
        <Searcher onDone={() => setMode('choose')} />
      )}
      <View style={{ height: 8 }} />
      <Txt size={11} color={p.muted} style={{ textAlign: 'center' }}>
        {Platform.OS === 'web' ? 'Not available on web / वेब पर उपलब्ध नहीं' : ' '}
      </Txt>
    </Screen>
  );
}

// ---------------------------------------------------------------- trapped

function Trapped({ onDone }: { onDone: () => void }) {
  const { p } = useTheme();
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sosNote, setSosNote] = useState<string | null>(null);
  const player = useRef<Player | null>(null);
  const t0 = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    try {
      player.current?.pause();
      player.current?.remove();
    } catch {
      /* already gone */
    }
    player.current = null;
    Vibration.cancel();
    keep(false);
    setRunning(false);
    setLit(false);
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    const sched = beaconSchedule();
    keep(true);
    t0.current = Date.now();
    setRunning(true);
    let usedSound = false;
    const au = audio();
    if (au && Platform.OS !== 'web') {
      try {
        const uri = `${FS.cacheDirectory ?? ''}beacon-locate.wav`;
        await FS.writeAsStringAsync(uri, beaconWav(), { encoding: FS.EncodingType.Base64 });
        await au.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        const pl = au.createAudioPlayer(uri) as unknown as Player;
        pl.loop = true;
        pl.volume = 1;
        pl.play();
        player.current = pl;
        usedSound = true;
      } catch {
        usedSound = false;
      }
    }
    if (!usedSound) {
      setNote('Sound is not available, so the phone will vibrate instead. / आवाज़ उपलब्ध नहीं, इसलिए फ़ोन कंपन करेगा।');
      const pat: number[] = [0];
      sched.steps.forEach((s) => pat.push(s.ms));
      pat.push(1);
      Vibration.vibrate(pat, true);
    }
    t0.current = Date.now();
    // follow the player's own clock so the flash stays on the beat
    tick.current = setInterval(() => {
      const t = usedSound && player.current ? player.current.currentTime * 1000 : Date.now() - t0.current;
      setLit(isOnAt(sched.steps, t));
    }, 50);
    // one mesh SOS; any failure (no permission, no Bluetooth) is ignored
    sendSosNow('Trapped, sound beacon on')
      .then(() => setSosNote('Help request sent over the mesh. / मदद का संदेश भेजा गया।'))
      .catch(() => {});
  };

  return (
    <View style={{ gap: 12 }}>
      <Card tint="peach">
        <Bi weight="600" en="Stay calm. Save battery. Make noise in bursts. Tap on a pipe or wall in the same rhythm." hi="शांत रहें। बैटरी बचाएँ। रुक-रुक कर आवाज़ करें। पाइप या दीवार पर उसी लय में थपथपाएँ।" />
        <View style={{ height: 8 }} />
        <Bi size={13} en="Rhythm: 3 short, 3 long, 3 short, then a pause." hi="लय: 3 छोटी, 3 लंबी, 3 छोटी, फिर विराम।" />
      </Card>
      <Card tint="green">
        <Bi weight="600" en="Battery tip: turn the screen brightness down and close other apps. Stop the beacon when you hear help." hi="बैटरी सुझाव: स्क्रीन की चमक कम करें और बाकी ऐप बंद करें। मदद की आवाज़ सुनें तो बीकन रोक दें।" />
      </Card>
      {note ? <Txt size={13} color={p.warn}>{note}</Txt> : null}
      {sosNote ? <Txt size={13} color={p.ok}>{sosNote}</Txt> : null}
      {!audio() ? <Txt size={13} color={p.warn}>{`${NO_AUDIO.en} / ${NO_AUDIO.hi}`}</Txt> : null}
      {running ? (
        <Btn size="lg" kind="danger" label="Stop / रोकें" onPress={stop} style={{ minHeight: 56 }} />
      ) : (
        <Btn size="lg" label="Start beacon / बीकन शुरू करें" onPress={() => void start()} style={{ minHeight: 56 }} />
      )}
      <Btn kind="ghost" label="Back / वापस" onPress={() => { stop(); onDone(); }} />
      <Modal visible={running} animationType="none" statusBarTranslucent onRequestClose={stop}>
        <View style={{ flex: 1, backgroundColor: lit ? '#FFFFFF' : '#000000', alignItems: 'center', justifyContent: 'flex-end', padding: 24 }}>
          <Btn size="lg" kind="danger" label="Stop / रोकें" onPress={stop} style={{ minHeight: 64, alignSelf: 'stretch' }} />
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------- searching

const OFF: TrackerOut = { strength: 0, state: 'searching', noiseFloorDb: -160, matchScore: 0 };

function Searcher({ onDone }: { onDone: () => void }) {
  const { p } = useTheme();
  const au = audio();
  const recorder = useRecorder((au ? { ...au.RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true } : {}) as never) as unknown as Recorder | null;
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<TrackerOut>(OFF);
  const [note, setNote] = useState<string | null>(null);
  const tracker = useRef(new SignalTracker());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const buzz = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strengthRef = useRef(0);
  const seen = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (buzz.current) clearTimeout(buzz.current);
    timer.current = null;
    buzz.current = null;
    keep(false);
    setRunning(false);
    setOut(OFF);
    strengthRef.current = 0;
    const r = recorder;
    if (r) {
      void r.stop().catch(() => {});
      void audio()?.setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  }, [recorder]);
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  // haptic tick that speeds up as the signal gets stronger
  const schedule = useCallback(() => {
    const s = strengthRef.current;
    if (s > 5) tap();
    buzz.current = setTimeout(schedule, Math.round(1400 - s * 12.5));
  }, []);

  const start = async () => {
    if (!au || !recorder || Platform.OS === 'web') return setNote(`${NO_AUDIO.en} / ${NO_AUDIO.hi}`);
    try {
      const perm = await au.requestRecordingPermissionsAsync();
      if (!perm.granted) return setNote('Allow the microphone to listen. / सुनने के लिए माइक्रोफ़ोन की अनुमति दें।');
      await au.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      return setNote('Could not start the microphone. / माइक्रोफ़ोन शुरू नहीं हो सका।');
    }
    tracker.current.reset();
    seen.current = 0;
    setNote(null);
    keep(true);
    setRunning(true);
    const began = Date.now();
    timer.current = setInterval(() => {
      try {
        const m = recorder.getStatus().metering;
        if (typeof m === 'number') {
          seen.current++;
          const o = tracker.current.push(m, Date.now());
          strengthRef.current = o.strength;
          setOut(o);
        } else if (Date.now() - began > 3000 && seen.current === 0) {
          setNote('This phone does not report loudness, so listening is not possible. / यह फ़ोन आवाज़ का स्तर नहीं देता, इसलिए सुनना संभव नहीं।');
        }
      } catch {
        /* recorder is gone */
      }
    }, 100);
    schedule();
  };

  return (
    <View style={{ gap: 12 }}>
      {running ? <LocatorMeter strength={out.strength} state={out.state} /> : null}
      <Card tint="blue">
        <Bi weight="600" en="Walk slowly. Stop every few steps. Louder means closer. The sound will repeat every few seconds." hi="धीरे चलें। कुछ कदम बाद रुकें। आवाज़ तेज़ मतलब पास। आवाज़ कुछ सेकंड में दोहराई जाएगी।" />
      </Card>
      {note ? <Txt size={13} color={p.warn}>{note}</Txt> : null}
      {!au ? <Txt size={13} color={p.warn}>{`${NO_AUDIO.en} / ${NO_AUDIO.hi}`}</Txt> : null}
      {running ? (
        <Btn size="lg" kind="danger" label="Stop / रोकें" onPress={stop} style={{ minHeight: 56 }} />
      ) : (
        <Btn size="lg" label="Start listening / सुनना शुरू करें" onPress={() => void start()} disabled={!au} style={{ minHeight: 56 }} />
      )}
      <Btn kind="ghost" label="Back / वापस" onPress={() => { stop(); onDone(); }} />
    </View>
  );
}
