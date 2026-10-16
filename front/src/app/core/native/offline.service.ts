import { effect, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Filesystem } from '@capacitor/filesystem';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { NativeSecureSessionStorage, NativeLogoutPendingStorage, NativeInstallationStorage } from './native-storage.service';
import { NativeBackendConfigService } from './native-backend-config.service';
import { RuntimePlatformService } from './runtime-platform.service';
import { OfflineRepository, BorradorLocal, OfflineFiles, eliminacionLocal } from './offline-repository';
import { PozoCompletoBody, PozoCompletoResultado } from '../../shared/types/schemas';
import { environment } from '../../../environments/environment';
import { validarDatosTecnicos } from '../../shared/utils/datos-tecnicos-borrador';

export const OFFLINE_FILES = new InjectionToken<OfflineFiles>('OFFLINE_FILES', { providedIn: 'root', factory: () => Filesystem });

@Injectable({ providedIn: 'root' })
export class OfflineService {
  readonly runtime = inject(RuntimePlatformService);
  readonly auth = inject(AuthService);
  private secure = inject(NativeSecureSessionStorage);
  private pending = inject(NativeLogoutPendingStorage);
  private installation = inject(NativeInstallationStorage);
  private backend = inject(NativeBackendConfigService);
  private fs = inject(OFFLINE_FILES);
  private http = inject(HttpClient);
  readonly borradores = signal<BorradorLocal[]>([]);
  readonly ocupado = signal(false);
  readonly editando = signal(false);
  readonly mensaje = signal('');
  readonly sinRed = signal(!navigator.onLine);
  private flight?: Promise<void>;
  private mutations: Promise<unknown> = Promise.resolve();
  constructor() {
    effect(() => {
      const state = this.auth.state();
      const user = this.auth.userId();
      if (!['authenticated', 'offline-unverified', 'initializing'].includes(state)
          || (state === 'authenticated' && this.borradores().some(d => d.usuario !== user))) {
        this.borradores.set([]); this.mensaje.set(''); this.editando.set(false);
      }
    });
    window.addEventListener('offline', () => this.sinRed.set(true));
    window.addEventListener('online', () => {
      this.sinRed.set(false);
      if (this.runtime.isNative()) void this.sincronizar();
    });
  }
  async owner() {
    if (!this.runtime.isNative() || !['authenticated', 'offline-unverified'].includes(this.auth.state())) throw new Error('Debe iniciar sesión para abrir sus borradores.');
    const session = await this.secure.load();
    if (!session || await this.pending.load() || session.installationId !== await this.installation.loadExisting()) throw new Error('Debe iniciar sesión para abrir sus borradores.');
    const user = session.offlineUser;
    if (!user || !Number.isSafeInteger(user.id_usuario) || !user.roles.some(r => ['perforador','operador_administrativo'].includes(r.nombre))) throw new Error('Inicie sesión como perforador con conexión para habilitar el trabajo local.');
    if (this.auth.state() === 'authenticated' && this.auth.userId() !== user.id_usuario) throw new Error('La cuenta cambió. Vuelva a abrir sus borradores.');
    return user;
  }
  private async repository() {
    const user = await this.owner();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.backend.origin().origin));
    const origin = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    return new OfflineRepository(this.fs, `offline-v1/${origin}/${user.id_usuario}`, user.id_usuario);
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation);
    this.mutations = result.catch(() => undefined);
    return result;
  }
  async epocaParaNuevo(): Promise<string> {
    const owner = await this.owner();
    const repo = await this.repository();
    if (navigator.onLine && this.auth.state() === 'authenticated') {
      const response = await firstValueFrom(this.http.get<{ epoca: string }>(`${environment.apiURL}pozos/epoca-datos`).pipe(timeout(15000)));
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.epoca)) throw new Error('Etapa del servidor inválida.');
      if ((await this.owner()).id_usuario !== owner.id_usuario) throw new Error('La cuenta cambió.');
      await repo.guardarEpoca(response.epoca);
      return response.epoca;
    }
    const epoca = await repo.epoca();
    if (!epoca) throw new Error('Conéctese una vez para habilitar nuevos borradores en esta etapa. Los antiguos se conservan.');
    return epoca;
  }
  async cargar() {
    const repo = await this.repository();
    const drafts = await repo.list();
    const owner = await this.owner();
    if (drafts.some(d => d.usuario !== owner.id_usuario)) throw new Error('La cuenta cambió. Abra nuevamente sus borradores.');
    this.borradores.set(drafts);
  }
  async guardar(draft: BorradorLocal, foto?: File | null): Promise<void> {
    return this.serialize(async () => {
      const repo = await this.repository();
      if (draft.usuario !== (await this.owner()).id_usuario) throw new Error('La cuenta cambió; el borrador no se guardó.');
      const actual = (await repo.list()).find(d => d.id === draft.id);
      this.mensaje.set('');
      if (actual && eliminacionLocal(actual) !== 'borrador') throw new Error('Este borrador ya fue enviado. Reintente para confirmar su recepción antes de editar el pozo en línea.');
      const copy = structuredClone(draft);
      if (!actual && !copy.epoca) throw new Error('El borrador nuevo necesita una etapa obtenida del servidor.');
      if (actual?.epocaRetirada) throw new Error('Este borrador pertenece a una etapa retirada.');
      if (actual && actual.epoca !== copy.epoca) throw new Error('No se puede cambiar la etapa de un borrador.');
      delete copy.pozo.numero_perforacion;
      copy.estado = 'pendiente';
      copy.error = undefined;
      copy.claveOperacion = actual?.claveOperacion ?? copy.claveOperacion;
      copy.requiereCorreccion = false;
      copy.foto = actual?.foto ?? copy.foto;
      copy.fotoPendiente = actual?.fotoPendiente ?? false;
      try {
        if (foto) { copy.foto = await repo.photo(copy.id, foto); copy.fotoPendiente = false; }
        else if (copy.fotoPendiente) throw new Error('Fotografía pendiente');
        else if (copy.foto) await repo.photoUri(copy);
      } catch {
        copy.foto = actual?.foto;
        copy.fotoPendiente = true;
        copy.error = foto
          ? 'La fotografía nueva no quedó guardada. Los datos se conservaron y la foto anterior, si existía, no se reemplazó. Reintente guardar; si cerró la app, vuelva a seleccionar o tomar la foto.'
          : 'No se pudo confirmar la fotografía pendiente o guardada. Los datos y la referencia anterior se conservan. Vuelva a seleccionar o tomar la foto y reintente guardar.';
        try { await repo.write(copy); }
        catch { throw new Error('No se pudieron guardar los datos ni la fotografía. El formulario conserva los cambios en esta pantalla. Libere espacio y reintente antes de salir.'); }
        if ((await this.owner()).id_usuario === draft.usuario) this.borradores.set(await repo.list());
        throw new Error(copy.error);
      }
      try { await repo.write(copy); }
      catch { throw new Error('No se pudo confirmar el guardado del borrador. El formulario conserva los cambios; reintente antes de salir.'); }
      if ((await this.owner()).id_usuario !== draft.usuario) return;
      this.borradores.set(await repo.list());
      this.mensaje.set('Guardado en este dispositivo. Todavía no está guardado en el servidor.');
    });
  }
  async fotoUri(draft: BorradorLocal): Promise<string | null> {
    const repo = await this.repository();
    return repo.photoUri(await repo.read(draft.id));
  }
  async eliminar(id: string): Promise<void> {
    return this.serialize(async () => {
      if (this.editando()) throw new Error('Guarde el borrador abierto antes de eliminar.');
      const owner = await this.owner();
      const repo = await this.repository();
      this.mensaje.set('');
      try { await repo.remove(id); }
      finally {
        if ((await this.owner()).id_usuario === owner.id_usuario) this.borradores.set(await repo.list());
      }
      this.mensaje.set('Se eliminó la copia de este dispositivo. No se modificó ningún pozo del servidor.');
    });
  }
  async foto(draft: BorradorLocal): Promise<File | null> {
    const repo = await this.repository();
    const base64 = await repo.photoBase64(draft);
    if (!base64 || !draft.foto) return null;
    return new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'foto-local', { type: draft.foto.tipo });
  }
  sincronizar(): Promise<void> {
    this.flight ??= this.serialize(() => this.sync()).finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async sync() {
    if (this.editando()) { this.mensaje.set('Guarde el borrador abierto antes de sincronizar.'); return; }
    this.ocupado.set(true);
    try {
      const owner = await this.owner();
      await this.auth.getUser();
      if (this.auth.state() !== 'authenticated' || this.auth.userId() !== owner.id_usuario || !(this.auth.tieneRol('perforador') || this.auth.tieneRol('operador_administrativo'))) throw new Error('Vuelva a iniciar sesión como el mismo perforador para sincronizar. Sus borradores se conservan.');
      const repo = await this.repository();
      for (const draft of await repo.list()) {
        if (!draft.epoca) {
          draft.epocaRetirada = true; draft.estado = 'conflicto';
          draft.error = 'Borrador anterior sin etapa: no puede enviarse ni convertirse. Los datos y la fotografía se conservan; puede retirar la copia local.';
          await repo.write(draft); continue;
        }
        if (draft.epocaRetirada) continue;
        if (draft.estado === 'sincronizado' || draft.requiereCorreccion || draft.fotoPendiente) continue;
        if (this.auth.userId() !== owner.id_usuario || this.auth.state() !== 'authenticated') break;
        const clave = draft.claveOperacion ?? draft.id;
        try {
          const errors = validarDatosTecnicos(draft.tecnicos, draft.pozo.profundidad_final_m);
          if (errors.length) throw new Error(errors.join(' '));
          if (!draft.pozo.propietario_provisional?.trim() || !draft.sitio.departamento || !draft.sitio.latitud || !draft.sitio.longitud) throw new Error('Complete propietario provisional, departamento y coordenadas antes de sincronizar.');
          const { id_sitio: _sitio, numero_perforacion: _numero, foto_url: _url, ...pozo } = draft.pozo;
          const body: PozoCompletoBody = {
            pozo: { ...pozo, id_propietario: null, id_perforador: owner.id_usuario }, sitio_nuevo: draft.sitio,
            intervalos_litologicos: draft.tecnicos.intervalosLitologicos.map(i => i.dato),
            intervalos_diametro: draft.tecnicos.intervalosDiametro.map(i => i.dato),
            intervalos_filtro: draft.tecnicos.intervalosFiltro.map(i => i.dato),
            niveles_aporte: draft.tecnicos.nivelesAporte.map(i => i.dato),
          };
          const base64 = await repo.photoBase64(draft);
          if (base64 && draft.foto) body.foto = { base64, mime_type: draft.foto.tipo };
          draft.estado = 'sincronizando'; draft.enviado = true; draft.error = undefined;
          await repo.write(draft);
          if (this.auth.state() !== 'authenticated' || this.auth.userId() !== owner.id_usuario) throw new Error('La sesión cambió antes de enviar. Los datos se conservan para la cuenta original.');
          const visibles = await repo.list();
          if (this.auth.state() !== 'authenticated' || this.auth.userId() !== owner.id_usuario) throw new Error('La sesión cambió antes de enviar. Los datos se conservan para la cuenta original.');
          this.borradores.set(visibles);
          const result = await firstValueFrom(this.http.post<PozoCompletoResultado>(`${environment.apiURL}usuarios/${owner.id_usuario}/pozos/completo`, body, { headers: { 'Idempotency-Key': clave, 'X-Epoca-Datos': draft.epoca } }).pipe(timeout(90000)));
          if (!result?.pozo?.id_pozo || !result.pozo.numero_perforacion) throw new Error('El servidor no confirmó la creación completa. Reintente con el mismo borrador.');
          draft.resultado = result; draft.estado = 'sincronizado';
          await repo.write(draft);
        } catch (error) {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          draft.estado = [400, 403, 409, 410].includes(status) ? 'conflicto' : 'error';
          if (status === 410 && error instanceof HttpErrorResponse && error.error?.code === 'EPOCA_DATOS_RETIRADA') draft.epocaRetirada = true;
          draft.error = status === 401 ? 'Sesión vencida o revocada. Inicie sesión con esta misma cuenta; los datos locales se conservan.'
            : error instanceof HttpErrorResponse ? error.error?.message || 'No se pudo confirmar la recepción. Reintente cuando tenga conexión.'
            : error instanceof Error ? error.message : 'No se pudo sincronizar. Los datos se conservan.';
          // A bare 4xx does NOT prove that an earlier retry never committed.
          // Close under the server creation lock; lost/denied closure remains frozen.
          if ([400, 403, 409].includes(status) && this.auth.state() === 'authenticated' && this.auth.userId() === owner.id_usuario) {
            try {
              const cierre = await firstValueFrom(this.http.post<{ estado: string; clave: string; resultado?: PozoCompletoResultado }>(
                `${environment.apiURL}pozos/offline/${clave}/cerrar`, {}, { headers: { 'X-Epoca-Datos': draft.epoca } },
              ).pipe(timeout(30000)));
              if (cierre.clave !== clave) throw new Error('Recibo de cierre inválido.');
              if (cierre.estado === 'confirmado' && cierre.resultado?.pozo?.id_pozo && cierre.resultado.pozo.numero_perforacion) {
                draft.resultado = cierre.resultado; draft.estado = 'sincronizado'; draft.error = undefined;
              } else if (cierre.estado === 'cerrado_sin_creacion') {
                draft.enviado = false;
                draft.requiereCorreccion = true;
                draft.claveOperacion = crypto.randomUUID();
                draft.error += ' El servidor confirmó que no hubo creación y cerró la operación anterior. Puede editar y guardar la corrección.';
              }
            } catch (closeError) {
              if (closeError instanceof HttpErrorResponse && closeError.status === 410 && closeError.error?.code === 'EPOCA_DATOS_RETIRADA') {
                draft.epocaRetirada = true; draft.error = closeError.error.message;
              }
              // Any ambiguity retains the original operation and frozen payload.
            }
          }
          await repo.write(draft);
          if (status === 401 || status === 0) break;
        }
      }
      if (this.auth.state() === 'authenticated' && this.auth.userId() === owner.id_usuario) this.borradores.set(await repo.list());
      this.mensaje.set('Sincronización terminada. Revise el estado de cada registro.');
    } catch (error) {
      this.mensaje.set(error instanceof Error ? error.message : 'Debe iniciar sesión para sincronizar. Los borradores se conservan.');
    } finally { this.ocupado.set(false); }
  }
}
