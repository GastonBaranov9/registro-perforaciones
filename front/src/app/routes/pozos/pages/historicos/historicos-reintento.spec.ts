import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { HistoricosPage } from './historicos.page';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { environment } from '../../../../../environments/environment';
describe('Reintento histórico conservado',()=>{
  let page:HistoricosPage,http:HttpTestingController;
  const storage=`historico-pendiente:${environment.apiURL}:1`;
  beforeEach(()=>{
    TestBed.configureTestingModule({imports:[HistoricosPage],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),{provide:AuthService,useValue:{userId:()=>1,puedeGestionarHistoricos:()=>true,puedeAdministrarUsuarios:()=>true}}]});
    page=TestBed.createComponent(HistoricosPage).componentInstance;http=TestBed.inject(HttpTestingController);
    page.envio={actor:1,clave:'clave-conservada',epoca:'epoca-conservada',rechazada:true,body:{numero_perforacion:3277,foto:{mime:'image/jpeg',base64:'/9j/'}}};page.retirada.set(true);
  });
  afterEach(()=>{http.verify();sessionStorage.removeItem(storage);});
  it('número todavía reservado conserva datos, foto y clave sin POST',async()=>{
    const before=structuredClone(page.envio);const pending=page.comprobarReintento();
    http.expectOne(r=>r.url.endsWith('/disponibilidad/3277')).flush({utilizado:true});http.expectOne(r=>r.url.endsWith('/epoca-datos')).flush({epoca:'epoca-conservada'});
    await pending;expect(page.envio).toEqual(before);expect(page.retirada()).toBeTrue();http.expectNone(r=>r.method!=='GET');
  });
  it('reserva rectificada habilita la misma carga, sin reenviarla automáticamente',async()=>{
    const before=structuredClone(page.envio);const pending=page.comprobarReintento();
    http.expectOne(r=>r.url.endsWith('/disponibilidad/3277')).flush({utilizado:false});http.expectOne(r=>r.url.endsWith('/epoca-datos')).flush({epoca:'epoca-conservada'});
    await pending;expect(page.envio).toEqual({...before!,rechazada:false});expect(page.retirada()).toBeFalse();http.expectNone(r=>r.method!=='GET');
  });
  it('época distinta impide reintento sin descartar fotografía',async()=>{
    const before=structuredClone(page.envio);const pending=page.comprobarReintento();
    http.expectOne(r=>r.url.endsWith('/disponibilidad/3277')).flush({utilizado:false});http.expectOne(r=>r.url.endsWith('/epoca-datos')).flush({epoca:'otra'});
    await pending;expect(page.envio).toEqual(before);expect(page.retirada()).toBeTrue();
  });
});
