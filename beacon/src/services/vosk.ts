import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { create } from 'zustand';
import native from '../../modules/beacon-ai';
import { useSettings } from '../state/settings';
import { DL_INITIAL, type DlEvent, type DlState, dlReduce, shouldAutoDownload, type VoskLang } from './voskLogic';

/** This build carries the Vosk native code (older installs of the app do not). */
export const voskSupported = (): boolean => Platform.OS === 'android' && !!native && typeof native.voskStatus === 'function';

/** The model language the user picked in Settings. */
export const voskLang = (): VoskLang => (useSettings.getState().offlineVoiceLang === 'hi' ? 'hi' : 'en');

/** Truth from the phone's storage: is the chosen language's model installed? Cheap, synchronous, never throws. */
export function voskInstalled(lang: VoskLang = voskLang()): boolean {
  try {
    return voskSupported() && !!native!.voskStatus(lang).installed;
  } catch {
    return false;
  }
}

interface VoskStore {
  dl: DlState;
  dispatch(e: DlEvent): void;
  check(): void;
  download(): Promise<boolean>;
  cancel(): void;
  remove(): Promise<void>;
}

export const useVosk = create<VoskStore>((set, get) => ({
  dl: DL_INITIAL,
  dispatch: (e) => set((s) => ({ dl: dlReduce(s.dl, e) })),
  check() {
    get().dispatch({ t: 'checked', installed: voskInstalled() });
  },
  async download() {
    if (!voskSupported() || get().dl.status === 'downloading') return false;
    const lang = voskLang();
    get().dispatch({ t: 'start' });
    const sub = native!.addListener('voskDownloadProgress', (e) => {
      if (e.lang === lang) get().dispatch({ t: 'progress', pct: e.pct });
    });
    try {
      const r = await native!.voskDownload(lang);
      if (r.ok) {
        get().dispatch({ t: 'done' });
        return true;
      }
      get().dispatch(r.error === 'cancelled' ? { t: 'cancelled' } : { t: 'fail', error: r.error ?? 'download failed' });
      return false;
    } catch (e) {
      get().dispatch({ t: 'fail', error: String((e as Error).message ?? e) });
      return false;
    } finally {
      sub.remove();
    }
  },
  cancel() {
    try {
      native?.voskCancelDownload();
    } catch {
      /* nothing running */
    }
  },
  async remove() {
    if (!voskSupported()) return;
    try {
      await native!.voskRemove(voskLang());
    } catch {
      /* the check below tells the truth */
    }
    get().check();
  },
}));

/**
 * First start: fetch the English (India) model once in the background if the switch is on and the phone is online.
 * Marked as tried before it starts, so a failure never loops; the Settings row and the mic card can retry by hand.
 */
export async function autoDownloadOfflineVoice(): Promise<void> {
  try {
    if (!voskSupported()) return;
    const st = useSettings.getState();
    const store = useVosk.getState();
    store.check();
    let online = false;
    try {
      const n = await Network.getNetworkStateAsync();
      online = !!(n.isConnected && n.isInternetReachable !== false);
    } catch {
      online = false;
    }
    if (!shouldAutoDownload({ enabled: st.offlineVoice, alreadyTried: st.offlineVoiceAutoTried, status: useVosk.getState().dl.status, nativeVosk: true, online })) return;
    st.set({ offlineVoiceAutoTried: true });
    await useVosk.getState().download();
  } catch (e) {
    console.log('[vosk] auto download skipped', String(e));
  }
}
