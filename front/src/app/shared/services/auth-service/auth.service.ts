import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { PluginListenerHandle } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NativeBackendConfigService } from '../../../core/native/native-backend-config.service';
import { NativeMetadataService } from '../../../core/native/native-metadata.service';
import { CAPACITOR_APP } from '../../../core/native/native-plugin.tokens';
import {
  isValidNativeToken,
  NativeInstallationStorage,
  NativeLogoutPendingStorage,
  NativeSecureSessionStorage,
  NativeStorageError,
} from '../../../core/native/native-storage.service';
import { RuntimePlatformService } from '../../../core/native/runtime-platform.service';
import { MainStore } from '../mainstore-service/main.store';
import { Rol, UsuarioPublico } from '../../types/schemas';

const NATIVE_LOGIN = 'auth/native/login';
const NATIVE_SESSION = 'auth/native/session';
const NATIVE_LOGOUT = 'auth/native/logout';
const NATIVE_LOGOUT_ALL = 'auth/native/logout-all';
const RESUME_REVALIDATION_MS = 5 * 60 * 1_000;

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
  private installationId: string | null = null;
  private bootstrapFlight?: Promise<void>;
  private restoreFlight?: Promise<void>;
  private invalidationFlight?: Promise<void>;
  private upgradeFlight?: Promise<void>;
  private resumeFlight?: Promise<void>;
  private lifecycleListener?: PluginListenerHandle;
  private backgroundAt: number | null = null;

  public baseURL = environment.apiURL + 'login';

  isNative(): boolean {
    return this.runtime.isNative();
  }

  bootstrap(): Promise<void> {
    this.bootstrapFlight ??= this.bootstrapInternal().finally(() => {
      this.installLifecycleListener();
    });
    return this.bootstrapFlight;
  }

  public async logged(email: string, password: string): Promise<void> {
    if (!this.runtime.isNative()) return this.webLogin(email, password);
    await this.nativeLogin(email, password);
  }

  public async logout(): Promise<void> {
    if (!this.runtime.isNative()) {
      try {
        await firstValueFrom(this.httpClient.post<void>(environment.apiURL + 'logout', null));
      } finally {
        this.mainStore.clearSession();
        this.state.set('unauthenticated');
      }
      return;
    }
    await this.nativeLogout();
  }

  public async logoutAll(): Promise<void> {
    if (!this.runtime.isNative()) return this.logout();
    if (!this.nativeToken) return this.finishLocalLogout();
    try {
      await firstValueFrom(
        this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT_ALL, null),
      );
      await this.finishLocalLogout();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 426) return;
      throw new Error('No fue posible cerrar todas las sesiones.');
    }
  }

  public async getUser(): Promise<void> {
    if (this.runtime.isNative()) return this.restoreNativeSession();
    try {
      const user = await firstValueFrom(this.httpClient.get<UsuarioPublico>(this.baseURL));
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
    if (!this.nativeToken) return null;
    if (pathname === `/api/${NATIVE_LOGIN}`) return null;
    if (pathname === `/api/${NATIVE_LOGOUT}`) return this.nativeToken;
    if (pathname === `/api/${NATIVE_SESSION}`) {
      return this.state() === 'logout-pending' ? null : this.nativeToken;
    }
    if (pathname === `/api/${NATIVE_LOGOUT_ALL}`) {
      return this.state() === 'logout-pending' ? null : this.nativeToken;
    }
    if (this.state() !== 'authenticated') throw new NativeBusinessRequestBlockedError();
    return this.nativeToken;
  }

  async handleNative401(): Promise<void> {
    if (!this.runtime.isNative()) return;
    this.invalidationFlight ??= (async () => {
      this.nativeToken = null;
      this.expiresAt.set(null);
      this.mainStore.clearSession();
      try {
        await this.secureStorage.clear();
        await this.pendingStorage.set(false);
      } catch {
        // El estado en memoria permanece cerrado aunque el SO no permita limpiar ahora.
      }
      this.state.set('unauthenticated');
      await this.navigateOnce('/login');
    })().finally(() => {
      this.invalidationFlight = undefined;
    });
    return this.invalidationFlight;
  }

  async handleNative426(): Promise<void> {
    if (!this.runtime.isNative()) return;
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
    if (!this.runtime.isNative()) return;
    if (!isActive) {
      this.backgroundAt = now;
      return;
    }

    const elapsed = this.backgroundAt === null ? 0 : now - this.backgroundAt;
    this.backgroundAt = null;
    if (this.state() !== 'logout-pending' && elapsed < RESUME_REVALIDATION_MS) return;

    this.resumeFlight ??= (this.state() === 'logout-pending'
      ? this.retryPendingLogout()
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
    if (!this.runtime.isNative()) {
      try {
        await this.getUser();
      } catch {
        // La web conserva su sesión cookie y muestra login si no puede restaurarla.
      }
      return;
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
        await this.pendingStorage.set(false);
        this.installationId = existingInstallation ?? (await this.installationStorage.create());
        this.state.set('unauthenticated');
        return;
      }

      this.installationId = existingInstallation ?? (await this.installationStorage.create());
      if (!storedSession) {
        if (logoutPending) await this.pendingStorage.set(false);
        this.state.set('unauthenticated');
        return;
      }

      this.nativeToken = storedSession.token;
      if (logoutPending) {
        this.state.set('logout-pending');
        await this.retryPendingLogout();
        return;
      }
      await this.restoreNativeSession();
    } catch (error) {
      this.mainStore.clearSession();
      if (error instanceof NativeStorageError) this.nativeToken = null;
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

  private async nativeLogin(email: string, password: string): Promise<void> {
    this.state.set('initializing');
    try {
      this.backendConfig.origin();
      await this.metadata.current();
      this.installationId ??=
        (await this.installationStorage.loadExisting()) ??
        (await this.installationStorage.create());

      // Preferences debe estar operativa antes de crear una sesión remota: si no
      // podemos persistir un logout pendiente, el cliente no puede revocarla con
      // seguridad después de un corte de red.
      await this.pendingStorage.set(false);

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
        await this.compensateFailedLogin(response.session_token);
        throw new NativeStorageError();
      }

      try {
        await this.secureStorage.save({
          token: response.session_token,
          installationId: this.installationId,
        });
      } catch {
        await this.compensateFailedLogin(response.session_token);
        throw new NativeStorageError();
      }

      this.nativeToken = response.session_token;
      this.expiresAt.set(response.expires_at);
      this.mainStore.setUser(response.user);
      this.state.set('authenticated');
    } catch (error) {
      if (this.state() === 'upgrade-required') {
        throw new Error('Debes actualizar la aplicación para continuar.');
      }
      if (error instanceof NativeStorageError) {
        this.nativeToken = null;
        this.mainStore.clearSession();
        this.state.set('client-error');
        throw error;
      }
      this.mainStore.clearSession();
      this.state.set('unauthenticated');
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
    this.state.set('initializing');
    this.mainStore.clearSession();
    try {
      const response = await firstValueFrom(
        this.httpClient.get<NativeSessionResponse>(environment.apiURL + NATIVE_SESSION),
      );
      if (!isNativeUser(response?.user) || !isExpiration(response.expires_at)) {
        await this.handleNative401();
        return;
      }
      this.expiresAt.set(response.expires_at);
      this.mainStore.setUser(response.user);
      this.state.set('authenticated');
    } catch (error) {
      if (this.state() === 'unauthenticated' || this.state() === 'upgrade-required') return;
      if (error instanceof HttpErrorResponse && error.status === 401) {
        await this.handleNative401();
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 426) {
        await this.handleNative426();
        return;
      }
      this.mainStore.clearSession();
      this.state.set('offline-unverified');
    }
  }

  private async nativeLogout(): Promise<void> {
    if (!this.nativeToken) return this.finishLocalLogout();
    this.mainStore.clearSession();
    this.state.set('logout-pending');
    try {
      await this.pendingStorage.set(true);
    } catch {
      try {
        await firstValueFrom(this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT, null));
      } catch {
        // Sin persistencia del pending, se descarta localmente para fallar cerrado.
      }
      await this.finishLocalLogoutBestEffort();
      return;
    }
    await this.retryPendingLogout();
  }

  private async retryPendingLogout(): Promise<void> {
    if (!this.nativeToken) return this.finishLocalLogout();
    this.mainStore.clearSession();
    this.state.set('logout-pending');
    try {
      await firstValueFrom(this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT, null));
      await this.finishLocalLogout();
    } catch {
      this.state.set('logout-pending');
    }
  }

  private async finishLocalLogout(): Promise<void> {
    await this.secureStorage.clear();
    this.nativeToken = null;
    this.expiresAt.set(null);
    this.mainStore.clearSession();
    await this.pendingStorage.set(false);
    this.state.set('unauthenticated');
  }

  private async finishLocalLogoutBestEffort(): Promise<void> {
    try {
      await this.secureStorage.clear();
    } catch {
      // No se habilita la sesión en memoria aunque el storage quede inaccesible.
    }
    try {
      await this.pendingStorage.set(false);
    } catch {
      // Un flag residual sin token se limpia en el próximo bootstrap.
    }
    this.nativeToken = null;
    this.expiresAt.set(null);
    this.mainStore.clearSession();
    this.state.set('unauthenticated');
  }

  private async compensateFailedLogin(token: string): Promise<void> {
    this.nativeToken = token;
    try {
      await firstValueFrom(this.httpClient.post<void>(environment.apiURL + NATIVE_LOGOUT, null));
    } catch {
      // Best-effort: el token no se guarda en un fallback y expira server-side.
    }
    try {
      await this.secureStorage.clear();
    } catch {
      // La operación original ya informó que el storage no es confiable.
    }
    this.nativeToken = null;
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
        this.state.set('client-error');
      });
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
