import { Component, inject, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { EstadoNumeracion, NumeracionPerforacionService, numeroPerforacionValido, RevisionContador, EventoNumeracion } from '../../../../shared/services/numeracion-perforacion.service';
import { ReingresoHistoricoService, VistaReingreso } from '../../../../shared/services/reingreso-historico.service';
import { ReservasEliminadasComponent } from './reservas-eliminadas.component';
import { RectificacionNumeracionComponent } from './rectificacion-numeracion.component';

@Component({
 imports:[FormsModule,DatePipe,IonContent,IonButton,RouterLink,ReservasEliminadasComponent,RectificacionNumeracionComponent],
 templateUrl:'./numeracion.page.html',styleUrl:'./numeracion.page.scss',
})
export class NumeracionPage {
 @ViewChild(ReservasEliminadasComponent) rectificacion?:ReservasEliminadasComponent;
 @ViewChild(RectificacionNumeracionComponent) excepcional?:RectificacionNumeracionComponent;
 private servicio=inject(NumeracionPerforacionService);private reingresos=inject(ReingresoHistoricoService);
 readonly secciones=[{id:'contador',titulo:'Próximo automático',ayuda:'Elegir y corregir'},{id:'pruebas',titulo:'Rectificar pruebas',ayuda:'Reservas finales'},{id:'reservas',titulo:'Números reservados',ayuda:'Consultar y revisar'},{id:'reingreso',titulo:'Volver a ingresar',ayuda:'Históricos eliminados'},{id:'historial',titulo:'Historial de cambios',ayuda:'Sólo consulta'}];
 seccion=signal('contador');estado=signal<EstadoNumeracion|null>(null);ocupado=signal(false);mensaje=signal('');error=signal('');
 revision=signal<RevisionContador|null>(null);eventos=signal<EventoNumeracion[]>([]);masHistorial=signal(false);
 proximo:number|null=null;motivo='';confirmacion='';declaracion=false;numeroHistorico:number|null=null;historico=signal<VistaReingreso|null>(null);
 private turno=0;
 trabajando(){return this.ocupado()||!!this.rectificacion?.ocupado()||!!this.excepcional?.ocupado();}
 ionViewWillEnter(){return this.cargar();}
 ionViewWillLeave(){this.turno++;this.cancelar();this.rectificacion?.cancelar();this.excepcional?.cancelar();}
 limpiar(){this.mensaje.set('');this.error.set('');}
 cambiar(){this.turno++;this.revision.set(null);this.confirmacion='';this.declaracion=false;this.limpiar();}
 cancelar(){this.cambiar();}
 async seleccionar(id:string){if(this.trabajando())return;this.cancelar();this.rectificacion?.cancelar();this.excepcional?.cancelar();this.seccion.set(id);this.historico.set(null);if(id==='historial')await this.cargarHistorial();}
 impedimento(){
  if(!this.estado())return 'Actualizá la información para consultar el contador.';
  if(!numeroPerforacionValido(this.proximo)||this.proximo<3282)return 'Ingresá un número entero entre 3282 y 2147483647. Los anteriores se gestionan como históricos.';
  if(this.proximo===this.estado()!.proximo)return 'No realizaste ningún cambio.';
  if(this.estado()!.proximo!==null&&this.proximo<this.estado()!.proximo!&&!this.estado()!.puede_retroceder)return 'Para retroceder necesitás autorización especial de numeración.';
  if(this.motivo.trim().length<10)return 'Ingresá un motivo de al menos 10 caracteres.';
  if(this.motivo.trim().length>1000)return 'El motivo puede tener hasta 1000 caracteres.';
  return '';
 }
 valido(){return !this.impedimento();}
 async cargar(){if(this.ocupado())return;this.cancelar();this.ocupado.set(true);const t=++this.turno;try{const e=await this.servicio.obtener();if(t===this.turno){this.estado.set(e);this.proximo=e.proximo;}}catch(e){if(t===this.turno)this.error.set((e as Error).message);}finally{this.ocupado.set(false);}}
 async revisar(){if(this.ocupado()||!this.valido())return;this.cambiar();const t=++this.turno;this.ocupado.set(true);try{const r=await this.servicio.revisar(this.proximo!,this.motivo.trim());if(t===this.turno)this.revision.set(r);}catch(e){if(t===this.turno)this.error.set((e as Error).message);}finally{this.ocupado.set(false);}}
 puedeGuardar(){const r=this.revision();return !this.ocupado()&&!!r?.token&&r.nuevo===this.proximo&&r.motivo===this.motivo.trim()&&this.declaracion&&this.confirmacion===`CONFIRMAR ${r.nuevo}`;}
 async guardar(){if(!this.puedeGuardar())return;const r=this.revision()!;this.ocupado.set(true);this.limpiar();try{const e=await this.servicio.configurar(r.nuevo,r.anterior,r.motivo,{token:r.token!,confirmacion:this.confirmacion,registros_fisicos_confirmados:this.declaracion});this.estado.set(e);this.proximo=e.proximo;this.motivo='';this.mensaje.set('La configuración se guardó correctamente.');}catch(e){this.error.set((e as Error).message);}finally{this.revision.set(null);this.confirmacion='';this.declaracion=false;this.ocupado.set(false);}}
 async cargarHistorial(mas=false){if(this.ocupado())return;this.limpiar();this.ocupado.set(true);const t=++this.turno;try{const e=await this.servicio.historial(mas?this.eventos().at(-1)?.id:undefined);if(t===this.turno){this.eventos.set(mas?[...this.eventos(),...e]:e);this.masHistorial.set(e.length===30);}}catch(e){if(t===this.turno)this.error.set((e as Error).message);}finally{this.ocupado.set(false);}}
 cambiarHistorico(){this.turno++;this.historico.set(null);this.limpiar();}
 async consultarHistorico(){if(this.ocupado())return;this.cambiarHistorico();if(!numeroPerforacionValido(this.numeroHistorico)||this.numeroHistorico>3281){this.error.set('Ingresá un número histórico entre 1 y 3281.');return;}this.ocupado.set(true);const t=++this.turno;try{const v=await this.reingresos.consultar(this.numeroHistorico);if(t===this.turno)this.historico.set(v);}catch(e){if(t===this.turno)this.error.set((e as {error?:{message?:string};message?:string}).error?.message??(e as Error).message);}finally{this.ocupado.set(false);}}
}
