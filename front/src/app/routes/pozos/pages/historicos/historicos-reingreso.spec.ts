import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';
import {HistoricosPage} from './historicos.page';
import {AuthService} from '../../../../shared/services/auth-service/auth.service';
import {environment} from '../../../../../environments/environment';
import {CandidatosPozoService} from '../../../../shared/services/candidatos-pozo.service';
import {fotoHistoricaPendiente} from '../../../../shared/services/historico-foto-pendiente';
describe('Reingreso histórico controlado',()=>{
 let page:HistoricosPage,http:HttpTestingController,admin:boolean,actor:number;
 const key=`historico-pendiente:${environment.apiURL}:1`;
 beforeEach(()=>{
  admin=true;actor=1;
  TestBed.configureTestingModule({imports:[HistoricosPage],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),{provide:AuthService,useValue:{userId:()=>actor,tieneRol:()=>admin,puedeGestionarHistoricos:()=>true,puedeAdministrarUsuarios:()=>admin}}]});
  page=TestBed.createComponent(HistoricosPage).componentInstance;http=TestBed.inject(HttpTestingController);
  page.reingresar.set(3277);page.vistaReingreso.set({numero:3277,id_original:19,asignado_en:'fecha',existe:false,bloqueos:[],referencias_historicas:1,elegible:true,token:'signed'});
  page.envio={actor:1,clave:'intento-rechazado',epoca:'epoca-original',rechazada:true,fotoKey:'foto-pendiente',body:{numero_perforacion:3277,empresa:'Datos conservados',foto:{mime_type:'image/jpeg',base64:'/9j/'}}};page.retirada.set(true);
 });
 afterEach(()=>{http.verify();sessionStorage.removeItem(key);});
 function preparar(){page.motivoReingreso='Misma perforación física, nueva carga';page.nuevaCarga=true;page.declaracionReingreso=true;page.confirmacionReingreso='REINGRESAR 3277';page.autorizarReingreso();}
 it('cancelar y salir no escriben ni descartan datos/foto',async()=>{const before=structuredClone(page.envio);preparar();page.cancelarReingreso();await page.guardar();page.ionViewWillLeave();expect(page.envio?.body['foto']).toEqual(before?.body['foto']);expect(page.envio?.clave).toBe(before?.clave);http.expectNone(()=>true);});
 it('exige administrador, motivo, declaraciones y palabra ligada al número',()=>{preparar();page.autorizacionReingreso=null;for(const c of ['', 'REINGRESAR 3276']){page.confirmacionReingreso=c;page.autorizarReingreso();expect(page.autorizacionReingreso).toBeNull();}page.confirmacionReingreso='REINGRESAR 3277';admin=false;page.autorizarReingreso();expect(page.autorizacionReingreso).toBeNull();http.expectNone(()=>true);});
 it('revisión GET no libera reserva ni crea una carga',async()=>{const before=structuredClone(page.envio);const pending=page.revisarReingreso();const r=http.expectOne(x=>x.url.endsWith('/historicos/reingreso/3277'));expect(r.request.method).toBe('GET');r.flush({numero:3277,id_original:19,elegible:false,token:null,bloqueos:['Referencia incompatible'],referencias_historicas:1});await pending;expect(page.envio).toEqual(before);expect(page.puedeAutorizarReingreso()).toBeFalse();});
 it('guarda misma clave, época, datos y foto con autorización; doble clic sólo un POST',async()=>{
  preparar();const before=structuredClone(page.envio);const pending=page.guardar();await page.guardar();
  const req=http.expectOne(x=>x.method==='POST');expect(req.request.headers.get('Idempotency-Key')).toBe('intento-rechazado');expect(req.request.headers.get('X-Epoca-Datos')).toBe('epoca-original');expect(req.request.body).toEqual(before?.body);
  req.flush({message:'La autorización venció'},{status:409,statusText:'Conflict'});await pending;
  expect(page.envio?.body['foto']).toEqual(before?.body['foto']);expect(page.envio?.fotoKey).toBe('foto-pendiente');expect(JSON.parse(sessionStorage.getItem(key)!).body.foto).toBeUndefined();expect(page.error()).toContain('venció');
 });
 it('renueva sólo el token manteniendo identidad; cambio de motivo tras envío no se aplica',()=>{preparar();const before=structuredClone(page.envio);page.vistaReingreso.update(v=>({...v!,token:'renewed'}));page.autorizarReingreso();expect(page.envio?.clave).toBe(before?.clave);expect((page.envio?.body['reingreso'] as any).token).toBe('renewed');page.motivoReingreso='Un motivo distinto posterior';page.autorizarReingreso();expect((page.envio?.body['reingreso'] as any).motivo).toBe(page.autorizacionReingreso?.motivo);});
 it('revisión posterior a respuesta perdida no impide consultar el resultado con la misma clave',async()=>{
  preparar();const before=structuredClone(page.envio);const revision=page.revisarReingreso();http.expectOne(r=>r.method==='GET').flush({numero:3277,elegible:false,token:null,existe:true,bloqueos:['Ya existe']});await revision;
  const pending=page.guardar();const req=http.expectOne(r=>r.method==='POST');expect(req.request.body).toEqual(before?.body);expect(req.request.headers.get('Idempotency-Key')).toBe(before!.clave);req.flush({message:'Sin conexión confirmada'},{status:503,statusText:'Unavailable'});await pending;expect(page.envio?.clave).toBe(before?.clave);
 });
 it('cambio de sesión y otro borrador impiden apropiación o sustitución',async()=>{actor=2;preparar();await page.guardar();expect(page.autorizacionReingreso).toBeNull();http.expectNone(()=>true);actor=1;page.envio!.body['numero_perforacion']=3000;preparar();expect(page.envio!.body['numero_perforacion']).toBe(3000);expect(page.autorizacionReingreso).toBeNull();});
 it('recarga conserva clave, época, datos y fotografía de IndexedDB en la misma cuenta',async()=>{
  preparar();const before=structuredClone(page.envio)!;const photoKey='test-reingreso-'+crypto.randomUUID();before.fotoKey=photoKey;
  await fotoHistoricaPendiente(photoKey,'guardar',before.body['foto']);
  try{
   sessionStorage.setItem(key,JSON.stringify({...before,body:{...before.body,foto:undefined}}));page.envio=undefined;
   spyOn(TestBed.inject(CandidatosPozoService),'obtener').and.resolveTo({propietarios:[],perforadores:[]} as any);
   await page.ionViewWillEnter();const recovered=page.envio as typeof before|undefined;expect(recovered?.clave).toBe(before.clave);expect(recovered?.epoca).toBe(before.epoca);expect(recovered?.body).toEqual(before.body);expect(page.pozo().empresa).toBe('Datos conservados');http.expectNone(()=>true);
  }finally{await fotoHistoricaPendiente(photoKey,'borrar');}
 });
});
