import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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
});
