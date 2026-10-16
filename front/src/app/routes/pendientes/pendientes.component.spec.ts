import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PendientesComponent, GrupoPendiente } from './pendientes.component';
import { CandidatosPozoService } from '../../shared/services/candidatos-pozo.service';

describe('Pendientes administrativos: selección explícita',()=>{
  const grupo:GrupoPendiente={tipo:'propietario',texto:'Alejandro Vanucci',ocurrencias:[1,2,3].map(id=>({id,id_pozo:id,numero_perforacion:2100+id,texto:'Alejandro Vanucci',version:'10',version_pozo:'10'}))};
  let http:HttpTestingController;
  beforeEach(()=>{
    TestBed.configureTestingModule({imports:[PendientesComponent],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:CandidatosPozoService,useValue:{buscar:async()=>[{id_usuario:8,nombre:'Alejandro Vanucci',documento_rut:'123'}]}}]});
    http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>http.verify());
  it('muestra provisionales existentes y exige elegir ocurrencias y confirmar aunque coincida el nombre',async()=>{
    const f=TestBed.createComponent(PendientesComponent);f.detectChanges();
    http.expectOne(r=>r.url.endsWith('personas-pendientes')).flush([grupo]);await f.whenStable();f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Alejandro Vanucci');
    const c=f.componentInstance;c.abrir(c.grupos()[0]);await c.buscar();c.destino=8;
    expect(c.seleccion().size).toBe(0);expect(c.confirmar()).toBeFalse();
    c.marcar(2,true);await c.vincular();http.expectNone(r=>r.method==='POST');
    c.confirmar.set(true);const pendiente=c.vincular();
    const request=http.expectOne(r=>r.method==='POST');
    expect(request.request.body.ocurrencias).toEqual([{id:2,id_pozo:2,texto:grupo.texto,version:'10',version_pozo:'10'}]);
    request.flush({vinculadas:1});await Promise.resolve();
    http.expectOne(r=>r.method==='GET').flush([{...grupo,ocurrencias:grupo.ocurrencias.filter(o=>o.id!==2)}]);await pendiente;
    expect(c.grupos()[0].ocurrencias.length).toBe(2);
  });
  it('conflicto no elimina filas ni reintenta silenciosamente',async()=>{
    const f=TestBed.createComponent(PendientesComponent);f.detectChanges();http.expectOne(r=>r.method==='GET').flush([grupo]);await f.whenStable();
    const c=f.componentInstance;c.abrir(c.grupos()[0]);c.todas();c.destino=8;c.confirmar.set(true);
    const pendiente=c.vincular();http.expectOne(r=>r.method==='POST').flush({message:'Una ocurrencia cambió. Recargue.'},{status:409,statusText:'Conflict'});await pendiente;
    expect(c.error()).toContain('Recargue');expect(c.grupos()[0].ocurrencias.length).toBe(3);expect(c.confirmar()).toBeFalse();
  });
});
