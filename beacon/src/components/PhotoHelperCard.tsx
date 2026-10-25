import React from 'react';
import { View } from 'react-native';
import { useLang, useT } from '../i18n';
import { VLM_TOTAL, cancelVlmDownload, ortAvailable, useVlm } from '../services/vlm';
import { Icon, type IconName } from './Icon';
import { Btn, Card, Row, Txt, useTheme } from './ui';

/** Header row of the card: a white icon well and a bold title. */
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

/**
 * The offline photo helper settings card: the optional ~260 MB on-device vision model.
 * Shows one of: not in this build, not downloaded (download), downloading (progress + cancel), ready (size + remove), error (retry).
 * Guided photo checks work without it.
 */
export function PhotoHelperCard() {
  const { p } = useTheme();
  const t = useT();
  const lang = useLang();
  const vlm = useVlm();

  React.useEffect(() => {
    void vlm.check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card tint="yellow" style={{ gap: 12, padding: 16, borderRadius: 28 }}>
      <Head icon="camera" title={t('photoHelper')} />
      <Txt size={11.5} style={{ opacity: 0.85 }}>
        {t('photoHelperHint')}
      </Txt>
      <Txt size={11.5} style={{ opacity: 0.85 }}>
        {lang === 'hi' ? 'गाइडेड फ़ोटो जाँच इसके बिना भी काम करती है।' : 'Guided photo checks work without this download.'}
      </Txt>
      {!ortAvailable() ? (
        <Txt size={12.5} weight="600">
          {lang === 'hi'
            ? 'स्मार्ट विवरण के लिए ऐप का नया संस्करण चाहिए। फ़ोटो जाँच अभी भी काम करती है: ऊपर "फ़ोटो लें" दबाएँ।'
            : 'The smart description needs the newer app build, which this phone does not have yet. Photo check still works now: tap Take a photo above and answer a few questions to get first-aid steps.'}
        </Txt>
      ) : vlm.status === 'downloading' ? (
        <View style={{ gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)', overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(vlm.progress * 100)}%`, height: 6, backgroundColor: p.tint.yellow.ink }} />
          </View>
          <Txt size={11.5} style={{ opacity: 0.85 }}>
            {Math.round(vlm.progress * 100)}% · {Math.round((vlm.progress * VLM_TOTAL) / 1e6)} / {Math.round(VLM_TOTAL / 1e6)} MB
          </Txt>
          <Btn size="sm" kind="ghost" label={lang === 'hi' ? 'रद्द करें' : 'Cancel'} onPress={() => cancelVlmDownload()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : vlm.status === 'ready' ? (
        <Row>
          <Icon name="check" size={14} />
          <Txt size={13} weight="600" style={{ flex: 1 }}>
            {`${t('ready')} · ${Math.round(VLM_TOTAL / 1e6)} MB`}
          </Txt>
          <Btn size="sm" kind="ghost" label={t('remove')} onPress={() => void vlm.remove()} />
        </Row>
      ) : vlm.status === 'error' ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Txt size={12} weight="600" style={{ flexBasis: '100%' }}>
            {lang === 'hi' ? 'डाउनलोड नहीं हो पाया।' : 'The download did not finish.'}
          </Txt>
          <Btn size="sm" icon="refresh" label={lang === 'hi' ? 'फिर कोशिश करें' : 'Retry'} onPress={() => void vlm.download()} />
        </Row>
      ) : (
        <Btn size="sm" icon="download" label={`${t('download')} ${Math.round(VLM_TOTAL / 1e6)} MB ${lang === 'hi' ? '(वाई-फ़ाई पर)' : 'over Wi-Fi'}`} onPress={() => void vlm.download()} />
      )}
      {vlm.error ? (
        <Txt size={12} weight="600">
          {vlm.error}
        </Txt>
      ) : null}
    </Card>
  );
}
