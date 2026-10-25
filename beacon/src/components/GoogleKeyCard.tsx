import React, { useEffect, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';
import { useGoogleKey } from '../services/googleKey';
import { radius } from '../theme';
import { Btn, Card, Row, Txt, useTheme } from './ui';

const CONSOLE_URL = 'https://console.cloud.google.com/';

/** Settings card for the optional Google Maps Platform key (used for Google weather). */
export function GoogleKeyCard() {
  const { p } = useTheme();
  const { has, checked, load, save, clear } = useGoogleKey();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!checked) void load();
  }, [checked, load]);

  const onSave = async () => {
    setBusy(true);
    const r = await save(draft);
    setBusy(false);
    if (r.ok) {
      setDraft('');
      setMsg('Key saved. Weather now uses Google, with Open-Meteo as backup.');
    } else {
      setMsg(r.error ?? 'Could not save the key');
    }
  };

  const onRemove = async () => {
    await clear();
    setDraft('');
    setMsg('Key removed. Weather uses Open-Meteo.');
  };

  const status = has ? 'Key saved. Weather uses Google, with Open-Meteo as backup.' : 'No key. Weather uses the free Open-Meteo forecast.';

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={15} weight="600">
          Google Maps key
        </Txt>
        <Txt size={12} weight="600" style={{ opacity: has ? 1 : 0.7 }}>
          {has ? 'on' : 'off'}
        </Txt>
      </Row>
      <Txt size={11.5} style={{ opacity: 0.8 }}>
        Optional. Used for Google weather (and Google Maps features). The key stays on this phone. Without it the app uses the free Open-Meteo forecast.
      </Txt>

      {has ? null : (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Google Maps API key"
          placeholderTextColor={p.muted ?? '#5B6490'}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          accessibilityLabel="Google Maps API key"
          style={{
            height: 44,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.border,
            backgroundColor: p.cardAlt,
            color: p.text,
            paddingHorizontal: 12,
            fontSize: 14,
          }}
        />
      )}

      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        {has ? (
          <Btn size="sm" kind="ghost" label="Remove" onPress={() => void onRemove()} />
        ) : (
          <Btn size="sm" label={busy ? 'Checking' : 'Save'} onPress={() => void onSave()} disabled={busy || !draft.trim()} />
        )}
      </Row>

      <Txt size={12} style={{ opacity: 0.85 }}>
        {msg ?? status}
      </Txt>

      <View>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(CONSOLE_URL)}>
          <Txt size={12} weight="600" color={p.accent} style={{ textDecorationLine: 'underline' }}>
            Create a key in Google Cloud Console and enable the Weather API
          </Txt>
        </Pressable>
      </View>
    </Card>
  );
}
