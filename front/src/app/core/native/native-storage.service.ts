import { inject, Injectable } from '@angular/core';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import {
  CAPACITOR_PREFERENCES,
  CAPACITOR_SECURE_STORAGE,
} from './native-plugin.tokens';
import { RuntimePlatformService } from './runtime-platform.service';

const SESSION_KEY = 'native_session_v1';
const INSTALLATION_KEY = 'installation_id_v1';
const LOGOUT_PENDING_KEY = 'logout_pending_v1';
const STORAGE_PROBE_KEY = 'native_storage_probe_v1';
const SECURE_PREFIX = 'rsp_native_';
const PREFERENCES_GROUP = 'RspNativeClient';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_TOKEN = /^rspn1_[A-Za-z0-9_-]{43}$/;

export class NativeStorageError extends Error {
  constructor() {
    super('No fue posible acceder al almacenamiento seguro de la aplicación.');
    this.name = 'NativeStorageError';
  }
}

export interface StoredNativeSession {
  token: string;
  installationId: string;
}

export interface NativeLogoutPendingRecord {
  userId: number | null;
}

export function isValidInstallationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function isValidNativeToken(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_TOKEN.test(value);
}

@Injectable({ providedIn: 'root' })
export class NativeSecureSessionStorage {
  private readonly plugin = inject(CAPACITOR_SECURE_STORAGE);
  private readonly runtime = inject(RuntimePlatformService);
  private initialization?: Promise<void>;

  async load(): Promise<StoredNativeSession | null> {
    await this.initialize();
    try {
      const value = await this.plugin.get(SESSION_KEY, false, false);
      if (value === null) return null;
      if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !isValidNativeToken((value as Record<string, unknown>)['token']) ||
        !isValidInstallationId((value as Record<string, unknown>)['installationId'])
      ) {
        await this.plugin.remove(SESSION_KEY, false);
        throw new NativeStorageError();
      }
      return value as unknown as StoredNativeSession;
    } catch (error) {
      if (error instanceof NativeStorageError) throw error;
      throw new NativeStorageError();
    }
  }

  async save(session: StoredNativeSession): Promise<void> {
    if (!isValidNativeToken(session.token) || !isValidInstallationId(session.installationId)) {
      throw new NativeStorageError();
    }
    await this.initialize();
    try {
      await this.plugin.set(
        SESSION_KEY,
        { token: session.token, installationId: session.installationId },
        false,
        false,
        KeychainAccess.whenUnlockedThisDeviceOnly,
      );
    } catch {
      throw new NativeStorageError();
    }
  }

  async clear(): Promise<void> {
    await this.initialize();
    try {
      await this.plugin.remove(SESSION_KEY, false);
    } catch {
      throw new NativeStorageError();
    }
  }

  private initialize(): Promise<void> {
    if (!this.runtime.isNative()) return Promise.reject(new NativeStorageError());
    this.initialization ??= (async () => {
      try {
        await this.plugin.setKeyPrefix(SECURE_PREFIX);
        await this.plugin.setSynchronize(false);
        await this.plugin.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
      } catch {
        this.initialization = undefined;
        throw new NativeStorageError();
      }
    })();
    return this.initialization;
  }
}

@Injectable({ providedIn: 'root' })
export class NativeInstallationStorage {
  private readonly preferences = inject(CAPACITOR_PREFERENCES);
  private readonly runtime = inject(RuntimePlatformService);
  private configuration?: Promise<void>;

  async loadExisting(): Promise<string | null> {
    await this.configure();
    try {
      const { value } = await this.preferences.get({ key: INSTALLATION_KEY });
      if (value === null) return null;
      if (!isValidInstallationId(value)) {
        await this.preferences.remove({ key: INSTALLATION_KEY });
        return null;
      }
      return value;
    } catch {
      throw new NativeStorageError();
    }
  }

  async create(): Promise<string> {
    await this.configure();
    const installationId = globalThis.crypto.randomUUID();
    try {
      await this.preferences.set({ key: INSTALLATION_KEY, value: installationId });
      return installationId;
    } catch {
      throw new NativeStorageError();
    }
  }

  private configure(): Promise<void> {
    if (!this.runtime.isNative()) return Promise.reject(new NativeStorageError());
    this.configuration ??= this.preferences
      .configure({ group: PREFERENCES_GROUP })
      .catch(() => {
        this.configuration = undefined;
        throw new NativeStorageError();
      });
    return this.configuration;
  }
}

@Injectable({ providedIn: 'root' })
export class NativeLogoutPendingStorage {
  private readonly preferences = inject(CAPACITOR_PREFERENCES);
  private readonly runtime = inject(RuntimePlatformService);
  private configuration?: Promise<void>;

  async load(): Promise<NativeLogoutPendingRecord | null> {
    await this.configure();
    try {
      const value = (await this.preferences.get({ key: LOGOUT_PENDING_KEY })).value;
      if (value === null) return null;
      // Compatibilidad con el flag booleano escrito por RSP-09C antes de R1.
      if (value === 'true') return { userId: null };
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (
        parsed['pending'] !== true ||
        !(
          parsed['userId'] === null ||
          (Number.isInteger(parsed['userId']) && Number(parsed['userId']) > 0)
        )
      ) {
        throw new NativeStorageError();
      }
      return { userId: parsed['userId'] as number | null };
    } catch {
      throw new NativeStorageError();
    }
  }

  async setPending(userId: number | null): Promise<void> {
    await this.configure();
    try {
      if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) {
        throw new NativeStorageError();
      }
      await this.preferences.set({
        key: LOGOUT_PENDING_KEY,
        value: JSON.stringify({ pending: true, userId }),
      });
    } catch {
      throw new NativeStorageError();
    }
  }

  async clear(): Promise<void> {
    await this.configure();
    try {
      await this.preferences.remove({ key: LOGOUT_PENDING_KEY });
    } catch {
      throw new NativeStorageError();
    }
  }

  async verifyWritable(): Promise<void> {
    await this.configure();
    const probeValue = `probe-${globalThis.crypto.randomUUID()}`;
    try {
      await this.preferences.set({ key: STORAGE_PROBE_KEY, value: probeValue });
      const stored = (await this.preferences.get({ key: STORAGE_PROBE_KEY })).value;
      if (stored !== probeValue) throw new NativeStorageError();
      await this.preferences.remove({ key: STORAGE_PROBE_KEY });
    } catch {
      try { await this.preferences.remove({ key: STORAGE_PROBE_KEY }); } catch { /* best effort */ }
      throw new NativeStorageError();
    }
  }

  private configure(): Promise<void> {
    if (!this.runtime.isNative()) return Promise.reject(new NativeStorageError());
    this.configuration ??= this.preferences
      .configure({ group: PREFERENCES_GROUP })
      .catch(() => {
        this.configuration = undefined;
        throw new NativeStorageError();
      });
    return this.configuration;
  }
}
