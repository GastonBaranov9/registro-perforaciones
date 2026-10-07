import { tecnicosPersistidos } from '../../../../shared/utils/tecnicos-persistidos';
import { fotoHistoricaPendiente } from '../../../../shared/services/historico-foto-pendiente';

import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { AccionFotoEdicion, NuevoPozo, SitioBody, DatosTecnicosBorrador, PropietarioOperativoCrearBody, PropietarioOperativoActualizarBody } from '../../../../shared/types/schemas';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { normalizarFechaCalendarioInput } from '../../../../shared/utils/fechas';
import { convertirFoto } from '../../../../shared/services/pozos-create.service';
import { cuerpoHistorico, tecnicosVacios } from '../../../../shared/utils/historicos-form';
import { Component, inject, input, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { CandidatoPozo } from '../../../../shared/types/schemas';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

@Component({
  selector: 'app-historicos', imports: [FormsModule, IonContent, IonButton, PozosFormComponent, DatosTecnicosBorradorComponent],
  templateUrl: './historicos.page.html',
  styles: ['fieldset { border:0; padding:0; min-width:0; } .error { color:var(--ion-color-danger); }'],
})
export class HistoricosPage {
  private http = inject(HttpClient); private router = inject(Router); private candidatos = inject(CandidatosPozoService);
  private auth = inject(AuthService);
  private storageKey() { const actor = this.auth.userId(); if (!actor) throw new Error('Inicie sesión como administrador.'); return `historico-pendiente:${environment.apiURL}:${actor}`; }
  propietarios = signal<CandidatoPozo[]>([]); perforadores = signal<CandidatoPozo[]>([]);
  error = signal(''); ocupado = signal(false); retirada = signal(false);
  resultado = signal<{ id_pozo: number; numero_perforacion: number } | null>(null);
  readonly id_pozo=input<string>();
  readonly pozo=signal<NuevoPozo>({id_propietario:null,id_perforador:0,id_sitio:0});
  readonly sitio=signal<SitioBody>({departamento:'',localidad:'',latitud:'',longitud:''});
  readonly tecnicos=signal<DatosTecnicosBorrador>(tecnicosVacios());
  readonly inicial=signal<DatosTecnicosBorrador>(tecnicosVacios());
  readonly cargado=signal(false);
  @ViewChild(PozosFormComponent) formulario?:PozosFormComponent;
  private editor=inject(PozosEditService);
  private propietariosService=inject(PropietariosOperativosService);
  private litologia=inject(IntervaloLitologicoListService);
  private diametros=inject(IntervaloDiametroListService);
  private filtros=inject(IntervalosFiltroService);
  private aportes=inject(AporteListService);
  buscarPropietarios=(texto:string)=>this.candidatos.buscar('propietario',texto);
  buscarPerforadores=(texto:string)=>this.candidatos.buscar('perforador',texto);
  get numero(){return this.pozo().numero_perforacion??null;}
  set numero(n:number|null){this.pozo.update(p=>({...p,numero_perforacion:n}));}
  envio?: { actor: number; clave: string; epoca: string; body: Record<string, unknown>; rechazada?: boolean; fotoKey?: string };
  async ionViewWillEnter() {
    try {
      const saved = this.id_pozo() ? null : sessionStorage.getItem(this.storageKey());
      if (!this.envio && saved) this.envio = JSON.parse(saved);
      if(this.envio?.fotoKey&&!this.envio.body['foto']&&!this.resultado()){const foto=await fotoHistoricaPendiente(this.envio.fotoKey,'leer');if(!foto)throw Error('Falta la foto pendiente. No se enviará una carga incompleta.');this.envio.body['foto']=foto;}
      if (this.envio?.rechazada) this.retirada.set(true);
      if (this.envio && this.envio.actor !== this.auth.userId()) { this.envio = undefined; this.resultado.set(null); }
      const c = await this.candidatos.obtener({ limite: 50 }); this.propietarios.set(c.propietarios); this.perforadores.set(c.perforadores);
      if(this.id_pozo()&&!this.cargado())await this.cargarEdicion();
      this.cargado.set(true);
    }
    catch(error) { this.error.set(error instanceof Error ? error.message : 'No se pudo cargar la perforación. Reabra la pantalla para reintentar.'); }
  }
  async guardar(data?:{pozo:NuevoPozo;foto:File|null;fotoAccion:AccionFotoEdicion}) {
    if(this.id_pozo()){if(data)await this.editar(data);return;}
    if (this.ocupado() || this.resultado() || this.retirada()) return;
    this.ocupado.set(true); this.error.set('');
    try {
      if (!this.envio) {
        const actor = this.auth.userId();
        if (!actor) throw new Error('Inicie sesión como administrador.');
        if (!Number.isInteger(this.numero) || this.numero! < 1 || this.numero! > 3281) throw new Error('Ingrese un número entero entre 1 y 3281.');
        const body=cuerpoHistorico(data?.pozo??this.pozo(),this.sitio(),this.tecnicos(),false);
        body['numero_perforacion']=this.numero;
        if(data?.foto)body['foto']=await convertirFoto(data.foto);
        const { epoca } = await firstValueFrom(this.http.get<{ epoca: string }>(`${environment.apiURL}pozos/epoca-datos`).pipe(timeout(15000)));
        if (this.auth.userId() !== actor) throw new Error('La sesión cambió. Reabra Carga histórica.');
        this.envio = { actor, clave: crypto.randomUUID(), epoca, body };
      }
      const e = this.envio;
      if (e.actor !== this.auth.userId()) throw new Error('La sesión cambió. Reabra Carga histórica con la cuenta original.');
      if(e.fotoKey&&!e.body['foto'])throw Error('No se pudo recuperar la fotografía pendiente.');
      if(e.body['foto']&&!e.fotoKey){
        const key=this.storageKey()+':'+e.clave;
        await fotoHistoricaPendiente(key,'guardar',e.body['foto']);e.fotoKey=key;
      }
      // Persistir antes del primer envío. Un reload conserva la época original.
      sessionStorage.setItem(this.storageKey(), JSON.stringify({...e,body:{...e.body,foto:undefined}}));
      const result = await firstValueFrom(this.http.post<{ id_pozo: number; numero_perforacion: number }>(`${environment.apiURL}pozos/historicos`, e.body,
        { headers: { 'Idempotency-Key': e.clave, 'X-Epoca-Datos': e.epoca } }).pipe(timeout(90000)));
      this.resultado.set(result);
      sessionStorage.removeItem(this.storageKey());
      if(e.fotoKey)void fotoHistoricaPendiente(e.fotoKey,'borrar').catch(()=>{});
      void this.router.navigate(['/pozos-detail',result.id_pozo]).catch(()=>{});
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 410) this.retirada.set(true);
      if (this.envio && error instanceof HttpErrorResponse && (error.status === 400 || error.status === 410 || error.error?.code === 'HISTORICO_NUMERO_OCUPADO')) {
        this.envio.rechazada = true; this.retirada.set(true);
        try { sessionStorage.setItem(this.storageKey(), JSON.stringify({...this.envio,body:{...this.envio.body,foto:undefined}})); } catch { /* el intento sigue en memoria */ }
      }
      this.error.set(error instanceof HttpErrorResponse ? error.error?.message || 'No se confirmó la recepción. Reintente la misma carga.' : String(error));
    } finally { this.ocupado.set(false); }
  }
  ver(id: number) { void this.router.navigate(['/pozos-detail', id]); }
  otra() {
    if(this.ocupado()||(!this.resultado()&&!this.envio?.rechazada))return;
    if(this.envio?.fotoKey)void fotoHistoricaPendiente(this.envio.fotoKey,'borrar').catch(()=>{});
    sessionStorage.removeItem(this.storageKey());this.envio=undefined;this.resultado.set(null);this.retirada.set(false);this.error.set('');
    this.pozo.set({id_propietario:null,id_perforador:0,id_sitio:0});this.sitio.set({departamento:'',localidad:'',latitud:'',longitud:''});
    this.inicial.set(tecnicosVacios());this.tecnicos.set(tecnicosVacios());this.formulario?.cancelarCambioFoto();
  }
  private async cargarEdicion(){
    const id=Number(this.id_pozo());
    if(!Number.isInteger(id)||id<1)throw Error('Identificador inválido.');
    const [p,l,d,f,a]=await Promise.all([this.editor.getPozoById(id),this.litologia.getIntervalosLitologicos(id),this.diametros.getIntervalosDiametros(id),this.filtros.listar(id),this.aportes.getNivelesAporte(id)]);
    if(p.origen!=='historico')throw Error('Esta pantalla sólo edita perforaciones históricas.');
    if(p.id_propietario&&!this.propietarios().some(x=>x.id_usuario===p.id_propietario)){const persona=await this.candidatos.obtenerPorId('propietario',p.id_propietario);if(persona)this.propietarios.update(xs=>[persona,...xs]);}
    if(p.id_perforador&&!this.perforadores().some(x=>x.id_usuario===p.id_perforador)){const persona=await this.candidatos.obtenerPorId('perforador',p.id_perforador);if(persona)this.perforadores.update(xs=>[persona,...xs]);}
    this.pozo.set({...p,id_perforador:p.id_perforador??0,id_sitio:p.id_sitio??0,fecha_inicio:normalizarFechaCalendarioInput(p.fecha_inicio),fecha_fin:normalizarFechaCalendarioInput(p.fecha_fin)});
    if(p.sitio)this.sitio.set({...p.sitio,latitud:p.sitio.latitud??'',longitud:p.sitio.longitud??''});
    const technical=tecnicosPersistidos(l,d,f,a);this.inicial.set(technical);this.tecnicos.set(technical);
  }
  async editar(data:{pozo:NuevoPozo;foto:File|null;fotoAccion:AccionFotoEdicion}){
    if(this.ocupado()||!this.cargado())return;
    this.ocupado.set(true);this.error.set('');
    try{
      const body=cuerpoHistorico(data.pozo,this.sitio(),this.tecnicos(),true);
      body['foto_accion']=data.fotoAccion;
      if(data.foto)body['foto']=await convertirFoto(data.foto);
      await firstValueFrom(this.http.patch(environment.apiURL+'pozos/historicos/'+this.id_pozo(),body).pipe(timeout(90000)));
      this.formulario?.cancelarCambioFoto();this.cargado.set(false);this.ver(Number(this.id_pozo()));
    }catch(e){this.error.set(e instanceof HttpErrorResponse?e.error?.message||'No se confirmó la edición. Los cambios siguen en el formulario.':String(e));}
    finally{this.ocupado.set(false);}
  }
  async crearPropietario(body:PropietarioOperativoCrearBody){
    if(this.ocupado()||this.envio)return;this.ocupado.set(true);
    try{const p=await this.propietariosService.crear(body);this.propietarios.update(xs=>[p,...xs]);this.pozo.update(x=>({...x,id_propietario:p.id_usuario,propietario_provisional:null}));}
    catch(e){this.error.set(String(e));}finally{this.ocupado.set(false);}
  }
  async actualizarPropietario(event:{id:number;body:PropietarioOperativoActualizarBody}){
    if(this.ocupado()||this.envio)return;this.ocupado.set(true);
    try{const p=await this.propietariosService.actualizar(event.id,event.body);this.propietarios.update(xs=>xs.map(x=>x.id_usuario===event.id?{...x,...p}:x));}
    catch(e){this.error.set(String(e));}finally{this.ocupado.set(false);}
  }
}
