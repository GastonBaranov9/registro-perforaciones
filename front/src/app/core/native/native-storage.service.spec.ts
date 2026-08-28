import { TestBed } from '@angular/core/testing';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import {
  CAPACITOR_PREFERENCES,
  CAPACITOR_RUNTIME,
  CAPACITOR_SECURE_STORAGE,
  type NativePreferencesApi,
  type NativeSecureStorageApi,
} from './native-plugin.tokens';
import {
  NativeInstallationStorage,
  NativeLogoutPendingStorage,
  NativeSecureSessionStorage,
} from './native-storage.service';

const token = `rspn1_${'A'.repeat(43)}`;
const installationId = '123e4567-e89b-42d3-a456-426614174000';

describe('storage native', () => {
  let secureValue: unknown;
  let secure: jasmine.SpyObj<NativeSecureStorageApi>;
  let preferences: jasmine.SpyObj<NativePreferencesApi>;
  let preferenceValue: string | null;

  beforeEach(() => {
    secureValue = null;
    preferenceValue = null;
    secure = jasmine.createSpyObj<NativeSecureStorageApi>('secure', [
      'setSynchronize', 'setDefaultKeychainAccess', 'setKeyPrefix', 'get', 'set', 'remove',
    ]);
    secure.setSynchronize.and.resolveTo();
    secure.setDefaultKeychainAccess.and.resolveTo();
    secure.setKeyPrefix.and.resolveTo();
    secure.get.and.callFake(async () => secureValue as never);
    secure.set.and.callFake(async (_key, value) => { secureValue = value; });
    secure.remove.and.callFake(async () => { secureValue = null; return true; });

    preferences = jasmine.createSpyObj<NativePreferencesApi>('preferences', [
      'configure', 'get', 'set', 'remove',
    ]);
    preferences.configure.and.resolveTo();
    preferences.get.and.callFake(async () => ({ value: preferenceValue }));
    preferences.set.and.callFake(async ({ value }) => { preferenceValue = value; });
    preferences.remove.and.callFake(async () => { preferenceValue = null; });

    TestBed.configureTestingModule({
      providers: [
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'android', isNativePlatform: () => true } },
        { provide: CAPACITOR_SECURE_STORAGE, useValue: secure },
        { provide: CAPACITOR_PREFERENCES, useValue: preferences },
      ],
    });
  });

  it('guarda token y binding juntos con Keychain no migrable/sin sync', async () => {
    const storage = TestBed.inject(NativeSecureSessionStorage);
    await storage.save({ token, installationId });
    expect(secure.setSynchronize).toHaveBeenCalledOnceWith(false);
    expect(secure.setDefaultKeychainAccess).toHaveBeenCalledOnceWith(
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
    expect(secure.set).toHaveBeenCalledWith(
      'native_session_v1',
      { token, installationId },
      false,
      false,
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
    await expectAsync(storage.load()).toBeResolvedTo({ token, installationId });
  });

  it('limpia un registro corrupto y no usa fallback web', async () => {
    secureValue = { token: 'invalido', installationId };
    const storage = TestBed.inject(NativeSecureSessionStorage);
    await expectAsync(storage.load()).toBeRejected();
    expect(secure.remove).toHaveBeenCalled();
  });

  it('installation_id se genera una vez, persiste y es UUID v4', async () => {
    const storage = TestBed.inject(NativeInstallationStorage);
    expect(await storage.loadExisting()).toBeNull();
    const created = await storage.create();
    expect(created).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await storage.loadExisting()).toBe(created);
    expect(preferences.configure).toHaveBeenCalledWith({ group: 'RspNativeClient' });
  });

  it('bloquea la creación si Preferences falla', async () => {
    preferences.set.and.rejectWith(new Error('fallo'));
    await expectAsync(TestBed.inject(NativeInstallationStorage).create()).toBeRejected();
  });

  it('persiste pending con usuario, acepta legacy y rechaza registros corruptos', async () => {
    const storage = TestBed.inject(NativeLogoutPendingStorage);
    await storage.setPending(7);
    expect(preferenceValue).toBe(JSON.stringify({ pending: true, userId: 7 }));
    expect(await storage.load()).toEqual({ userId: 7 });
    preferenceValue = 'true';
    expect(await storage.load()).toEqual({ userId: null });
    preferenceValue = '{"pending":false,"userId":7}';
    await expectAsync(storage.load()).toBeRejected();
  });

  it('rechaza cualquier uso accidental desde web', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'web', isNativePlatform: () => false } },
        { provide: CAPACITOR_SECURE_STORAGE, useValue: secure },
      ],
    });
    await expectAsync(TestBed.inject(NativeSecureSessionStorage).load()).toBeRejected();
    expect(secure.get).not.toHaveBeenCalled();
  });
});
