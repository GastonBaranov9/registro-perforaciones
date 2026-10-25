import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';
import {NumeracionPage} from './numeracion.page';
import {AuthService} from '../../../../shared/services/auth-service/auth.service';
describe('Tres funciones de numeración',()=>{
 it('muestra configuración con motivo, rectificación y reservas individuales sin sustituciones',async()=>{
  TestBed.configureTestingModule({imports:[NumeracionPage],providers:[provideRouter([]),provideHttpClient(),provideHttpClientTesting(),{provide:AuthService,useValue:{tieneRol:()=>true}}]});
  const f=TestBed.createComponent(NumeracionPage),p=f.componentInstance,http=TestBed.inject(HttpTestingController);
  p.estado.set({proximo:3282,minimo:3282,agotado:false});p.proximo=3290;f.detectChanges();
  const text=f.nativeElement.textContent;expect(text).toContain('Configurar próximo número automático');expect(text).toContain('Rectificación excepcional');expect(text).toContain('Administrar números');
  await p.guardar();http.expectNone(()=>true);p.motivo='Adelanto administrativo solicitado';const pending=p.guardar();const r=http.expectOne(x=>x.method==='PUT');expect(r.request.body).toEqual({proximo:3290,esperado:3282,motivo:p.motivo});r.flush({proximo:3290,minimo:3290,agotado:false});await pending;http.verify();
 });
});
