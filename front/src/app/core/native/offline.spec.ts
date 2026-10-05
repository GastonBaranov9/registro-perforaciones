import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OfflineRepository, BorradorLocal, OfflineFiles } from './offline-repository';
import { OFFLINE_FILES, OfflineService } from './offline.service';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { RuntimePlatformService } from './runtime-platform.service';
import { NativeBackendConfigService } from './native-backend-config.service';
import { NativeSecureSessionStorage, NativeInstallationStorage, NativeLogoutPendingStorage } from './native-storage.service';
import { environment } from '../../../environments/environment';

class Files {
  data = new Map<string, string>(); dirs = new Set<string>(); failRename = false;
  plugin = {
    mkdir: async ({ path }: any) => { this.dirs.add(path); },
    writeFile: async ({ path, data }: any) => {
      this.data.set(path, data);
      let dir = path.slice(0, path.lastIndexOf('/'));
      while (dir) { this.dirs.add(dir); dir = dir.slice(0, dir.lastIndexOf('/')); }
      return { uri: path };
    },
    readFile: async ({ path }: any) => {
      if (!this.data.has(path)) throw new Error('Missing file');
      return { data: this.data.get(path)! };
    },
    rename: async ({ from, to }: any) => {
      if (this.failRename) throw new Error('Interrupted write');
      this.data.set(to, this.data.get(from)!); this.data.delete(from);
    },
    deleteFile: async ({ path }: any) => { this.data.delete(path); },
    readdir: async ({ path }: any) => ({ files: [...new Set([...this.dirs, ...this.data.keys()])]
      .filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(path.length + 1), type: this.dirs.has(p) ? 'directory' : 'file', size: 1, mtime: 0 })) }),
  } as unknown as OfflineFiles;
}

function draft(): BorradorLocal {
  return { id: crypto.randomUUID(), usuario: 7, estado: 'pendiente',
    pozo: { id_propietario: null, propietario_provisional: 'Persona provisional', id_perforador: 7, id_sitio: 0 },
    sitio: { departamento: 'Salto', localidad: 'Campo', latitud: '-31', longitud: '-57' },
    tecnicos: { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] } };
}

describe('Repositorio offline persistente', () => {
  it('crea sin red, reinicia, recupera datos y fotografía binaria separada', async () => {
    const files = new Files(); const d = draft(); const repo = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    d.foto = await repo.photo(d.id, new File(['photo bytes'], 'campo.png', { type: 'image/png' }));
    await repo.write(d);
    const restarted = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    expect(await restarted.list()).toEqual([d]);
    expect(atob((await restarted.photoBase64(d))!)).toBe('photo bytes');
    expect([...files.data].find(([name]) => name.endsWith('.json'))![1]).not.toContain(btoa('photo bytes'));
  });
  it('cierre durante reemplazo conserva la última versión confirmada', async () => {
    const files = new Files(), d = draft(), repo = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    await repo.write(d); const changed = structuredClone(d); changed.pozo.propietario_provisional = 'Edición';
    files.failRename = true; await expectAsync(repo.write(changed)).toBeRejected();
    expect((await new OfflineRepository(files.plugin, 'offline-v1/server/7', 7).read(d.id)).pozo.propietario_provisional).toBe('Persona provisional');
  });
  it('rechaza número comercial, usuario diferente, rutas forjadas y fotos vacías', async () => {
    const files = new Files(), d = draft(), repo = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    await expectAsync(repo.write({ ...d, pozo: { ...d.pozo, numero_perforacion: 3001 } })).toBeRejected();
    await expectAsync(repo.write({ ...d, usuario: 8 })).toBeRejected();
    await expectAsync(repo.photoBase64({ ...d, foto: { ruta: '../otro/foto', tipo: 'image/png' } })).toBeRejected();
    await expectAsync(repo.photo(d.id, new File([], 'empty.png', { type: 'image/png' }))).toBeRejected();
  });
});

describe('Cola offline del perforador', () => {
  let files: Files, service: OfflineService, http: HttpTestingController;
  let state: ReturnType<typeof signal<any>>, account: number;
  let getUser: jasmine.Spy, session: any;
  const endpoint = `${environment.apiURL}usuarios/7/pozos/completo`;
  async function request(url = endpoint) {
    for (let n = 0; n < 100; n++) {
      const requests = http.match(url);
      if (requests.length) { expect(requests.length).toBe(1); return requests[0]; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('No llegó solicitud de sincronización: ' + service.mensaje());
  }
  beforeEach(() => {
    files = new Files(); state = signal('authenticated'); account = 7;
    session = { token: 'test-token', installationId: 'installation', offlineUser: { id_usuario: 7, nombre: 'Perforador', roles: [{ id_rol: 2, nombre: 'perforador', descr: '' }] } };
    getUser = jasmine.createSpy().and.resolveTo();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: OFFLINE_FILES, useValue: files.plugin },
      { provide: RuntimePlatformService, useValue: { isNative: () => true } },
      { provide: NativeBackendConfigService, useValue: { origin: () => new URL('https://backend.test') } },
      { provide: AuthService, useValue: { state, userId: () => account, getUser, tieneRol: () => true } },
      { provide: NativeSecureSessionStorage, useValue: { load: async () => session } },
      { provide: NativeInstallationStorage, useValue: { loadExisting: async () => 'installation' } },
      { provide: NativeLogoutPendingStorage, useValue: { load: async () => null } },
    ] });
    service = TestBed.inject(OfflineService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('guarda y edita sin red; conserva propiedad, ubicación y foto al volver a cargar', async () => {
    state.set('offline-unverified'); const d = draft();
    await service.guardar(d, new File(['abc'], 'foto.png', { type: 'image/png' }));
    d.pozo.propietario_provisional = 'Nombre corregido';
    // The editor loads the current durable draft, including the photo reference.
    const edit = { ...service.borradores()[0], pozo: d.pozo };
    await service.guardar(edit); await service.cargar();
    expect(service.borradores()[0].pozo.propietario_provisional).toBe('Nombre corregido');
    expect(await (await service.foto(service.borradores()[0]))!.text()).toBe('abc');
    expect(getUser).not.toHaveBeenCalled(); http.expectNone(endpoint);
  });
  it('reconecta, valida sesión, evita doble upload y conserva foto tras éxito', async () => {
    const d = draft(); await service.guardar(d, new File(['abc'], 'foto.png', { type: 'image/png' }));
    const one = service.sincronizar(), two = service.sincronizar();
    expect(one).toBe(two);
    const req = await request();
    expect(getUser).toHaveBeenCalled(); expect(req.request.headers.get('Idempotency-Key')).toBe(d.id);
    expect(req.request.body.pozo.numero_perforacion).toBeUndefined();
    expect(req.request.body.foto.base64).toBe(btoa('abc'));
    req.flush({ pozo: { id_pozo: 40, numero_perforacion: 8500 } }); await one;
    expect(service.borradores()[0].estado).toBe('sincronizado');
    expect(await (await service.foto(service.borradores()[0]))!.text()).toBe('abc');
    await service.sincronizar(); http.expectNone(endpoint);
  });
  it('500/respuesta perdida permite reintentar exactamente la misma clave y payload', async () => {
    const d = draft(); await service.guardar(d);
    const first = service.sincronizar(), req = await request();
    const payload = req.request.body;
    req.flush({ message: 'Error de prueba' }, { status: 500, statusText: 'Server Error' }); await first;
    expect(service.borradores()[0].estado).toBe('error');
    await expectAsync(service.guardar(d)).toBeRejected();
    const retry = service.sincronizar(), again = await request();
    expect(again.request.body).toEqual(payload); expect(again.request.headers.get('Idempotency-Key')).toBe(d.id);
    again.flush({ pozo: { id_pozo: 40, numero_perforacion: 8500 } }); await retry;
    expect(service.borradores()[0].estado).toBe('sincronizado');
  });
  it('sesión revocada o vencida no sube, conserva borrador y requiere login', async () => {
    await service.guardar(draft());
    getUser.and.callFake(async () => { state.set('unauthenticated'); throw new Error('Vuelva a iniciar sesión'); });
    await service.sincronizar(); http.expectNone(endpoint);
    expect([...files.data.values()].some(text => text.includes('Persona provisional'))).toBeTrue();
    expect(service.mensaje()).toContain('iniciar sesión');
  });
  it('rechazo del servidor queda como conflicto recuperable', async () => {
    const d = draft(); await service.guardar(d); const run = service.sincronizar(), req = await request();
    req.flush({ message: 'Cuenta sin permiso para sincronizar' }, { status: 403, statusText: 'Forbidden' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).flush({}, { status: 403, statusText: 'Forbidden' });
    await run;
    expect(service.borradores()[0].estado).toBe('conflicto'); expect(service.borradores()[0].error).toContain('sin permiso');
    expect(service.borradores()[0].enviado).toBeTrue();
    await expectAsync(service.guardar(d)).toBeRejected();
  });
  it('rechazo con cierre autoritativo permite corregir conservando identidad local y foto', async () => {
    const d = draft(); await service.guardar(d, new File(['abc'], 'foto.png', { type: 'image/png' }));
    const run = service.sincronizar();
    (await request()).flush({ message: 'Corregir datos' }, { status: 400, statusText: 'Bad Request' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).flush({ estado: 'cerrado_sin_creacion', clave: d.id });
    await run;
    const editable = structuredClone(service.borradores()[0]);
    expect(editable.id).toBe(d.id); expect(editable.enviado).toBeFalse();
    expect(editable.claveOperacion).not.toBe(d.id); expect(editable.requiereCorreccion).toBeTrue();
    await service.sincronizar(); http.expectNone(endpoint);
    editable.pozo.propietario_provisional = 'Corregido'; await service.guardar(editable);
    const retry = service.sincronizar(), req = await request();
    expect(req.request.headers.get('Idempotency-Key')).toBe(editable.claveOperacion!);
    expect(req.request.body.pozo.propietario_provisional).toBe('Corregido');
    expect(req.request.body.foto.base64).toBe(btoa('abc'));
    req.flush({ pozo: { id_pozo: 40, numero_perforacion: 8500 } }); await retry;
    expect(service.borradores()[0].estado).toBe('sincronizado');
  });
  it('cierre que encuentra recibo previo recupera resultado sin generar otra clave', async () => {
    const d = draft(); await service.guardar(d);
    const run = service.sincronizar();
    (await request()).flush({}, { status: 409, statusText: 'Conflict' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).flush({
      estado: 'confirmado', clave: d.id, resultado: { pozo: { id_pozo: 40, numero_perforacion: 8500 } },
    }); await run;
    expect(service.borradores()[0].estado).toBe('sincronizado');
    expect(service.borradores()[0].claveOperacion).toBeUndefined();
    expect(service.borradores()[0].enviado).toBeTrue();
  });
  it('respuesta de cierre perdida conserva payload; repetir cierre permite recuperar edicion', async () => {
    const d = draft(); await service.guardar(d);
    const run = service.sincronizar(), first = await request(); const payload = first.request.body;
    first.flush({}, { status: 400, statusText: 'Bad Request' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).error(new ProgressEvent('error'));
    await run;
    expect(service.borradores()[0].enviado).toBeTrue(); expect(service.borradores()[0].claveOperacion).toBeUndefined();
    await expectAsync(service.guardar(d)).toBeRejected();
    const retry = service.sincronizar(), req = await request();
    expect(req.request.body).toEqual(payload); expect(req.request.headers.get('Idempotency-Key')).toBe(d.id);
    req.flush({}, { status: 409, statusText: 'Conflict' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).flush({ estado: 'cerrado_sin_creacion', clave: d.id });
    await retry; expect(service.borradores()[0].enviado).toBeFalse();
  });
  for (const status of [0, 401, 500]) it(`resultado incierto o sin sesion (${status}) nunca cambia clave`, async () => {
    const d = draft(); await service.guardar(d);
    const run = service.sincronizar(), req = await request();
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush({}, { status, statusText: 'Rejected' });
    await run;
    http.expectNone(`${environment.apiURL}pozos/offline/${d.id}/cerrar`);
    expect(service.borradores()[0].enviado).toBeTrue(); expect(service.borradores()[0].claveOperacion).toBeUndefined();
    await expectAsync(service.guardar(d)).toBeRejected();
  });
  it('prueba de cierre para otra clave no desbloquea el borrador', async () => {
    const d = draft(); await service.guardar(d); const run = service.sincronizar();
    (await request()).flush({}, { status: 400, statusText: 'Bad Request' });
    (await request(`${environment.apiURL}pozos/offline/${d.id}/cerrar`)).flush({ estado: 'cerrado_sin_creacion', clave: crypto.randomUUID() });
    await run; expect(service.borradores()[0].enviado).toBeTrue();
    expect(service.borradores()[0].claveOperacion).toBeUndefined();
  });
  it('otra cuenta no abre ni sincroniza borradores anteriores', async () => {
    const d = draft(); await service.guardar(d); account = 8;
    session = { ...session, offlineUser: { ...session.offlineUser, id_usuario: 8 } };
    await service.cargar(); expect(service.borradores()).toEqual([]);
    await expectAsync(service.guardar(d)).toBeRejected();
    await service.sincronizar(); http.expectNone(endpoint);
  });
  it('un borrador marcado sincronizando tras cierre puede continuar con la misma clave', async () => {
    const d = draft(); await service.guardar(d);
    // Persist the exact state left by a process terminated during HTTP upload.
    const path = [...files.data.keys()].find(p => p.endsWith('.json'))!;
    const stored = JSON.parse(files.data.get(path)!); stored.estado = 'sincronizando'; stored.enviado = true;
    files.data.set(path, JSON.stringify(stored));
    await service.cargar();
    const run = service.sincronizar(), req = await request();
    expect(req.request.headers.get('Idempotency-Key')).toBe(d.id);
    req.flush({ pozo: { id_pozo: 42, numero_perforacion: 8501 } }); await run;
    expect(service.borradores()[0].estado).toBe('sincronizado');
  });
  it('sin identidad autenticada previamente no permite abrir espacio', async () => {
    session.offlineUser = undefined;
    await expectAsync(service.owner()).toBeRejected();
    http.expectNone(endpoint);
  });
  it('cambio de cuenta durante escritura de la cola impide enviar bajo otra sesión', async () => {
    await service.guardar(draft());
    const write = files.plugin.writeFile;
    spyOn(files.plugin, 'writeFile').and.callFake(async options => {
      const result = await write(options);
      if (String(options.data).includes('"sincronizando"')) {
        account = 8; session = { ...session, offlineUser: { ...session.offlineUser, id_usuario: 8 } };
      }
      return result;
    });
    await service.sincronizar(); http.expectNone(endpoint);
    expect([...files.data.values()].some(value => value.includes('cuenta original'))).toBeTrue();
  });
});
