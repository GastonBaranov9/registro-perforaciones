import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { HistoricosPage } from './historicos.page';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { environment } from '../../../../../environments/environment';

describe('Carga histórica separada',()=>{
  let page:HistoricosPage,http:HttpTestingController;
  const epoch='11111111-1111-4111-8111-111111111111';
  const storage=`historico-pendiente:${environment.apiURL}:1`;
  beforeEach(()=>{
    sessionStorage.removeItem(storage);
    TestBed.configureTestingModule({imports:[HistoricosPage],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:AuthService,useValue:{userId:()=>1}},
      {provide:CandidatosPozoService,useValue:{obtener:async()=>({propietarios:[],perforadores:[]})}}]});
    page=TestBed.createComponent(HistoricosPage).componentInstance;http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{http.verify();sessionStorage.removeItem(storage);});
  it('rechaza >=3282 y no envía solicitud',async()=>{
    page.numero=3282;await page.guardar();expect(page.error()).toContain('3281');http.expectNone(`${environment.apiURL}pozos/historicos`);
  });
  it('datos desconocidos ausentes; recarga y reintento mantienen UUID, época y payload',async()=>{
    page.numero=3281;const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/epoca-datos`).flush({epoca:epoch});
    await new Promise(r=>setTimeout(r,0));
    const req=http.expectOne(`${environment.apiURL}pozos/historicos`);
    expect(req.request.body).toEqual({numero_perforacion:3281});
    const key=req.request.headers.get('Idempotency-Key');
    req.error(new ProgressEvent('network'));await save;
    page=TestBed.createComponent(HistoricosPage).componentInstance;await page.ionViewWillEnter();
    const retry=page.guardar();const again=http.expectOne(`${environment.apiURL}pozos/historicos`);
    expect(again.request.headers.get('Idempotency-Key')).toBe(key);expect(again.request.headers.get('X-Epoca-Datos')).toBe(epoch);
    expect(again.request.body).toEqual({numero_perforacion:3281});
    again.flush({id_pozo:40,numero_perforacion:3281});await retry;expect(page.resultado()?.id_pozo).toBe(40);
    page.otra();expect(sessionStorage.getItem(storage)).toBeNull();
  });
  it('una solicitud antigua rechazada no obtiene otra época ni se reenvía',async()=>{
    sessionStorage.setItem(storage,JSON.stringify({actor:1,clave:crypto.randomUUID(),epoca:epoch,body:{numero_perforacion:3281}}));
    await page.ionViewWillEnter();const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/historicos`).flush({code:'EPOCA_DATOS_RETIRADA',message:'Etapa retirada'},{status:410,statusText:'Gone'});
    await save;expect(page.retirada()).toBeTrue();await page.guardar();http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
  });
  it('un número ocupado permite descartar explícitamente el intento; no recicla payload ni época',async()=>{
    sessionStorage.setItem(storage,JSON.stringify({actor:1,clave:crypto.randomUUID(),epoca:epoch,body:{numero_perforacion:3281}}));
    await page.ionViewWillEnter();const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/historicos`).flush({code:'HISTORICO_NUMERO_OCUPADO',message:'Reservado'},{status:409,statusText:'Conflict'});
    await save;expect(page.envio?.rechazada).toBeTrue();
    page.otra();expect(page.envio).toBeUndefined();expect(page.numero).toBeNull();expect(page.retirada()).toBeFalse();
    http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
  });
  it('abre un P-3281 parcial existente y lo completa mediante PATCH sin campos inmutables',async()=>{
    const fixture=TestBed.createComponent(HistoricosPage);fixture.componentRef.setInput('id_pozo','18');page=fixture.componentInstance;
    spyOn(TestBed.inject(PozosEditService),'getPozoById').and.resolveTo({id_pozo:18,numero_perforacion:3281,origen:'historico',id_sitio:null,id_propietario:null,id_perforador:null,fecha_creado:'2026-10-06'});
    spyOn(TestBed.inject(IntervaloLitologicoListService),'getIntervalosLitologicos').and.resolveTo([]);
    spyOn(TestBed.inject(IntervaloDiametroListService),'getIntervalosDiametros').and.resolveTo([]);
    spyOn(TestBed.inject(IntervalosFiltroService),'listar').and.resolveTo([]);
    spyOn(TestBed.inject(AporteListService),'getNivelesAporte').and.resolveTo([]);
    const nav=spyOn(TestBed.inject(Router),'navigate').and.resolveTo(true);
    await page.ionViewWillEnter();expect(page.pozo().numero_perforacion).toBe(3281);expect(page.pozo().empresa).toBeUndefined();
    page.pozo.update(p=>({...p,id_propietario:2,id_perforador:3,profundidad_final_m:40,nivel_estatico_m:3}));
    page.sitio.set({departamento:'Salto',localidad:'Campo',latitud:'-31',longitud:'-57'});
    const save=page.guardar({pozo:page.pozo(),foto:null,fotoAccion:'conservar'});
    const req=http.expectOne(`${environment.apiURL}pozos/historicos/18`);expect(req.request.method).toBe('PATCH');
    expect(req.request.body.id_propietario).toBe(2);expect(req.request.body.id_perforador).toBe(3);expect(req.request.body.foto_accion).toBe('conservar');
    for(const k of ['numero_perforacion','origen','id_pozo','id_sitio','creado_por'])expect(req.request.body[k]).toBeUndefined();
    req.flush({id_pozo:18,numero_perforacion:3281,origen:'historico'});await save;
    expect(nav).toHaveBeenCalledWith(['/pozos-detail',18]);http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
  });
  it('conserva foto en IndexedDB y reintenta después de recargar con misma clave y payload',async()=>{
    const waitRequest=async(url:string)=>{for(let i=0;i<100;i++){const requests=http.match(url);if(requests.length)return requests[0];await new Promise(r=>setTimeout(r,5));}throw Error('Solicitud no recibida: '+url);};
    page.numero=3279;const foto=new File([new Uint8Array([1,2,3])],'foto.png',{type:'image/png'});
    const save=page.guardar({pozo:page.pozo(),foto,fotoAccion:'reemplazar'});
    (await waitRequest(`${environment.apiURL}pozos/epoca-datos`)).flush({epoca:epoch});
    const req=await waitRequest(`${environment.apiURL}pozos/historicos`);const body=req.request.body,key=req.request.headers.get('Idempotency-Key');
    expect(body.foto.base64).toBe('AQID');expect(JSON.parse(sessionStorage.getItem(storage)!).body.foto).toBeUndefined();
    req.error(new ProgressEvent('network'));await save;
    page=TestBed.createComponent(HistoricosPage).componentInstance;await page.ionViewWillEnter();
    const retry=page.guardar();const again=await waitRequest(`${environment.apiURL}pozos/historicos`);
    expect(again.request.body).toEqual(body);expect(again.request.headers.get('Idempotency-Key')).toBe(key);
    again.flush({id_pozo:19,numero_perforacion:3279});await retry;
  });
});
