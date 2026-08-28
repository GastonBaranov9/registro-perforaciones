import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { PluginListenerHandle } from '@capacitor/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NativeBackendConfigService } from '../../../core/native/native-backend-config.service';
import { NativeMetadataService } from '../../../core/native/native-metadata.service';
import { CAPACITOR_APP } from '../../../core/native/native-plugin.tokens';
import { nativeAuthMutationContext } from '../../../core/native/native-auth-http-context';
import {
  isValidNativeToken,
  type NativeLogoutPendingRecord,
  NativeInstallationStorage,
  NativeLogoutPendingStorage,
  NativeSecureSessionStorage,
  NativeStorageError,
} from '../../../core/native/native-storage.service';
import {
  RuntimePlatformService,
  RuntimePlatformUnknownError,
} from '../../../core/native/runtime-platform.service';
import { MainStore } from '../mainstore-service/main.store';
import { Rol, UsuarioPublico } from '../../types/schemas';

const NATIVE_LOGIN = 'auth/native/login';
const NATIVE_SESSION = 'auth/native/session';
const NATIVE_LOGOUT = 'auth/native/logout';
const NATIVE_LOGOUT_ALL = 'auth/native/logout-all';
const RESUME_REVALIDATION_MS = 5 * 60 * 1_000;
const SESSION_BOOTSTRAP_TIMEOUT_MS = 10_000;

export type AuthState =
  | 'initializing'
  | 'unauthenticated'
  | 'authenticated'
  | 'offline-unverified'
  | 'logout-pending'
  | 'upgrade-required'
  | 'client-error';

interface NativeUser {
  id_usuario: number;
  nombre: string;
  roles: Rol[];
}

interface NativeLoginResponse {
  token_type: 'Bearer';
  session_token: string;
  expires_at: string;
  user: NativeUser;
}

interface NativeSessionResponse {
  user: NativeUser;
  expires_at: string;
}

export class NativeBusinessRequestBlockedError extends Error {
  constructor() {
    super('La sesión mobile todavía no está validada.');
    this.name = 'NativeBusinessRequestBlockedError';
  }
}

function isNativeUser(value: unknown): value is NativeUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return (
    Number.isInteger(user['id_usuario']) &&
    typeof user['nombre'] === 'string' &&
    user['nombre'].length > 0 &&
    Array.isArray(user['roles']) &&
    user['roles'].every(
      (role) =>
        !!role &&
        typeof role === 'object' &&
        Number.isInteger((role as Record<string, unknown>)['id_rol']) &&
        typeof (role as Record<string, unknown>)['nombre'] === 'string' &&
        typeof (role as Record<string, unknown>)['descr'] === 'string',
    )
  );
}

function isExpiration(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly httpClient = inject(HttpClient);
  private readonly mainStore = inject(MainStore);
  private readonly router = inject(Router);
  private readonly runtime = inject(RuntimePlatformService);
  private readonly backendConfig = inject(NativeBackendConfigService);
  private readonly metadata = inject(NativeMetadataService);
  private readonly secureStorage = inject(NativeSecureSessionStorage);
  private readonly installationStorage = inject(NativeInstallationStorage);
  private readonly pendingStorage = inject(NativeLogoutPendingStorage);
  private readonly app = inject(CAPACITOR_APP);

  readonly state = signal<AuthState>('initializing');
  readonly expiresAt = signal<string | null>(null);

  private nativeToken: string | null = null;
  private nativeAuthGeneration = 0;
  private installationId: string | null = null;
  private pendingLogoutUserId: number | null = null;
  private bootstrapFlight?: Promise<void>;
  private restoreFlight?: Promise<void>;
  private invalidationFlight?: Promise<void>;
  private nativeLoginFlight?: Promise<void>;
  private nativeMutationLock: Promise<void> = Promise.resolve();
  private upgradeFlight?: Promise<void>;
  private resumeFlight?: Promise<void>;
  private lifecycleListener?: PluginListenerHandle;
  private backgroundAt: number | null = null;

  public baseURL = environment.apiURL + 'login';

  isNative(): boolean {
    return this.runtime.isNative();
  }

  isWeb(): boolean {
    return this.runtime.isWeb();
  }

  bootstrap(): Promise<void> {
    this.bootstrapFlight ??= this.bootstrapInternal().finally(() => {
      this.installLifecycleListener();
    });
    return this.bootstrapFlight;
  }

  public async logged(email: string, password: string): Promise<void> {
    switch (this.runtime.platform()) {
      case 'web':
        return this.webLogin(email, password);
      case 'android':
      case 'ios':
        return this.nativeLogin(email, password);
      case 'unknown':
        throw this.failUnknownRuntime();
    }
  }

  public async logout(): Promise<void> {
    switch (this.runtime.platform()) {
      case 'web':
        try {
          await firstValueFrom(this.httpClient.post<void>(environment.apiURL + 'logout', null));
        } finally {
          this.mainStore.clearSession();
          this.state.set('unauthenticated');
        }
        return;
      case 'android':
      case 'ios':
        return this.withNativeAuthMutationLock(() => this.nativeLogoutLocked());
      case 'unknown':
        throw this.failUnknownRuntime();
    }
  }

  public async logoutAll(): Promise<void> {
    if (this.runtime.isWeb()) return this.logout();
    if (!this.runtime.isNative()) throw this.failUnknownRuntime();
    return this.withNativeAuthMutationLock(async () => {
      if (!this.nativeToken) return this.finishLocalLogout();
      try {
        await firstValueFrom(
          this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT_ALL, null, {
            context: nativeAuthMutationContext(),
          }),
        );
        await this.finishLocalLogout();
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          await this.finishLocalLogout();
          await this.navigateOnce('/login');
          return;
        }
        if (error instanceof HttpErrorResponse && error.status === 426) {
          await this.handleNative426();
          return;
        }
        throw new Error('No fue posible cerrar todas las sesiones.');
      }
    });
  }

  public async getUser(): Promise<void> {
    if (this.runtime.isNative()) return this.restoreNativeSession();
    if (!this.runtime.isWeb()) throw this.failUnknownRuntime();
    try {
      const user = await firstValueFrom(
        this.httpClient.get<UsuarioPublico>(this.baseURL).pipe(timeout({ each: SESSION_BOOTSTRAP_TIMEOUT_MS })),
      );
      this.mainStore.setUser(user);
      this.state.set('authenticated');
    } catch (error) {
      this.mainStore.clearSession();
      this.state.set('unauthenticated');
      if (error instanceof HttpErrorResponse && error.status === 0) {
        throw new Error('Sin conexión. No fue posible validar la sesión.');
      }
      throw error;
    }
  }

  nativeAuthorizationFor(pathname: string): string | null {
    return this.nativeRequestAuthSnapshot(pathname)?.token ?? null;
  }

  nativeRequestAuthSnapshot(pathname: string): { token: string; generation: number } | null {
    if (!this.nativeToken) return null;
    if (pathname === `/api/${NATIVE_LOGIN}`) return null;
    if (pathname === `/api/${NATIVE_LOGOUT}`) return { token: this.nativeToken, generation: this.nativeAuthGeneration };
    if (pathname === `/api/${NATIVE_SESSION}`) {
      return this.state() === 'logout-pending' ? null : { token: this.nativeToken, generation: this.nativeAuthGeneration };
    }
    if (pathname === `/api/${NATIVE_LOGOUT_ALL}`) {
      return this.state() === 'logout-pending' ? null : { token: this.nativeToken, generation: this.nativeAuthGeneration };
    }
    if (this.state() !== 'authenticated') throw new NativeBusinessRequestBlockedError();
    return { token: this.nativeToken, generation: this.nativeAuthGeneration };
  }

  async handleNative401(expectedGeneration?: number): Promise<void> {
    if (this.runtime.isWeb()) return;
    if (!this.runtime.isNative()) {
      this.failUnknownRuntime();
      return;
    }
    if (expectedGeneration !== undefined && expectedGeneration !== this.nativeAuthGeneration) return;
    this.invalidationFlight ??= this.withNativeAuthMutationLock(async () => {
      if (expectedGeneration !== undefined && expectedGeneration !== this.nativeAuthGeneration) return;
      this.setNativeToken(null);
      this.expiresAt.set(null);
      this.mainStore.clearSession();
      try {
        await this.secureStorage.clear();
        await this.pendingStorage.clear();
      } catch {
        // El estado en memoria permanece cerrado aunque el SO no permita limpiar ahora.
      }
      this.state.set('unauthenticated');
      await this.navigateOnce('/login');
    }).finally(() => {
      this.invalidationFlight = undefined;
    });
    return this.invalidationFlight;
  }

  async handleNative426(): Promise<void> {
    if (this.runtime.isWeb()) return;
    if (!this.runtime.isNative()) {
      this.failUnknownRuntime();
      return;
    }
    this.upgradeFlight ??= (async () => {
      this.mainStore.clearSession();
      this.state.set('upgrade-required');
      await this.navigateOnce('/upgrade-required');
    })().finally(() => {
      this.upgradeFlight = undefined;
    });
    return this.upgradeFlight;
  }

  async handleAppStateChange(isActive: boolean, now = Date.now()): Promise<void> {
    if (this.runtime.isWeb()) return;
    if (!this.runtime.isNative()) {
      this.failUnknownRuntime();
      return;
    }
    if (!isActive) {
      this.backgroundAt = now;
      return;
    }

    const elapsed = this.backgroundAt === null ? 0 : now - this.backgroundAt;
    this.backgroundAt = null;
    if (this.state() !== 'logout-pending' && elapsed < RESUME_REVALIDATION_MS) return;

    this.resumeFlight ??= (this.state() === 'logout-pending'
      ? this.withNativeAuthMutationLock(() => this.retryPendingLogoutLocked())
      : this.restoreNativeSession()
    ).finally(() => {
      this.resumeFlight = undefined;
    });
    return this.resumeFlight;
  }

  public userId(): number | null {
    return this.mainStore.user()?.id_usuario ?? null;
  }

  public tieneRol(nombre: string): boolean {
    return this.mainStore.user()?.roles?.some((rol) => rol.nombre === nombre) ?? false;
  }

  public puedeAdministrarPozos(): boolean {
    return this.tieneRol('administracion') || this.tieneRol('perforador');
  }

  private async bootstrapInternal(): Promise<void> {
    this.state.set('initializing');
    switch (this.runtime.platform()) {
      case 'web':
        try {
          await this.getUser();
        } catch {
          // La web conserva su sesión cookie y muestra login si no puede restaurarla.
        }
        return;
      case 'unknown':
        this.failUnknownRuntime();
        return;
      case 'android':
      case 'ios':
        break;
    }

    try {
      this.backendConfig.origin();
      await this.metadata.current();
      const existingInstallation = await this.installationStorage.loadExisting();
      const storedSession = await this.secureStorage.load();
      const logoutPending = await this.pendingStorage.load();

      if (
        storedSession &&
        (!existingInstallation || storedSession.installationId !== existingInstallation)
      ) {
        await this.secureStorage.clear();
        if (logoutPending) {
          this.pendingLogoutUserId = logoutPending.userId;
          this.state.set('client-error');
          return;
        }
        this.installationId = existingInstallation ?? (await this.installationStorage.create());
        this.state.set('unauthenticated');
        return;
      }

      this.installationId = existingInstallation ?? (await this.installationStorage.create());
      if (!storedSession) {
        if (logoutPending) {
          this.pendingLogoutUserId = logoutPending.userId;
          await this.clearPendingBestEffort();
          this.state.set('unauthenticated');
          return;
        }
        this.state.set('unauthenticated');
        return;
      }

      this.setNativeToken(storedSession.token);
      if (logoutPending) {
        this.pendingLogoutUserId = logoutPending.userId;
        this.state.set('logout-pending');
        await this.withNativeAuthMutationLock(() => this.retryPendingLogoutLocked());
        return;
      }
      await this.restoreNativeSession();
    } catch (error) {
      this.mainStore.clearSession();
      if (error instanceof NativeStorageError) this.setNativeToken(null);
      this.state.set('client-error');
    }
  }

  private async webLogin(email: string, password: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpClient.post<{ authenticated: true }>(this.baseURL, { email, password }),
      );
      const user = await firstValueFrom(this.httpClient.get<UsuarioPublico>(this.baseURL));
      this.mainStore.setUser(user);
      this.state.set('authenticated');
    } catch (error) {
      this.mainStore.clearSession();
      this.state.set('unauthenticated');
      if (error instanceof HttpErrorResponse) {
        if (error.status === 400 || error.status === 401) {
          throw new Error('Email o contraseña incorrectas');
        }
        if (error.status === 0) throw new Error('Sin conexión. No fue posible iniciar sesión.');
      }
      throw new Error('Error al iniciar sesión');
    }
  }

  private nativeLogin(email: string, password: string): Promise<void> {
    this.nativeLoginFlight ??= this.withNativeAuthMutationLock(() =>
      this.nativeLoginInternal(email, password),
    ).finally(() => {
      this.nativeLoginFlight = undefined;
    });
    return this.nativeLoginFlight;
  }

  private async nativeLoginInternal(email: string, password: string): Promise<void> {
    const previousState = this.state();
    const hadExistingToken = this.nativeToken !== null;
    const existingUser = this.mainStore.user();
    let pendingAtStart: NativeLogoutPendingRecord | null =
      this.state() === 'logout-pending' ? { userId: this.pendingLogoutUserId } : null;
    this.state.set('initializing');
    try {
      this.backendConfig.origin();
      await this.metadata.current();
      await this.pendingStorage.verifyWritable();
      this.installationId ??=
        (await this.installationStorage.loadExisting()) ??
        (await this.installationStorage.create());

      const storedPending = await this.pendingStorage.load();
      if (pendingAtStart && !storedPending) throw new NativeStorageError();
      pendingAtStart = storedPending ?? pendingAtStart;
      if (this.nativeToken) {
        // A must be revoked before the login request can create B. The backend
        // only replaces sessions for the same user and installation.
        pendingAtStart = { userId: this.pendingLogoutUserId ?? this.userId() };
        await this.revokeActiveTokenBeforeLogin();
        pendingAtStart = null;
      }
      // Verifica escritura de Preferences sin cancelar un pending existente.
      await this.pendingStorage.clear();

      const response = await firstValueFrom(
        this.httpClient.post<NativeLoginResponse>(environment.apiURL + NATIVE_LOGIN, {
          email,
          password,
          installation_id: this.installationId,
        }),
      );

      if (response?.token_type !== 'Bearer' || !isValidNativeToken(response.session_token)) {
        throw new NativeStorageError();
      }
      if (!isExpiration(response.expires_at) || !isNativeUser(response.user)) {
        await this.discardUncommittedLogin(response.session_token);
        throw new NativeStorageError();
      }

      try {
        await this.secureStorage.save({
          token: response.session_token,
          installationId: this.installationId,
        });
      } catch {
        await this.discardUncommittedLogin(response.session_token);
        throw new NativeStorageError();
      }

      this.setNativeToken(response.session_token);
      this.expiresAt.set(response.expires_at);
      this.mainStore.setUser(response.user);
      try {
        await this.pendingStorage.clear();
      } catch {
        await this.discardUncommittedLogin(response.session_token);
        throw new NativeStorageError();
      }
      this.pendingLogoutUserId = null;
      this.state.set('authenticated');
    } catch (error) {
      if (this.state() === 'upgrade-required') {
        throw new Error('Debes actualizar la aplicación para continuar.');
      }
      if (error instanceof NativeStorageError) {
        if (hadExistingToken && this.nativeToken) {
          // If preparing A for revocation failed, retain A and do not strand it.
          if (pendingAtStart) {
            this.mainStore.clearSession();
            this.state.set('logout-pending');
          } else if (previousState === 'authenticated' && existingUser) {
            if (existingUser) this.mainStore.setUser(existingUser);
            this.state.set('authenticated');
          } else {
            this.mainStore.clearSession();
            this.state.set(previousState === 'authenticated' ? 'client-error' : previousState);
          }
          throw error;
        }
        this.setNativeToken(null);
        this.mainStore.clearSession();
        this.state.set('client-error');
        throw error;
      }
      this.mainStore.clearSession();
      this.state.set(pendingAtStart ? 'logout-pending' : 'unauthenticated');
      if (error instanceof HttpErrorResponse) {
        if (error.status === 401) throw new Error('Email o contraseña incorrectas');
        if (error.status === 0) throw new Error('Sin conexión. No fue posible iniciar sesión.');
      }
      throw new Error('Error al iniciar sesión');
    }
  }

  private restoreNativeSession(): Promise<void> {
    this.restoreFlight ??= this.restoreNativeSessionInternal().finally(() => {
      this.restoreFlight = undefined;
    });
    return this.restoreFlight;
  }

  private async restoreNativeSessionInternal(): Promise<void> {
    if (!this.nativeToken) {
      this.mainStore.clearSession();
      this.state.set('unauthenticated');
      return;
    }
    const authSnapshot = this.nativeRequestAuthSnapshot(`/api/${NATIVE_SESSION}`);
    if (!authSnapshot) return;
    this.state.set('initializing');
    this.mainStore.clearSession();
    try {
      const response = await firstValueFrom(
        this.httpClient
          .get<NativeSessionResponse>(environment.apiURL + NATIVE_SESSION)
          .pipe(timeout({ each: SESSION_BOOTSTRAP_TIMEOUT_MS })),
      );
      if (authSnapshot.generation !== this.nativeAuthGeneration) return;
      if (!isNativeUser(response?.user) || !isExpiration(response.expires_at)) {
        await this.handleNative401(authSnapshot.generation);
        return;
      }
      this.expiresAt.set(response.expires_at);
      this.mainStore.setUser(response.user);
      this.state.set('authenticated');
    } catch (error) {
      if (authSnapshot.generation !== this.nativeAuthGeneration) return;
      if (this.state() === 'unauthenticated' || this.state() === 'upgrade-required') return;
      if (error instanceof HttpErrorResponse && error.status === 401) {
        await this.handleNative401(authSnapshot.generation);
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 426) {
        await this.handleNative426();
        return;
      }
      await this.blockVisibleNativeSession('offline-unverified', 'offline');
    }
  }

  private async nativeLogoutLocked(): Promise<void> {
    if (!this.nativeToken) {
      if (this.state() === 'logout-pending') {
        return this.retryPendingLogoutLocked();
      }
      return this.finishLocalLogout();
    }
    if (this.state() === 'logout-pending') return this.retryPendingLogoutLocked();

    const pendingUserId = this.userId();
    try {
      await this.pendingStorage.setPending(pendingUserId);
      this.pendingLogoutUserId = pendingUserId;
    } catch {
      // Sin marker durable no se abandona una sesión que todavía puede ser válida.
      throw new NativeStorageError();
    }
    this.mainStore.clearSession();
    this.state.set('logout-pending');
    this.advanceNativeAuthGeneration();
    await this.retryPendingLogoutLocked();
  }

  private async revokeActiveTokenBeforeLogin(): Promise<void> {
    const userId = this.pendingLogoutUserId ?? this.userId();
    try {
      await this.pendingStorage.setPending(userId);
    } catch {
      throw new NativeStorageError();
    }
    this.pendingLogoutUserId = userId;
    this.mainStore.clearSession();
    this.state.set('logout-pending');
    this.advanceNativeAuthGeneration();

    try {
      await firstValueFrom(
        this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT, null, {
          context: nativeAuthMutationContext(),
        }),
      );
    } catch {
      throw new Error('No fue posible revocar la sesion anterior.');
    }

    try {
      await this.secureStorage.clear();
    } catch {
      // Keep the pending marker so a restart retries the already-idempotent
      // revocation before any session restore.
      this.setNativeToken(null);
      this.expiresAt.set(null);
      this.mainStore.clearSession();
      throw new NativeStorageError();
    }
    this.setNativeToken(null);
    this.expiresAt.set(null);
    this.mainStore.clearSession();
    try { await this.pendingStorage.clear(); } catch { /* best effort after 204 */ }
    this.pendingLogoutUserId = null;
    this.state.set('unauthenticated');
  }

  private async retryPendingLogoutLocked(): Promise<void> {
    if (!this.nativeToken) {
      this.mainStore.clearSession();
      await this.clearPendingBestEffort();
      this.pendingLogoutUserId = null;
      this.state.set('unauthenticated');
      return;
    }
    this.mainStore.clearSession();
    this.state.set('logout-pending');
    try {
      await firstValueFrom(
        this.httpClient
          .post<void>(environment.apiURL + NATIVE_LOGOUT, null, {
            context: nativeAuthMutationContext(),
          })
          .pipe(timeout({ each: SESSION_BOOTSTRAP_TIMEOUT_MS })),
      );
      await this.finishLocalLogout();
    } catch {
      this.state.set('logout-pending');
    }
  }

  private async finishLocalLogout(): Promise<void> {
    try { await this.secureStorage.clear(); } catch { /* remote revocation is authoritative */ }
    this.setNativeToken(null);
    this.expiresAt.set(null);
    this.mainStore.clearSession();
    try { await this.pendingStorage.clear(); } catch { /* marker orphan is non-authenticating */ }
    this.pendingLogoutUserId = null;
    this.state.set('unauthenticated');
  }

  private async clearPendingBestEffort(): Promise<void> {
    try { await this.pendingStorage.clear(); } catch { /* marker huérfano no autentica */ }
  }

  private async revokeUncommittedToken(token: string): Promise<void> {
    const previousToken = this.nativeToken;
    this.nativeToken = token;
    try {
      await firstValueFrom(
        this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT, null, {
          context: nativeAuthMutationContext(),
        }),
      );
    } catch {
      // Best-effort: el token no se guarda en un fallback y expira server-side.
    } finally {
      this.nativeToken = previousToken;
    }
  }

  private async discardUncommittedLogin(token: string): Promise<void> {
    await this.revokeUncommittedToken(token);
    try {
      await this.secureStorage.clear();
    } catch {
      // La operación original ya informó que el storage no es confiable.
    }
    this.setNativeToken(null);
  }

  private installLifecycleListener(): void {
    if (!this.runtime.isNative() || this.lifecycleListener) return;
    void this.app
      .addListener('appStateChange', ({ isActive }) => {
        void this.handleAppStateChange(isActive);
      })
      .then((listener) => {
        this.lifecycleListener = listener;
      })
      .catch(() => {
        void this.blockVisibleNativeSession('client-error', 'client-error');
      });
  }

  private failUnknownRuntime(): RuntimePlatformUnknownError {
    this.setNativeToken(null);
    this.expiresAt.set(null);
    this.mainStore.clearSession();
    this.state.set('client-error');
    return new RuntimePlatformUnknownError();
  }

  private setNativeToken(token: string | null): void {
    if (this.nativeToken === token) return;
    this.nativeToken = token;
    this.nativeAuthGeneration++;
  }

  private advanceNativeAuthGeneration(): void {
    this.nativeAuthGeneration++;
  }

  private withNativeAuthMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.nativeMutationLock.then(operation, operation);
    this.nativeMutationLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private async blockVisibleNativeSession(
    state: 'offline-unverified' | 'client-error',
    reason: 'offline' | 'client-error',
  ): Promise<void> {
    this.mainStore.clearSession();
    this.state.set(state);
    await this.navigateOnce(`/session-unavailable?reason=${reason}`);
  }

  private async navigateOnce(path: string): Promise<void> {
    if (this.router.url === path) return;
    try {
      await this.router.navigateByUrl(path);
    } catch {
      // Los guards aplicarán el mismo estado cuando la navegación inicial esté disponible.
    }
  }
}
