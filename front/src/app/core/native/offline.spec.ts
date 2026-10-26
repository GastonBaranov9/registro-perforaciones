import { FotoComponent, FotoSeleccionada } from '../../routes/fotos/components/foto/foto.component';
import { CAPACITOR_CAMERA, CAPACITOR_RUNTIME } from './native-plugin.tokens';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding } from '@capacitor/filesystem';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OfflineRepository, BorradorLocal, OfflineFiles, eliminacionLocal } from './offline-repository';
import { OFFLINE_FILES, OfflineService } from './offline.service';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { RuntimePlatformService } from './runtime-platform.service';
import { NativeBackendConfigService } from './native-backend-config.service';
import { NativeSecureSessionStorage, NativeInstallationStorage, NativeLogoutPendingStorage } from './native-storage.service';
import { environment } from '../../../environments/environment';

// A simulated disk stores UTF8 metadata separately from binary bytes. A new
// adapter can reload it without retaining the Camera URI or JavaScript File.
class Files {
  data = new Map<string, string>(); binary = new Map<string, Uint8Array>();
  dirs = new Set<string>(); failRename = false; failPhoto = false; failRemove = false;
  diskSnapshot() { return JSON.stringify({ data: [...this.data], binary: [...this.binary].map(([p,b]) => [p, [...b]]), dirs: [...this.dirs] }); }
  static restart(snapshot: string) {
    const stored = JSON.parse(snapshot), disk = new Files();
    disk.data = new Map(stored.data); disk.binary = new Map(stored.binary.map(([p,b]: [string, number[]]) => [p, Uint8Array.from(b)])); disk.dirs = new Set(stored.dirs);
    return disk;
  }
  plugin = {
    mkdir: async ({ path }: any) => { this.dirs.add(path); },
    writeFile: async ({ path, data, encoding, directory }: any) => {
      expect(directory).toBe(Directory.Data);
      if (encoding === Encoding.UTF8) this.data.set(path, data);
      else {
        if (this.failPhoto) throw new Error('Disk full');
        this.binary.set(path, Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      }
      let dir = path.slice(0, path.lastIndexOf('/'));
      while (dir) { this.dirs.add(dir); dir = dir.slice(0, dir.lastIndexOf('/')); }
      return { uri: path };
    },
    readFile: async ({ path, encoding, directory }: any) => {
      expect(directory).toBe(Directory.Data);
      if (encoding === Encoding.UTF8 && this.data.has(path)) return { data: this.data.get(path)! };
      const bytes = this.binary.get(path);
      if (!encoding && bytes) return { data: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) };
      throw new Error('Missing file');
    },
    stat: async ({ path, directory }: any) => {
      expect(directory).toBe(Directory.Data);
      if (!this.binary.has(path)) throw new Error('Missing file');
      return { type: 'file', size: this.binary.get(path)!.length, uri: 'file:///data/user/0/app/files/' + path };
    },
    getUri: async ({ path, directory }: any) => {
      expect(directory).toBe(Directory.Data);
      return { uri: 'file:///data/user/0/app/files/' + path };
    },
    rename: async ({ from, to }: any) => {
      if (this.failRename) throw new Error('Interrupted write');
      for (const map of [this.data, this.binary] as Map<string, any>[]) {
        for (const [key, value] of [...map]) if (key === from || key.startsWith(from + '/')) { map.set(to + key.slice(from.length), value); map.delete(key); }
      }
      for (const key of [...this.dirs]) if (key === from || key.startsWith(from + '/')) { this.dirs.add(to + key.slice(from.length)); this.dirs.delete(key); }
    },
    rmdir: async ({ path, directory }: any) => {
      expect(directory).toBe(Directory.Data);
      if (this.failRemove) throw new Error('Interrupted removal');
      for (const map of [this.data, this.binary]) for (const key of [...map.keys()]) if (key.startsWith(path + '/')) map.delete(key);
      for (const key of [...this.dirs]) if (key === path || key.startsWith(path + '/')) this.dirs.delete(key);
    },
    deleteFile: async ({ path }: any) => { this.data.delete(path); this.binary.delete(path); },
    readdir: async ({ path }: any) => ({ files: [...new Set([...this.dirs, ...this.data.keys(), ...this.binary.keys()])]
      .filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(path.length + 1), type: this.dirs.has(p) ? 'directory' : 'file', size: 1, mtime: 0 })) }),
  } as unknown as OfflineFiles;
}

function draft(): BorradorLocal {
  return { id: crypto.randomUUID(), usuario: 7, epoca: '11111111-1111-4111-8111-111111111111', estado: 'pendiente',
    pozo: { id_propietario: null, propietario_provisional: 'Persona provisional', id_perforador: 7, id_sitio: 0 },
    sitio: { departamento: 'Salto', localidad: 'Campo', latitud: '-31', longitud: '-57' },
    tecnicos: { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] } };
}

describe('Repositorio offline persistente', () => {
  for (const prefiltro of [undefined, null, [], [{desde_m:13.5,hasta_m:15.5},{desde_m:20,hasta_m:25}]]) {
    it('conserva prefiltro y ausencia al reabrir: '+JSON.stringify(prefiltro), async()=>{
      const disk=new Files(),original=draft();if(prefiltro!==undefined)original.tecnicos.prefiltro_constructivo=prefiltro;
      const repo=new OfflineRepository(disk.plugin,'offline-v1/server/7',7);await repo.write(original);
      const reiniciado=new OfflineRepository(Files.restart(disk.diskSnapshot()).plugin,'offline-v1/server/7',7);
      const leido=await reiniciado.read(original.id);expect(leido.tecnicos.prefiltro_constructivo).toEqual(prefiltro);
      if(prefiltro===undefined)expect(Object.hasOwn(leido.tecnicos,'prefiltro_constructivo')).toBeFalse();
      expect(leido.epoca).toBe(original.epoca);expect(leido.id).toBe(original.id);
    });
  }
  it('reabre y edita sin cañería sin añadir defaults a intervalos antiguos', async () => {
    const disk=new Files(),d=draft();
    d.tecnicos.intervalosDiametro=[
      {idLocal:'viejo',dato:{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:'PVC'}},
      {idLocal:'abierto',dato:{desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true}},
    ];
    const repo=new OfflineRepository(disk.plugin,'offline-v1/server/7',7);await repo.write(d);
    const next=new OfflineRepository(Files.restart(disk.diskSnapshot()).plugin,'offline-v1/server/7',7);
    const abierto=await next.read(d.id);
    expect(abierto.tecnicos).toEqual(d.tecnicos);
    abierto.tecnicos.intervalosDiametro[1].dato.hasta_m=55;await next.write(abierto);
    const final=await next.read(d.id);
    expect(final.tecnicos.intervalosDiametro[1].dato).toEqual({...d.tecnicos.intervalosDiametro[1].dato,hasta_m:55});
    expect(Object.hasOwn(final.tecnicos.intervalosDiametro[0].dato,'sin_tuberia')).toBeFalse();
  });
  for (const sello of [undefined, null, { desde_m: 1.125, hasta_m: 9.875 }]) {
    it('conserva el sello al cerrar/reabrir sin inferir ausencia: ' + JSON.stringify(sello), async () => {
      const disk = new Files(); const original = draft();
      if (sello !== undefined) original.tecnicos.sello_sanitario_constructivo = sello;
      const repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
      await repo.write(original);
      const reiniciado = new OfflineRepository(Files.restart(disk.diskSnapshot()).plugin, 'offline-v1/server/7', 7);
      expect((await reiniciado.read(original.id)).tecnicos.sello_sanitario_constructivo).toEqual(sello);
    });
  }
  it('una APK nueva no añade ni cambia la época de revisiones antiguas y conserva la foto', async () => {
    const disk = new Files(); const repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    const legacy = draft(); delete legacy.epoca;
    legacy.foto = await repo.photo(legacy.id, new File(['legacy-photo'], 'foto.png', { type: 'image/png' }));
    await repo.write(legacy);
    await repo.guardarEpoca('22222222-2222-4222-8222-222222222222');
    const next = new OfflineRepository(Files.restart(disk.diskSnapshot()).plugin, 'offline-v1/server/7', 7);
    const saved = await next.read(legacy.id);
    expect(saved.epoca).toBeUndefined(); expect(await next.epoca()).toBe('22222222-2222-4222-8222-222222222222');
    await expectAsync(next.write({ ...saved, epoca: await next.epoca() })).toBeRejectedWithError(/inmutable/);
    expect(await next.photoBase64(saved)).toBe(btoa('legacy-photo'));
  });
  it('recarga JSON y binario en una nueva instancia tras desaparecer el temporal de Camera', async () => {
    let disk = new Files();
    const original = draft();
    let repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    const temporaryUri = 'https://localhost/_capacitor_file_/cache/camera.jpg';
    const temporaryFiles = new Map([[temporaryUri, Uint8Array.from([255,216,255,217])]]);
    const camera = { getPhoto: jasmine.createSpy().and.resolveTo({ path: 'file:///cache/camera.jpg', webPath: temporaryUri, format: 'jpeg', saved: false }) };
    spyOn(window, 'fetch').and.callFake(async input => {
      const bytes = temporaryFiles.get(String(input));
      return bytes ? new Response(new Blob([bytes], { type: 'image/jpeg' })) : new Response(null, { status: 404 });
    });
    TestBed.configureTestingModule({ imports: [FotoComponent], providers: [
      { provide: CAPACITOR_CAMERA, useValue: camera },
      { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'android', isNativePlatform: () => true } },
    ] });
    const capture = TestBed.createComponent(FotoComponent);
    let selected: FotoSeleccionada | undefined;
    capture.componentInstance.fotoTomada.subscribe(photo => selected = photo);
    await capture.componentInstance.tomarFoto();
    original.foto = await repo.photo(original.id, selected!.archivo);
    await repo.write(original);
    URL.revokeObjectURL(selected!.vistaPrevia); selected = undefined; capture.destroy();
    temporaryFiles.clear();
    expect((await fetch(temporaryUri)).status).toBe(404);
    disk = Files.restart(disk.diskSnapshot());
    repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    const loaded = (await repo.list())[0];
    const convert = spyOn(Capacitor, 'convertFileSrc').and.callFake(uri => uri.replace('file://', 'https://localhost/_capacitor_file_'));
    expect(loaded).not.toBe(original); expect(loaded.foto!.ruta).toMatch(/\.jpg$/);
    expect(await repo.photoBase64(loaded)).toBe('/9j/2Q==');
    expect(await repo.photoUri(loaded)).toContain('https://localhost/_capacitor_file_/data/user/0/app/files/offline-v1/server/7/');
    expect(convert).toHaveBeenCalled();
    expect([...disk.data.values()].join()).not.toMatch(/camera.jpg|blob:|base64|file:\/\//);
    disk.binary.clear();
    await expectAsync(repo.photoUri(loaded)).toBeRejected();
    expect((await repo.read(loaded.id)).foto).toEqual(loaded.foto);
  });
  it('reemplazo interrumpido conserva foto anterior; limpia sólo fotos de revisiones obsoletas', async () => {
    const disk = new Files(), d = draft(), repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    d.foto = await repo.photo(d.id, new File(['old'], 'a.png', { type: 'image/png' })); await repo.write(d);
    const oldPath = d.foto.ruta;
    const pending = await repo.photo(d.id, new File(['pending'], 'b.png', { type: 'image/png' }));
    const changed = { ...d, foto: pending };
    disk.failRename = true; await expectAsync(repo.write(changed)).toBeRejected();
    expect(await repo.photoBase64(await repo.read(d.id))).toBe(btoa('old'));
    expect(disk.binary.has(oldPath)).toBeTrue();
    disk.failRename = false; await repo.write(changed);
    expect(disk.binary.has(oldPath)).toBeTrue(); // previous revision still references it
    const orphan = await repo.photo(d.id, new File(['unsaved'], 'c.png', { type: 'image/png' }));
    await repo.write(changed);
    expect(disk.binary.has(oldPath)).toBeFalse();
    expect(disk.binary.has(pending.ruta)).toBeTrue(); expect(disk.binary.has(orphan.ruta)).toBeTrue();
  });
  it('elimina únicamente el directorio propio, incluidas revisiones, binarios y temporales', async () => {
    const disk = new Files(), a = draft(), b = draft(), repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    a.foto = await repo.photo(a.id, new File(['a'], 'a.png', { type: 'image/png' }));
    await repo.write(a); await repo.write(a); await repo.write(b);
    disk.data.set('offline-v1/server/7/' + a.id + '/pending.tmp', 'temporary');
    await repo.remove(a.id);
    expect(await repo.list()).toEqual([b]);
    expect([...disk.data.keys(), ...disk.binary.keys(), ...disk.dirs].some(p => p.includes(a.id))).toBeFalse();
  });
  it('interrupción de limpieza no resucita revisiones ni permite reenviar', async () => {
    const disk = new Files(), d = draft(), repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    await repo.write(d); d.enviado = true; d.estado = 'sincronizado'; d.resultado = { pozo: { id_pozo: 40, numero_perforacion: 8500 } } as any; await repo.write(d);
    disk.failRemove = true; await expectAsync(repo.remove(d.id)).toBeRejectedWithError(/retirado/);
    expect(await repo.list()).toEqual([]);
    const restarted = Files.restart(disk.diskSnapshot());
    expect(await new OfflineRepository(restarted.plugin, 'offline-v1/server/7', 7).list()).toEqual([]);
    expect(restarted.data.size).toBe(0);
  });
  for (const estado of ['pendiente', 'sincronizando', 'error', 'conflicto'] as const) it('rechaza borrar una clave enviada en estado ' + estado, async () => {
    const disk = new Files(), d = { ...draft(), estado, enviado: true }, repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    await repo.write(d); await expectAsync(repo.remove(d.id)).toBeRejectedWithError(/incierto/);
    expect(await repo.read(d.id)).toEqual(d); expect(eliminacionLocal(d)).toBeNull();
  });
  it('crea sin red, reinicia, recupera datos y fotografía binaria separada', async () => {
    const files = new Files(); const d = draft(); const repo = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    d.foto = await repo.photo(d.id, new File(['photo bytes'], 'campo.png', { type: 'image/png' }));
    await repo.write(d);
    const restarted = new OfflineRepository(files.plugin, 'offline-v1/server/7', 7);
    expect(await restarted.list()).toEqual([d]);
    expect(atob((await restarted.photoBase64(d))!)).toBe('photo bytes');
    expect([...files.data].find(([name]) => name.endsWith('.json'))![1]).not.toContain(btoa('photo bytes'));
  });
  it('conserva compatibilidad con fotos anteriores sin extensión', async () => {
    const disk = new Files(), d = draft(), repo = new OfflineRepository(disk.plugin, 'offline-v1/server/7', 7);
    const ruta = 'offline-v1/server/7/' + d.id + '/photo-' + crypto.randomUUID();
    disk.binary.set(ruta, Uint8Array.from([255,216,255,217])); d.foto = { ruta, tipo: 'image/jpeg' }; await repo.write(d);
    expect(await repo.photoUri(await repo.read(d.id))).toContain(ruta);
    expect(await repo.photoBase64(await repo.read(d.id))).toBe('/9j/2Q==');
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
  for(const prefiltro of [undefined,[{desde_m:13.5,hasta_m:15.5}]]) it('sincroniza prefiltro opcional con mismo payload y clave tras fallo: '+JSON.stringify(prefiltro),async()=>{
    const d=draft();d.pozo.profundidad_final_m=30;if(prefiltro!==undefined)d.tecnicos.prefiltro_constructivo=prefiltro;
    await service.guardar(d);await service.cargar();let run=service.sincronizar(),req=await request();
    const body=JSON.stringify(req.request.body),key=req.request.headers.get('Idempotency-Key');
    expect(req.request.body.prefiltro_constructivo).toEqual(prefiltro);
    if(prefiltro===undefined)expect(body).not.toContain('prefiltro_constructivo');
    req.flush('timeout',{status:500,statusText:'Timeout'});await run;
    await service.cargar();run=service.sincronizar();req=await request();
    expect(JSON.stringify(req.request.body)).toBe(body);expect(req.request.headers.get('Idempotency-Key')).toBe(key);
    expect(req.request.headers.get('X-Epoca-Datos')).toBe(d.epoca!);
    req.flush({pozo:{id_pozo:99,numero_perforacion:900001},prefiltro_constructivo:prefiltro??[]});await run;
    expect(service.borradores()[0].estado).toBe('sincronizado');await service.sincronizar();http.expectNone(endpoint);
  });
  it('sincroniza sin cañería y reintenta el mismo cuerpo sin defaults en intervalos antiguos', async () => {
    const d=draft();d.pozo.profundidad_final_m=50;
    d.tecnicos.intervalosDiametro=[
      {idLocal:'viejo',dato:{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:'PVC'}},
      {idLocal:'abierto',dato:{desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true}},
    ];
    await service.guardar(d);await service.cargar();
    let run=service.sincronizar();let req=await request();
    const body=JSON.stringify(req.request.body),key=req.request.headers.get('Idempotency-Key');
    expect(req.request.body.intervalos_diametro[1]).toEqual(d.tecnicos.intervalosDiametro[1].dato);
    expect(Object.hasOwn(req.request.body.intervalos_diametro[0],'sin_tuberia')).toBeFalse();
    req.flush('timeout',{status:500,statusText:'Timeout'});await run;
    await service.cargar();run=service.sincronizar();req=await request();
    expect(JSON.stringify(req.request.body)).toBe(body);expect(req.request.headers.get('Idempotency-Key')).toBe(key);
    req.flush({pozo:{id_pozo:99,numero_perforacion:900001},intervalos_diametro:req.request.body.intervalos_diametro});await run;
    expect(service.borradores()[0].estado).toBe('sincronizado');
    expect(service.borradores()[0].tecnicos.intervalosDiametro[1].dato.sin_tuberia).toBeTrue();
  });
  for (const sello of [undefined, null, { desde_m: 1.125, hasta_m: 9.875 }]) {
    it('sincroniza el sello guardado separado de los intervalos: ' + JSON.stringify(sello), async () => {
      const original = draft(); original.pozo.profundidad_final_m = 20;
      original.tecnicos.sello_sanitario_constructivo = sello;
      original.tecnicos.intervalosLitologicos = [{ idLocal: 'real', dato: { desde_m: 0, hasta_m: 20, material: 'Basalto', id_litologia: 1 } }];
      await service.guardar(original); await service.cargar();
      const guardar = service.sincronizar(); const req = await request();
      expect(req.request.body.sello_sanitario_constructivo).toEqual(sello ?? null);
      expect(req.request.body.intervalos_litologicos).toEqual([{ desde_m: 0, hasta_m: 20, material: 'Basalto', id_litologia: 1 }]);
      req.flush({ pozo: { id_pozo: 40, numero_perforacion: 8500 }, sello_sanitario_constructivo: sello ?? null }); await guardar;
      expect(service.borradores()[0].estado).toBe('sincronizado');
    });
  }
  it('no transforma un sello litológico viejo: conserva el borrador ante rechazo normal del backend', async () => {
    const original = draft();
    original.tecnicos.intervalosLitologicos = [{ idLocal: 'viejo', dato: { desde_m: 0, hasta_m: 10, material: 'Sello sanitario', id_litologia: 987 } }];
    await service.guardar(original);
    const guardar = service.sincronizar(); const req = await request();
    expect(req.request.body.sello_sanitario_constructivo).toBeNull();
    expect(req.request.body.intervalos_litologicos[0].id_litologia).toBe(987);
    req.flush({ message: 'Sello sanitario es un elemento constructivo' }, { status: 400, statusText: 'Bad Request' });
    const cerrar = await request(`${environment.apiURL}pozos/offline/${original.id}/cerrar`);
    cerrar.flush({ estado: 'cerrado_sin_creacion', clave: original.id }); await guardar;
    const guardado = service.borradores()[0];
    expect(guardado.id).toBe(original.id); expect(guardado.estado).toBe('conflicto');
    expect(guardado.tecnicos.intervalosLitologicos).toEqual(original.tecnicos.intervalosLitologicos);
    expect(guardado.tecnicos.sello_sanitario_constructivo).toBeUndefined();
    expect(guardado.error).toContain('elemento constructivo');
  });
  it('HTTP 410 retira definitivamente sin cerrar ni cambiar UUID y conserva binario', async () => {
    const d = draft(); await service.guardar(d, new File(['photo'], 'foto.png', { type: 'image/png' }));
    const run = service.sincronizar(); const req = await request();
    expect(req.request.headers.get('X-Epoca-Datos')).toBe(d.epoca!);
    req.flush({ code: 'EPOCA_DATOS_RETIRADA', message: 'Etapa retirada' }, { status: 410, statusText: 'Gone' }); await run;
    const saved = service.borradores()[0];
    expect(saved.epocaRetirada).toBeTrue(); expect(saved.id).toBe(d.id); expect(saved.epoca).toBe(d.epoca);
    expect(await (await service.foto(saved))!.text()).toBe('photo');
    await service.sincronizar(); http.expectNone(endpoint);
    http.expectNone(environment.apiURL + 'pozos/offline/' + d.id + '/cerrar');
  });
  it('una época nueva obtenida del servidor se usa sólo al crear, nunca en borradores guardados', async () => {
    const d = draft(); await service.guardar(d);
    spyOnProperty(navigator, 'onLine').and.returnValue(true);
    const epoch = service.epocaParaNuevo();
    const req = await request(environment.apiURL + 'pozos/epoca-datos');
    req.flush({ epoca: '22222222-2222-4222-8222-222222222222' });
    expect(await epoch).toBe('22222222-2222-4222-8222-222222222222');
    await service.cargar(); expect(service.borradores()[0].epoca).toBe(d.epoca);
    state.set('offline-unverified');
    expect(await service.epocaParaNuevo()).toBe('22222222-2222-4222-8222-222222222222');
  });
  it('fallo de foto persiste datos recuperables, bloquea upload y permite reintentar', async () => {
    const d = draft(); await service.guardar(d, new File(['old'], 'old.png', { type: 'image/png' }));
    const old = service.borradores()[0].foto;
    d.pozo.propietario_provisional = 'Datos recuperables'; files.failPhoto = true;
    await expectAsync(service.guardar(d, new File(['new'], 'new.png', { type: 'image/png' }))).toBeRejectedWithError(/fotografía nueva no quedó guardada/);
    await service.cargar();
    expect(service.borradores()[0].foto).toEqual(old); expect(service.borradores()[0].fotoPendiente).toBeTrue();
    expect(service.borradores()[0].pozo.propietario_provisional).toBe('Datos recuperables');
    expect(service.mensaje()).not.toContain('Guardado'); await service.sincronizar(); http.expectNone(endpoint);
    files.failPhoto = false; await service.guardar(service.borradores()[0], new File(['new'], 'new.png', { type: 'image/png' }));
    expect(service.borradores()[0].fotoPendiente).toBeFalse();
    expect(await (await service.foto(service.borradores()[0]))!.text()).toBe('new');
  });
  it('una copia binaria truncada no se confirma y el nuevo borrador recupera sus datos', async () => {
    const d = draft(), read = files.plugin.readFile;
    spyOn(files.plugin, 'readFile').and.callFake(async options => options.encoding ? read(options) : { data: btoa('truncated') });
    await expectAsync(service.guardar(d, new File(['complete'], 'foto.png', { type: 'image/png' }))).toBeRejectedWithError(/no quedó guardada/);
    expect(service.borradores()[0].foto).toBeUndefined(); expect(service.borradores()[0].fotoPendiente).toBeTrue();
    await service.sincronizar(); http.expectNone(endpoint);
  });
  it('borrador local permite guardar sin coordenadas ni foto', async () => {
    const d = draft(); d.sitio.latitud = ''; d.sitio.longitud = '';
    await service.guardar(d); expect(service.borradores()[0].sitio.latitud).toBe(''); expect(service.borradores()[0].foto).toBeUndefined();
  });
  it('no publica metadata antes de terminar la escritura y verificación de la foto', async () => {
    const d = draft(); const write = files.plugin.writeFile;
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    spyOn(files.plugin, 'writeFile').and.callFake(async options => { if (!options.encoding) await gate; return write(options); });
    const saving = service.guardar(d, new File(['abc'], 'foto.png', { type: 'image/png' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(files.data.size).toBe(0); expect(service.mensaje()).toBe('');
    release(); await saving; expect(service.borradores()[0].foto).toBeDefined();
  });
  it('borrar relee estado persistido y no acepta un objeto obsoleto nunca enviado', async () => {
    const d = draft(); await service.guardar(d); const run = service.sincronizar();
    (await request()).error(new ProgressEvent('error')); await run;
    await expectAsync(service.eliminar(d.id)).toBeRejectedWithError(/incierto/);
    expect(service.borradores()[0].enviado).toBeTrue();
  });
  it('borrar se serializa detrás del envío y conserva UUID si la respuesta se pierde', async () => {
    const d = draft(); await service.guardar(d); const sync = service.sincronizar(); const req = await request();
    const removal = expectAsync(service.eliminar(d.id)).toBeRejectedWithError(/incierto/);
    req.error(new ProgressEvent('error')); await sync; await removal;
    expect(service.borradores()[0].id).toBe(d.id);
  });
  it('cierre autoritativo sin creación permite eliminar; no hay DELETE remoto', async () => {
    const d = draft(); await service.guardar(d); const run = service.sincronizar();
    (await request()).flush({}, { status: 400, statusText: 'Bad Request' });
    (await request(environment.apiURL + 'pozos/offline/' + d.id + '/cerrar')).flush({ estado: 'cerrado_sin_creacion', clave: d.id }); await run;
    await service.eliminar(d.id); expect(service.borradores()).toEqual([]); expect(files.data.size).toBe(0);
  });
  it('elimina copia confirmada y nunca llama al servidor para borrar el pozo', async () => {
    const d = draft(); await service.guardar(d); const run = service.sincronizar();
    (await request()).flush({ pozo: { id_pozo: 40, numero_perforacion: 8500 } }); await run;
    expect(eliminacionLocal(service.borradores()[0])).toBe('copia');
    await service.eliminar(d.id); expect(service.borradores()).toEqual([]); http.expectNone(r => r.method === 'DELETE');
  });
  it('otra cuenta no puede borrar ni leer foto del borrador original', async () => {
    const d = draft(); await service.guardar(d, new File(['a'], 'a.png', { type: 'image/png' }));
    const saved = service.borradores()[0]; account = 8; session.offlineUser.id_usuario = 8;
    await expectAsync(service.eliminar(d.id)).toBeRejected(); await expectAsync(service.fotoUri(saved)).toBeRejected();
    expect(files.binary.size).toBe(1);
  });
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
  it('borrador anterior sin época no se envía, conserva UUID/foto y no toma la época nueva', async () => {
    const d = draft(); await service.guardar(d, new File(['abc'], 'foto.png', { type: 'image/png' }));
    for (const [path, raw] of files.data) {
      if (!path.endsWith('.json')) continue;
      const stored = JSON.parse(raw);
      if (stored.id === d.id) { delete stored.epoca; files.data.set(path, JSON.stringify(stored)); }
    }
    await service.cargar(); await service.sincronizar(); http.expectNone(endpoint);
    const saved = service.borradores()[0];
    expect(saved.epoca).toBeUndefined(); expect(saved.epocaRetirada).toBeTrue(); expect(saved.id).toBe(d.id);
    expect(await (await service.foto(saved))!.text()).toBe('abc');
    await expectAsync(service.guardar({ ...saved, epoca: d.epoca })).toBeRejected();
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
