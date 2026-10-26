import {TestBed,ComponentFixture} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting,HttpTestingController} from '@angular/common/http/testing';
import {PoliticaNumeracionComponent} from './politica-numeracion.component';
describe('Política histórica de numeración',()=>{
 let f:ComponentFixture<PoliticaNumeracionComponent>,p:PoliticaNumeracionComponent,http:HttpTestingController;
 const state={revision:'1',rangos:[{desde:1,hasta:3281}],excepciones:[],puede_administrar:true,historial:[]};
 const revision={token:'signed',frase:'POLITICA 300',anterior:state,posterior:{rangos:state.rangos,excepciones:[300]}};
 beforeEach(()=>{TestBed.configureTestingModule({imports:[PoliticaNumeracionComponent],providers:[provideHttpClient(),provideHttpClientTesting()]});f=TestBed.createComponent(PoliticaNumeracionComponent);p=f.componentInstance;http=TestBed.inject(HttpTestingController);f.detectChanges();});
 afterEach(()=>http.verify());
 async function cargar(){const t=p.cargar();http.expectOne(r=>r.method==='GET').flush(state);await t;p.desde=300;p.motivo='Carpetas revisadas sin uso anterior';f.detectChanges();}
 async function revisar(){const t=p.revisar();http.expectOne(r=>r.method==='POST').flush(revision);await t;f.detectChanges();}
 it('consulta explícita; no carga ni escribe al montar; cinco herramientas no se sustituyen',async()=>{http.expectNone(()=>true);await cargar();expect(f.nativeElement.textContent).toContain('1 a 3281');expect(f.nativeElement.textContent).toContain('Excepciones');http.expectNone(r=>r.method!=='GET');});
 it('permiso, entero positivo, rango y motivo tienen explicación',async()=>{await cargar();p.politica.update(x=>({...x!,puede_administrar:false}));expect(p.impedimento()).toContain('autorización');p.politica.set(state);p.desde=0;expect(p.impedimento()).toContain('positivo');p.desde=300;p.motivo='x';expect(p.impedimento()).toContain('10');p.motivo='Revisar carpetas físicas';p.operacion='proteger_rango';p.hasta=200;expect(p.impedimento()).toContain('rango');await p.revisar();http.expectNone(r=>r.method==='POST');});
 it('revisión y cancelación nunca envían PUT',async()=>{await cargar();await revisar();p.cancelar();await p.guardar();http.expectNone(r=>r.method==='PUT');expect(p.revision()).toBeNull();});
 it('cerrar o cambiar campos invalida la confirmación',async()=>{await cargar();await revisar();p.cerrar();expect(p.abierta()).toBeFalse();expect(p.revision()).toBeNull();await p.guardar();http.expectNone(r=>r.method==='PUT');});
 it('declaración y frase exacta; doble clic escribe una vez; éxito sólo después',async()=>{await cargar();await revisar();await p.guardar();http.expectNone(r=>r.method==='PUT');p.declaracion=true;p.confirmacion='POLITICA 300';const t=p.guardar();await p.guardar();expect(p.mensaje()).toBe('');const r=http.expectOne(r=>r.method==='PUT');expect(r.request.body.evidencia_fisica).toBeTrue();expect(r.request.body.desde).toBe(300);r.flush({...state,...revision.posterior,revision:'2'});await t;expect(p.mensaje()).toContain('guardada');expect(p.revision()).toBeNull();});
 it('conflicto no declara éxito ni reintenta; obliga a nueva revisión',async()=>{await cargar();await revisar();p.declaracion=true;p.confirmacion='POLITICA 300';const t=p.guardar();http.expectOne(r=>r.method==='PUT').flush({message:'Antecedente nuevo: no disponible'},{status:409,statusText:'Conflict'});await t;expect(p.error()).toContain('no disponible');expect(p.mensaje()).toBe('');await p.guardar();http.expectNone(r=>r.method==='PUT');});
 it('respuesta tardía al salir no recupera autorización',async()=>{await cargar();const t=p.revisar();p.ngOnDestroy();http.expectOne(r=>r.method==='POST').flush(revision);await t;expect(p.revision()).toBeNull();});
});
