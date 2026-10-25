import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { AdministracionEliminacionesService, VistaEliminacion } from '../../../../shared/services/administracion-eliminaciones.service';
@Component({
  selector:'app-reservas-eliminadas',imports:[FormsModule,IonButton,RouterLink],
  template:`<h2>Administrar números de perforaciones eliminadas</h2>
    <p>Consultá un número individual. Un histórico no cambia el próximo número automático. Nunca liberes un número con documentación vigente.</p>
    <form (ngSubmit)="buscar()"><label>Número<input name="numero" type="number" min="1" max="2147483647" [(ngModel)]="numero" (ngModelChange)="cambiarNumero()" [disabled]="ocupado()" /></label><p>Consultá un número entero mayor que cero. La consulta no modifica información.</p><ion-button type="submit" [disabled]="ocupado()">Consultar</ion-button></form>
    @if(vista(); as v) {
      <p>Número {{v.numero}} · ID original {{v.id_original ?? 'desconocido'}} · Asignado {{v.asignado_en ?? 'sin reserva'}}.</p>
      <p>{{v.existe?'La perforación existe. No se puede liberar su reserva.':v.reservada?'La perforación ya no existe; conserva reserva.':'No existe una reserva comprobable.'}}</p>
      @for(b of v.bloqueos; track b) {<p role="alert">{{b}}</p>}
      @if(!v.existe && v.reservada && v.numero! <= 3281) {
        <p>Reingresar una perforación histórica es una operación distinta de liberar su número: conserva el antecedente y exige revisar sus referencias.</p>
        <ion-button routerLink="/pozos-historicos" [queryParams]="{reingresar:v.numero}" [disabled]="ocupado()">Revisar reingreso histórico</ion-button>
      }
      @if(v.elegible) {
        <p>No se detectaron conflictos internos. Esto NO comprueba referencias externas. Se conservará auditoría permanente de la reserva original.</p>
        <label>Motivo<input [(ngModel)]="motivo" maxlength="1000" [disabled]="ocupado()" /></label>
        <label><input type="checkbox" [(ngModel)]="declaracion" [disabled]="ocupado()" />Declaro que no hay PDFs entregados, documentación vigente, referencias externas ni sincronizaciones pendientes.</label>
        <label>Escribí LIBERAR<input [(ngModel)]="confirmacion" autocomplete="off" [disabled]="ocupado()" /></label>
        <ion-button color="danger" [disabled]="ocupado() || !valido()" (click)="liberar()">Liberar este número</ion-button>
        @if(!valido()&&!ocupado()){<p>Ingresá un motivo de 10 a 1000 caracteres, marcá la declaración y escribí LIBERAR para continuar.</p>}
      }
      <ion-button [disabled]="ocupado()" (click)="cancelar()">Cancelar</ion-button>
    }
    @if(mensaje()) {<p role="status">{{mensaje()}}</p>}`,
  styles:['h2{margin-top:0;font-size:1.4rem} p{line-height:1.6} label{display:grid;gap:.5rem;margin:1.2rem 0;max-width:38rem} input:not([type=checkbox]){width:100%;box-sizing:border-box;min-height:48px;padding:12px;border:1px solid #8295a8;border-radius:8px;background:white;color:#20344b;font:inherit} input[type=checkbox]{width:22px;height:22px} input:focus-visible{outline:3px solid #2875ad;outline-offset:2px}'],
})
export class ReservasEliminadasComponent {
  private servicio=inject(AdministracionEliminacionesService);
  rectificada=output<void>(); vista=signal<VistaEliminacion|null>(null); ocupado=signal(false); mensaje=signal('');
  numero:number|null=null; motivo=''; confirmacion=''; declaracion=false; private generacion=0;
  valido() {return !!this.vista()?.token && this.confirmacion==='LIBERAR' && this.declaracion && this.motivo.trim().length>=10 && this.motivo.trim().length<=1000;}
  cancelar(){this.generacion++;this.vista.set(null);this.motivo='';this.confirmacion='';this.declaracion=false;}
  cambiarNumero(){this.cancelar();this.mensaje.set('');}
  async buscar(){
    if(this.ocupado())return;
    if(!Number.isInteger(this.numero) || this.numero!<1 || this.numero!>2147483647){this.cancelar();this.mensaje.set('Ingresá un número entero entre 1 y 2147483647.');return;}
    this.cancelar();const turno=this.generacion;this.ocupado.set(true);this.mensaje.set('');
    try{const v=await this.servicio.consultar(this.numero!);if(turno===this.generacion)this.vista.set(v);}
    catch(e:any){this.mensaje.set(e?.error?.message??'No se pudo comprobar la reserva.');}
    finally{this.ocupado.set(false);}
  }
  async liberar(){
    if(this.ocupado() || !this.valido())return;
    const v=this.vista()!;this.ocupado.set(true);
    try{const r=await this.servicio.liberar(v.numero!,{token:v.token!,confirmacion:this.confirmacion,motivo:this.motivo.trim(),sin_referencias_externas:this.declaracion});this.cancelar();this.mensaje.set('Reserva rectificada. Próximo automático: '+r.proximo+'.');this.rectificada.emit();}
    catch(e:any){this.cancelar();this.mensaje.set(e?.error?.message??'No se pudo confirmar la rectificación. Consultá el número antes de reintentar.');}
    finally{this.ocupado.set(false);}
  }
}
