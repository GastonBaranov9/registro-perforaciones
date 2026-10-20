import { tecnicosPersistidos } from '../../../../shared/utils/tecnicos-persistidos';
import { DATOS_TECNICOS_ESTANDAR } from '../../../../shared/constants/datos-tecnicos-estandar';
import { huellaFormulario } from '../../../../shared/utils/estado-formulario-perforacion';
import { EstadoPerforacion, reconciliarPerforacion } from '../../../../shared/utils/reconciliar-perforacion';
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
import { Component, DestroyRef, inject, input, signal, ViewChild } from '@angular/core';
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
  readonly auth = inject(AuthService);
  private storageKey() { const actor = this.auth.userId(); if (!actor) throw new Error('Inicie sesión con permiso para carga histórica.'); return `historico-pendiente:${environment.apiURL}:${actor}`; }
  propietarios = signal<CandidatoPozo[]>([]); perforadores = signal<CandidatoPozo[]>([]);
  error = signal(''); ocupado = signal(false); retirada = signal(false);
  resultado = signal<{ id_pozo: number; numero_perforacion: number } | null>(null);
  readonly id_pozo=input<string>();
  readonly pozo=signal<NuevoPozo>({id_propietario:null,id_perforador:0,id_sitio:0,...DATOS_TECNICOS_ESTANDAR});
  readonly sitio=signal<SitioBody>({departamento:'',localidad:'',latitud:'',longitud:''});
  readonly tecnicos=signal<DatosTecnicosBorrador>(tecnicosVacios());
  readonly inicial=signal<DatosTecnicosBorrador>(tecnicosVacios());
  readonly cargado=signal(false);
  readonly versionTecnicos = signal(0);
  readonly recargaPendiente = signal(false);
  private tecnicosGuardados?: DatosTecnicosBorrador;
  private guardadoPendiente?: { enviado: EstadoPerforacion; foto: File | null; accion: AccionFotoEdicion };
  @ViewChild(PozosFormComponent) formulario?:PozosFormComponent;
  private baseFormulario = this.huellaActual();
  private readonly destroyRef = inject(DestroyRef);
  private huellaActual() { return huellaFormulario(this.pozo(), this.sitio(), this.tecnicos(), true); }
  tieneCambiosSinGuardar(): boolean {
    if (this.resultado() && !this.id_pozo()) return false;
    return this.recargaPendiente() || this.huellaActual() !== this.baseFormulario
      || !!this.formulario?.fotoFile || !!this.formulario?.eliminarFotoPendiente()
      || !!this.formulario?.tieneCambiosPropietario();
  }
  private editor=inject(PozosEditService);
  private propietariosService=inject(PropietariosOperativosService);
  private litologia=inject(IntervaloLitologicoListService);
  private diametros=inject(IntervaloDiametroListService);
  private filtros=inject(IntervalosFiltroService);
  private aportes=inject(AporteListService);
  buscarPropietarios=(texto:string)=>this.candidatos.buscar('propietario',texto,true);
  buscarPerforadores=(texto:string)=>this.candidatos.buscar('perforador',texto,true);
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
      const c = await this.candidatos.obtener({ limite: 50, historico: true }); this.propietarios.set(c.propietarios); this.perforadores.set(c.perforadores);
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
    this.pozo.set({id_propietario:null,id_perforador:0,id_sitio:0,...DATOS_TECNICOS_ESTANDAR});this.sitio.set({departamento:'',localidad:'',latitud:'',longitud:''});
    this.inicial.set(tecnicosVacios());this.tecnicos.set(tecnicosVacios());this.formulario?.cancelarCambioFoto();
  }
  private async cargarEdicion(){
    const id=Number(this.id_pozo());
    if(!Number.isInteger(id)||id<1)throw Error('Identificador inválido.');
    const [p,l,d,f,a]=await Promise.all([this.editor.getPozoById(id),this.litologia.getIntervalosLitologicos(id),this.diametros.getIntervalosDiametros(id),this.filtros.listar(id),this.aportes.getNivelesAporte(id)]);
    if(p.origen!=='historico')throw Error('Esta pantalla sólo edita perforaciones históricas.');
    if(p.id_propietario&&!this.propietarios().some(x=>x.id_usuario===p.id_propietario)){const persona=await this.candidatos.obtenerPorId('propietario',p.id_propietario,true);if(persona)this.propietarios.update(xs=>[persona,...xs]);}
    if(p.id_perforador&&!this.perforadores().some(x=>x.id_usuario===p.id_perforador)){const persona=await this.candidatos.obtenerPorId('perforador',p.id_perforador,true);if(persona)this.perforadores.update(xs=>[persona,...xs]);}
    this.pozo.set({...p,id_perforador:p.id_perforador??0,id_sitio:p.id_sitio??0,fecha_inicio:normalizarFechaCalendarioInput(p.fecha_inicio),fecha_fin:normalizarFechaCalendarioInput(p.fecha_fin)});
    if(p.sitio)this.sitio.set({...p.sitio,latitud:p.sitio.latitud??'',longitud:p.sitio.longitud??''});
    const technical=tecnicosPersistidos(l,d,f,a,p.sello_sanitario_constructivo);this.tecnicosGuardados=structuredClone(technical);this.inicial.set(technical);this.tecnicos.set(structuredClone(technical));
    this.baseFormulario = this.huellaActual();
  }
  async editar(data:{pozo:NuevoPozo;foto:File|null;fotoAccion:AccionFotoEdicion}){
    if(this.ocupado()||!this.cargado())return;
    if (this.recargaPendiente()) { await this.actualizarGuardado(); return; }
    this.ocupado.set(true);this.error.set('');
    try{
      const enviado = structuredClone({ pozo: data.pozo, sitio: this.sitio(), tecnicos: this.tecnicos() });
      const fotoEnviada = data.foto, accionEnviada = data.fotoAccion;
      const id = Number(this.id_pozo()), rutaAlEnviar = this.router.url;
      const body=cuerpoHistorico(enviado.pozo,enviado.sitio,enviado.tecnicos,true,this.tecnicosGuardados);
      body['foto_accion']=accionEnviada;
      if(fotoEnviada)body['foto']=await convertirFoto(fotoEnviada);
      await firstValueFrom(this.http.patch(environment.apiURL+'pozos/historicos/'+id,body).pipe(timeout(90000)));
      if (this.destroyRef.destroyed) return;
      this.guardadoPendiente = { enviado, foto: fotoEnviada, accion: accionEnviada };
      this.recargaPendiente.set(true);
      await this.reconciliarGuardado();
      // El guard puede cancelar: conservar los hijos y sus datos hasta salir.
      if (!this.destroyRef.destroyed && this.router.url === rutaAlEnviar
        && await this.router.navigate(['/pozos-detail', id])) this.cargado.set(false);
    }catch(e){this.error.set(this.recargaPendiente() ? 'La edición fue guardada, pero falta actualizar sus datos. Reintentá la actualización antes de volver a guardar. Los cambios posteriores siguen en pantalla.' : e instanceof HttpErrorResponse?e.error?.message||'No se confirmó la edición. Los cambios siguen en el formulario.':String(e));}
    finally{this.ocupado.set(false);}
  }
  async actualizarGuardado() {
    if (this.ocupado() || !this.guardadoPendiente) return;
    this.ocupado.set(true); this.error.set('');
    try { await this.reconciliarGuardado(); }
    catch { this.error.set('La edición ya fue guardada. No se pudo actualizar sus datos; reintentá la actualización.'); }
    finally { this.ocupado.set(false); }
  }
  private async reconciliarGuardado() {
    const pendiente = this.guardadoPendiente;
    if (!pendiente) return;
    const id = Number(this.id_pozo());
    const [p,l,d,f,a] = await Promise.all([this.editor.getPozoById(id),this.litologia.getIntervalosLitologicos(id),this.diametros.getIntervalosDiametros(id),this.filtros.listar(id),this.aportes.getNivelesAporte(id)]);
    if (this.destroyRef.destroyed) return;
    const canonico: EstadoPerforacion = {
      pozo: {...p,id_perforador:p.id_perforador??0,id_sitio:p.id_sitio??0,fecha_inicio:normalizarFechaCalendarioInput(p.fecha_inicio),fecha_fin:normalizarFechaCalendarioInput(p.fecha_fin)},
      sitio: p.sitio ? {...p.sitio,latitud:p.sitio.latitud??'',longitud:p.sitio.longitud??''} : {departamento:'',localidad:'',latitud:'',longitud:''},
      tecnicos: tecnicosPersistidos(l,d,f,a,p.sello_sanitario_constructivo),
    };
    const actual = reconciliarPerforacion(pendiente.enviado, {pozo:this.pozo(),sitio:this.sitio(),tecnicos:this.tecnicos()}, canonico);
    this.tecnicosGuardados = structuredClone(canonico.tecnicos);
    this.pozo.set(actual.pozo); this.sitio.set(actual.sitio);
    this.tecnicos.set(actual.tecnicos); this.inicial.set(actual.tecnicos); this.versionTecnicos.update(v => v + 1);
    const formulario = this.formulario;
    if (formulario && formulario.fotoFile === pendiente.foto
      && formulario.eliminarFotoPendiente() === (pendiente.accion === 'eliminar')) formulario.cancelarCambioFoto();
    if (pendiente.accion !== 'conservar') formulario?.refrescarFotoPersistida();
    this.baseFormulario = huellaFormulario(canonico.pozo, canonico.sitio, canonico.tecnicos, true);
    this.guardadoPendiente = undefined; this.recargaPendiente.set(false);
  }
  async crearPropietario(body:PropietarioOperativoCrearBody){
    if(!this.auth.puedeAdministrarUsuarios()||this.ocupado()||this.envio)return;this.ocupado.set(true);
    try{const enviado={...body},formulario=this.formulario;const p=await this.propietariosService.crear(enviado);formulario?.confirmarPropietarioCreado(enviado);this.propietarios.update(xs=>[p,...xs]);this.pozo.update(x=>({...x,id_propietario:p.id_usuario,propietario_provisional:null}));}
    catch(e){this.error.set(String(e));}finally{this.ocupado.set(false);}
  }
  async actualizarPropietario(event:{id:number;body:PropietarioOperativoActualizarBody}){
    if(!this.auth.puedeAdministrarUsuarios()||this.ocupado()||this.envio)return;this.ocupado.set(true);
    try{const enviado={...event.body},formulario=this.formulario;const p=await this.propietariosService.actualizar(event.id,enviado);formulario?.confirmarPropietarioActualizado(event.id,enviado);this.propietarios.update(xs=>xs.map(x=>x.id_usuario===event.id?{...x,...p}:x));}
    catch(e){this.error.set(String(e));}finally{this.ocupado.set(false);}
  }
}
