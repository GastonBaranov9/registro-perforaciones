import { InjectionToken } from '@angular/core';
import { App, type AppInfo, type StateChangeListener } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  SecureStorage,
  type DataType,
  type KeychainAccess,
} from '@aparajita/capacitor-secure-storage';

export interface CapacitorRuntimeApi {
  getPlatform(): string;
  isNativePlatform(): boolean;
}

export interface NativeAppApi {
  getInfo(): Promise<AppInfo>;
  addListener(
    eventName: 'appStateChange',
    listener: StateChangeListener,
  ): Promise<PluginListenerHandle>;
}

export interface NativePreferencesApi {
  configure(options: { group?: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

export interface NativeSecureStorageApi {
  setSynchronize(sync: boolean): Promise<void>;
  setDefaultKeychainAccess(access: KeychainAccess): Promise<void>;
  setKeyPrefix(prefix: string): Promise<void>;
  get(key: string, convertDate?: boolean, sync?: boolean): Promise<DataType | null>;
  set(
    key: string,
    data: DataType,
    convertDate?: boolean,
    sync?: boolean,
    access?: KeychainAccess,
  ): Promise<void>;
  remove(key: string, sync?: boolean): Promise<boolean>;
}

export const CAPACITOR_RUNTIME = new InjectionToken<CapacitorRuntimeApi>(
  'CAPACITOR_RUNTIME',
  {
    providedIn: 'root',
    factory: () => ({
      getPlatform: () => Capacitor.getPlatform(),
      isNativePlatform: () => Capacitor.isNativePlatform(),
    }),
  },
);

export const CAPACITOR_APP = new InjectionToken<NativeAppApi>('CAPACITOR_APP', {
  providedIn: 'root',
  factory: () => ({
    getInfo: () => App.getInfo(),
    addListener: (eventName, listener) => App.addListener(eventName, listener),
  }),
});

export const CAPACITOR_PREFERENCES = new InjectionToken<NativePreferencesApi>(
  'CAPACITOR_PREFERENCES',
  {
    providedIn: 'root',
    factory: () => ({
      configure: (options) => Preferences.configure(options),
      get: (options) => Preferences.get(options),
      set: (options) => Preferences.set(options),
      remove: (options) => Preferences.remove(options),
    }),
  },
);

export const CAPACITOR_SECURE_STORAGE = new InjectionToken<NativeSecureStorageApi>(
  'CAPACITOR_SECURE_STORAGE',
  {
    providedIn: 'root',
    factory: () => ({
      setSynchronize: (sync) => SecureStorage.setSynchronize(sync),
      setDefaultKeychainAccess: (access) => SecureStorage.setDefaultKeychainAccess(access),
      setKeyPrefix: (prefix) => SecureStorage.setKeyPrefix(prefix),
      get: (key, convertDate, sync) => SecureStorage.get(key, convertDate, sync),
      set: (key, data, convertDate, sync, access) =>
        SecureStorage.set(key, data, convertDate, sync, access),
      remove: (key, sync) => SecureStorage.remove(key, sync),
    }),
  },
);
