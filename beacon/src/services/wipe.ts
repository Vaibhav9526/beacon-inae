// Panic wipe: erases everything Beacon keeps on this phone, fast, so a person who must hide that they use the app
// (or who hands the phone over) can do it in one step. Nothing here talks to the network.
//
// The pure part (listWipeTargets) has no native imports, so it runs under tsx. Every native call goes through the
// Storage interface; the real adapters are loaded lazily, so tests can pass fakes without touching react-native.

/** Every AsyncStorage key Beacon writes starts with this prefix. The sweep removes any of them, known or not. */
export const KEY_PREFIX = 'beacon.';

export type WipeId = 'settings' | 'mesh' | 'identity' | 'reports' | 'elevenlabs' | 'models' | 'hub';

export interface WipeTarget {
  id: WipeId;
  label: string;
  /** What the person loses, in a few words. */
  detail: string;
  asyncKeys: string[];
  secureKeys: string[];
  /** Folders under the app's document or cache directory, relative, with a trailing slash. */
  dirs: { base: 'document' | 'cache'; name: string }[];
  /** Large downloads that the person may choose to keep. */
  keepable: boolean;
}

/** Everything Beacon stores, grouped for people. Pure: no device access. */
export function listWipeTargets(): WipeTarget[] {
  return [
    {
      id: 'settings',
      label: 'Your name and settings',
      detail: 'Name, language, contacts, medical ID, zones, and your saved location and cached feeds',
      asyncKeys: ['beacon.settings.v1', 'beacon.lastFix', 'beacon.alerts.v1', 'beacon.news.v1'],
      secureKeys: [],
      dirs: [],
      keepable: false,
    },
    {
      id: 'mesh',
      label: 'Chats and mesh history',
      detail: 'Messages, board posts and envelopes kept for nearby phones',
      asyncKeys: ['beacon.mesh.snapshot.v1'],
      secureKeys: [],
      dirs: [],
      keepable: false,
    },
    {
      id: 'identity',
      label: 'Identity keys',
      detail: 'This phone’s private keys, which sign alerts and reports',
      asyncKeys: ['beacon.identity.v1'], // web preview fallback; a no-op on the phone
      secureKeys: ['beacon.identity.v1'],
      dirs: [],
      keepable: false,
    },
    {
      id: 'reports',
      label: 'Saved reports and outbox',
      detail: 'Photos and reports waiting to upload, and messages queued for the server',
      asyncKeys: ['beacon.outbox.v1', 'beacon.reportQueue.v1'],
      secureKeys: [],
      dirs: [{ base: 'document', name: 'reports/' }],
      keepable: false,
    },
    {
      id: 'elevenlabs',
      label: 'ElevenLabs key',
      detail: 'Your voice API key and the voices you picked',
      asyncKeys: ['beacon.elevenlabs.voices.v1'],
      secureKeys: ['beacon.elevenlabs.key'],
      dirs: [{ base: 'cache', name: 'tts/' }],
      keepable: false,
    },
    {
      id: 'models',
      label: 'Downloaded models',
      detail: 'Offline photo helper and offline map areas. They hold no personal data.',
      asyncKeys: [],
      secureKeys: [],
      dirs: [
        { base: 'document', name: 'vlm/' },
        { base: 'document', name: 'maps/' },
      ],
      keepable: true,
    },
    {
      id: 'hub',
      label: 'Hub pairing',
      detail: 'The link to your desktop hub and its inbox',
      asyncKeys: ['beacon.hub.v1'],
      secureKeys: [],
      dirs: [],
      keepable: false,
    },
  ];
}

/** The device operations a wipe needs. Real adapters come from realStorage(); tests pass fakes. */
export interface Storage {
  documentDir: string;
  cacheDir: string;
  asyncKeys(): Promise<string[]>;
  asyncRemove(key: string): Promise<void>;
  secureDelete(key: string): Promise<void>;
  deleteDir(uri: string): Promise<void>;
  /** Stops the Bluetooth mesh node. */
  stopMesh(): Promise<void>;
  /** Puts every zustand store back to its defaults (this also clears in-memory copies of secrets). */
  resetStores(): Promise<void>;
}

export interface WipeOptions {
  /** Keep the offline photo helper and map downloads. */
  keepModels?: boolean;
  /** Defaults to the real device adapters. */
  storage?: Storage;
}

export interface WipeSummary {
  /** Number of keys, key chains and folders removed. */
  cleared: number;
  /** Human-readable names of the steps that failed. The wipe still continues past them. */
  failed: string[];
}

/** Real device adapters. Imports are dynamic so that importing this module never loads native code. */
export async function realStorage(): Promise<Storage> {
  const [{ default: AS }, SS, FS, { Platform }, { useMesh }, { useSettings }, { useHub }, { useEleven }, { useMap }, vlm, { resetIdentityCache }] = await Promise.all([
    import('@react-native-async-storage/async-storage'),
    import('expo-secure-store'),
    import('expo-file-system/legacy'),
    import('react-native'),
    import('./mesh'),
    import('../state/settings'),
    import('./hub'),
    import('./elevenlabs'),
    import('./maps'),
    import('./vlm'),
    import('./identity'),
  ]);
  return {
    documentDir: FS.documentDirectory ?? '',
    cacheDir: FS.cacheDirectory ?? '',
    asyncKeys: async () => [...(await AS.getAllKeys())],
    asyncRemove: (k) => AS.removeItem(k),
    // On web the identity and ElevenLabs keys live in AsyncStorage (see their services), so mirror that here.
    secureDelete: (k) => (Platform.OS === 'web' ? AS.removeItem(k) : SS.deleteItemAsync(k)),
    deleteDir: (uri) => FS.deleteAsync(uri, { idempotent: true }),
    stopMesh: () => useMesh.getState().stop(),
    resetStores: async () => {
      // Settings first: resetting re-saves defaults, and the key sweep that follows removes them again.
      useSettings.getState().reset();
      resetIdentityCache();
      useHub.setState({ paired: null, messages: [], lastSince: 0 });
      useMap.setState({ area: null, loaded: false, error: null });
      vlm.release();
      vlm.useVlm.setState({ status: 'unknown', progress: 0, error: null });
      // clear() also drops the ElevenLabs key held in memory
      await useEleven.getState().clear();
    },
  };
}

/**
 * Erases everything listed in listWipeTargets(). Never throws: each step is caught, and the names of the steps
 * that failed are returned in `failed`.
 */
export async function wipeEverything(opts: WipeOptions = {}): Promise<WipeSummary> {
  const failed: string[] = [];
  let cleared = 0;

  let s: Storage;
  try {
    s = opts.storage ?? (await realStorage());
  } catch {
    return { cleared: 0, failed: ['device storage'] };
  }

  const active = listWipeTargets().filter((t) => !(opts.keepModels && t.keepable));

  try {
    await s.stopMesh();
  } catch {
    failed.push('mesh');
  }
  try {
    await s.resetStores();
  } catch {
    failed.push('app state');
  }

  // Every beacon.* key, plus any named explicitly in the targets (in case listing keys fails).
  let listed: string[] = [];
  try {
    listed = await s.asyncKeys();
  } catch {
    failed.push('key list');
  }
  const keys = new Set<string>([...listed.filter((k) => k.startsWith(KEY_PREFIX)), ...active.flatMap((t) => t.asyncKeys)]);
  for (const k of keys) {
    try {
      await s.asyncRemove(k);
      cleared++;
    } catch {
      failed.push(k);
    }
  }

  for (const t of active) {
    for (const k of t.secureKeys) {
      try {
        await s.secureDelete(k);
        cleared++;
      } catch {
        failed.push(k);
      }
    }
    for (const d of t.dirs) {
      try {
        const root = d.base === 'cache' ? s.cacheDir : s.documentDir;
        if (!root) continue; // this platform has no such directory
        await s.deleteDir(root + d.name);
        cleared++;
      } catch {
        failed.push(t.label);
      }
    }
  }

  return { cleared, failed };
}
