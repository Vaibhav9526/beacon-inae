import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, View, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FS from 'expo-file-system/legacy';
import { Bell, Bolt, Cross, Shield, Sun } from '../components/Deco';
import { Screen } from '../components/Screen';
import { Btn, Card, Txt, type TintName } from '../components/ui';
import { useLang } from '../i18n';
import { getFix, type Fix } from '../services/location';
import { makeToneWav, sosPattern, strobeSchedule, type TimedStep } from '../services/signals';
import { useSettings } from '../state/settings';

type Bi = { en: string; hi: string };

// expo-audio and expo-keep-awake have native code: load them lazily so an older build still runs the rest of the screen
type AudioMod = typeof import('expo-audio');
type KeepAwakeMod = typeof import('expo-keep-awake');
type Player = { play(): void; pause(): void; remove(): void; loop: boolean };

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
function keepAwake(): KeepAwakeMod | null {
  if (keepMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      keepMod = require('expo-keep-awake') as KeepAwakeMod;
    } catch {
      keepMod = null;
    }
  }
  return keepMod;
}

const SOS_UNIT_MS = 200;
// one full SOS, then a 7-unit pause so the pattern repeats cleanly
const SOS_SCHEDULE: TimedStep[] = [...strobeSchedule(sosPattern(), SOS_UNIT_MS), { on: false, ms: 7 * SOS_UNIT_MS }];
const TONE_HZ = { siren: 960, whistle: 2600 } as const;
const ALARM_PATTERN = [0, 400, 200, 400, 200];

const NOTE_NO_SOUND: Bi = {
  en: 'Update the app to enable sound. Vibration is used instead.',
  hi: 'आवाज़ चालू करने के लिए ऐप अपडेट करें। उसकी जगह कंपन चलेगा।',
};
const NOTE_NO_TORCH: Bi = { en: 'The torch is not available on this phone.', hi: 'इस फ़ोन में टॉर्च उपलब्ध नहीं है।' };
const NOTE_CAM_DENIED: Bi = { en: 'Allow camera access to use the torch.', hi: 'टॉर्च के लिए कैमरा की अनुमति दें।' };

export default function ToolsScreen() {
  const lang = useLang();
  const nickname = useSettings((s) => s.nickname);
  const tx = (b: Bi) => (lang === 'hi' ? b.hi : b.en);

  const [perm, askPerm] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [torchNote, setTorchNote] = useState<string | null>(null);

  const [strobing, setStrobing] = useState(false);
  const [lit, setLit] = useState(false);

  const [sound, setSound] = useState<'siren' | 'whistle' | null>(null);
  const [soundNote, setSoundNote] = useState<string | null>(null);
  const playerRef = useRef<Player | null>(null);
  const soundSeq = useRef(0);

  const [flare, setFlare] = useState(false);
  const [flareAt, setFlareAt] = useState<Date>(new Date());
  const [fix, setFix] = useState<Fix | null>(null);

  // ---- torch ----
  const toggleTorch = async () => {
    if (torchOn) return setTorchOn(false);
    if (Platform.OS === 'web') return setTorchNote(tx(NOTE_NO_TORCH));
    try {
      if (!perm?.granted) {
        const r = await askPerm();
        if (!r.granted) return setTorchNote(tx(NOTE_CAM_DENIED));
      }
      setTorchNote(null);
      setTorchOn(true);
    } catch {
      setTorchNote(tx(NOTE_NO_TORCH));
    }
  };

  // ---- SOS strobe: a timed chain of on/off steps, screen kept awake while it runs ----
  useEffect(() => {
    if (!strobing) return;
    const ka = keepAwake();
    void ka?.activateKeepAwakeAsync('beacon-sos').catch(() => {});
    let i = 0;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (!live) return;
      const s = SOS_SCHEDULE[i % SOS_SCHEDULE.length];
      i++;
      setLit(s.on);
      timer = setTimeout(tick, s.ms);
    };
    tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      setLit(false);
      try {
        ka?.deactivateKeepAwake('beacon-sos');
      } catch {
        /* already released */
      }
    };
  }, [strobing]);

  // ---- siren and whistle: a looping WAV tone, or vibration when sound is unavailable ----
  const stopSound = () => {
    soundSeq.current++;
    try {
      playerRef.current?.pause();
      playerRef.current?.remove();
    } catch {
      /* already gone */
    }
    playerRef.current = null;
    Vibration.cancel();
    setSound(null);
  };

  const startSound = async (kind: 'siren' | 'whistle') => {
    stopSound();
    const seq = soundSeq.current;
    const au = audio();
    if (!au || Platform.OS === 'web') {
      setSoundNote(tx(NOTE_NO_SOUND));
      Vibration.vibrate(ALARM_PATTERN, true);
      setSound(kind);
      return;
    }
    try {
      const hz = TONE_HZ[kind];
      const uri = `${FS.cacheDirectory ?? ''}beacon-tone-${hz}.wav`;
      await FS.writeAsStringAsync(uri, makeToneWav(hz, 1000), { encoding: FS.EncodingType.Base64 });
      if (seq !== soundSeq.current) return;
      await au.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const player = au.createAudioPlayer(uri) as unknown as Player;
      player.loop = true;
      if (seq !== soundSeq.current) {
        player.remove();
        return;
      }
      playerRef.current = player;
      player.play();
      setSoundNote(null);
      setSound(kind);
    } catch {
      setSoundNote(tx(NOTE_NO_SOUND));
      Vibration.vibrate(ALARM_PATTERN, true);
      setSound(kind);
    }
  };

  useEffect(() => () => stopSound(), []);

  // ---- flare message: open the big card and get a fresh position for it ----
  const openFlare = () => {
    setFlareAt(new Date());
    setFix(null);
    setFlare(true);
    getFix({ maxWaitMs: 4000 })
      .then((f) => setFix(f))
      .catch(() => setFix(null));
  };

  const coords = fix ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` : tx({ en: 'Location not found yet', hi: 'स्थान अभी नहीं मिला' });
  const name = nickname.trim() || tx({ en: 'Beacon user', hi: 'बीकन उपयोगकर्ता' });
  const timeText = flareAt.toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

  return (
    <Screen title={tx({ en: 'Signal tools', hi: 'सिग्नल औज़ार' })}>
      {/* hero */}
      <Card tint="yellow" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Bolt size={62} />
        <View style={{ flex: 1 }}>
          <Txt size={22} weight="700">
            {tx({ en: 'When the phone is your only tool', hi: 'जब फ़ोन ही एकमात्र साधन हो' })}
          </Txt>
          <Txt size={14} style={{ marginTop: 4 }}>
            {tx({ en: 'Light and sound that work without signal.', hi: 'बिना नेटवर्क के काम करने वाली रोशनी और आवाज़।' })}
          </Txt>
        </View>
      </Card>

      {/* bento */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Tile tint="yellow" w="48%" title={tx({ en: 'Torch', hi: 'टॉर्च' })} sub={torchOn ? tx({ en: 'On', hi: 'चालू' }) : tx({ en: 'Off', hi: 'बंद' })} sticker={Bolt}>
          <Btn label={torchOn ? tx({ en: 'Turn off', hi: 'बंद करें' }) : tx({ en: 'Turn on', hi: 'चालू करें' })} onPress={toggleTorch} size="sm" />
          {torchNote ? <Txt size={12.5} style={{ marginTop: 8 }}>{torchNote}</Txt> : null}
        </Tile>

        <Tile tint="pink" w="48%" title={tx({ en: 'SOS light', hi: 'SOS रोशनी' })} sub={tx({ en: '... --- ...', hi: '... --- ...' })} sticker={Sun}>
          <Btn label={tx({ en: 'Start', hi: 'शुरू करें' })} onPress={() => setStrobing(true)} size="sm" />
        </Tile>

        <Tile tint="blue" w="48%" title={tx({ en: 'Siren', hi: 'सायरन' })} sub={sound === 'siren' ? tx({ en: 'Sounding', hi: 'बज रहा है' }) : tx({ en: 'Loud, rising', hi: 'तेज़ आवाज़' })} sticker={Bell}>
          <Btn
            label={sound === 'siren' ? tx({ en: 'Stop', hi: 'रोकें' }) : tx({ en: 'Sound', hi: 'बजाएँ' })}
            onPress={() => (sound === 'siren' ? stopSound() : void startSound('siren'))}
            size="sm"
          />
        </Tile>

        <Tile tint="green" w="48%" title={tx({ en: 'Whistle', hi: 'सीटी' })} sub={sound === 'whistle' ? tx({ en: 'Sounding', hi: 'बज रहा है' }) : tx({ en: 'High, carries far', hi: 'ऊँची, दूर तक जाती है' })} sticker={Shield}>
          <Btn
            label={sound === 'whistle' ? tx({ en: 'Stop', hi: 'रोकें' }) : tx({ en: 'Sound', hi: 'बजाएँ' })}
            onPress={() => (sound === 'whistle' ? stopSound() : void startSound('whistle'))}
            size="sm"
          />
        </Tile>

        {soundNote ? (
          <Card style={{ width: '100%' }}>
            <Txt size={13}>{soundNote}</Txt>
          </Card>
        ) : null}

        <Tile tint="peach" w="100%" title={tx({ en: 'Flare message', hi: 'संकेत संदेश' })} sub={tx({ en: 'A big card to show to rescuers or people nearby.', hi: 'बचावकर्मियों या पास के लोगों को दिखाने के लिए बड़ा कार्ड।' })} sticker={Cross}>
          <Btn label={tx({ en: 'Show card', hi: 'कार्ड दिखाएँ' })} onPress={openFlare} size="sm" />
        </Tile>

        <Tile tint="lilac" w="100%" title={tx({ en: 'Battery tip', hi: 'बैटरी सुझाव' })} sub={tx({ en: 'Turn on battery saver, lower brightness, close other apps.', hi: 'बैटरी सेवर चालू करें, चमक कम करें, दूसरे ऐप बंद करें।' })} sticker={Sun} />
      </View>

      {/* full-screen SOS strobe */}
      <Modal visible={strobing} animationType="fade" statusBarTranslucent onRequestClose={() => setStrobing(false)}>
        <View style={{ flex: 1, backgroundColor: lit ? '#FFFFFF' : '#000000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Txt size={20} weight="700" color={lit ? '#000000' : '#FFFFFF'}>
            {tx({ en: 'SOS', hi: 'SOS' })}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx({ en: 'Stop SOS light', hi: 'SOS रोशनी रोकें' })}
            onPress={() => setStrobing(false)}
            style={{ position: 'absolute', bottom: 48, height: 60, paddingHorizontal: 36, borderRadius: 999, backgroundColor: '#000000', borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center' }}>
            <Txt size={20} weight="700" color="#FFFFFF">
              {tx({ en: 'Stop', hi: 'रोकें' })}
            </Txt>
          </Pressable>
        </View>
      </Modal>

      {/* flare card: huge and high contrast */}
      <Modal visible={flare} animationType="fade" statusBarTranslucent onRequestClose={() => setFlare(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000', padding: 24, justifyContent: 'space-between' }}>
          <View style={{ gap: 18 }}>
            <Txt size={20} weight="600" color="#FFFFFF">
              {name}
            </Txt>
            <Txt size={58} weight="700" color="#FFD84A" style={{ lineHeight: 64 }}>
              {tx({ en: 'I NEED HELP', hi: 'मुझे मदद चाहिए' })}
            </Txt>
            <Txt size={22} weight="600" color="#FFFFFF">
              {timeText}
            </Txt>
            <Txt size={22} weight="600" color="#FFFFFF">
              {coords}
            </Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tx({ en: 'Close card', hi: 'कार्ड बंद करें' })}
            onPress={() => setFlare(false)}
            style={{ height: 60, borderRadius: 999, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
            <Txt size={20} weight="700" color="#000000">
              {tx({ en: 'Close', hi: 'बंद करें' })}
            </Txt>
          </Pressable>
        </View>
      </Modal>

      {/* hidden 1px camera: its only job is to drive the torch */}
      {torchOn ? (
        <CameraView
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          facing="back"
          enableTorch
          onMountError={() => {
            setTorchOn(false);
            setTorchNote(tx(NOTE_NO_TORCH));
          }}
        />
      ) : null}

    </Screen>
  );
}

function Tile({
  tint,
  w,
  title,
  sub,
  sticker: Sticker,
  children,
}: {
  tint: TintName;
  w: `${number}%`;
  title: string;
  sub: string;
  sticker: React.ComponentType<{ size?: number }>;
  children?: React.ReactNode;
}) {
  return (
    <Card tint={tint} style={{ width: w, minHeight: 150, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Txt size={18} weight="700">
          {title}
        </Txt>
        <Sticker size={42} />
      </View>
      <Txt size={13}>{sub}</Txt>
      <View style={{ marginTop: 'auto', paddingTop: 6, alignSelf: 'flex-start' }}>{children}</View>
    </Card>
  );
}
