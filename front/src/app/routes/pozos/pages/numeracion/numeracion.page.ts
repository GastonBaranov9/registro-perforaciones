import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { EstadoNumeracion, NumeracionPerforacionService, numeroPerforacionValido } from '../../../../shared/services/numeracion-perforacion.service';
import { ReservasEliminadasComponent } from './reservas-eliminadas.component';
import { RectificacionNumeracionComponent } from './rectificacion-numeracion.component';
import { ViewChild } from '@angular/core';

@Component({
  imports: [FormsModule, IonContent, IonButton, RouterLink, ReservasEliminadasComponent, RectificacionNumeracionComponent],
  template: '<ion-content class="ion-padding"><ion-button routerLink="/pozo">Volver</ion-button><h1>Numeración de perforaciones</h1><p>Numeración única para toda la empresa. Los números asignados quedan reservados; la eliminación normal no los libera.</p>@if (estado(); as actual) { <p>Próximo número automático: <strong>{{ actual.proximo ?? "Sin configurar" }}</strong></p>@if (actual.agotado) { <p role="alert">Se agotó el rango disponible.</p> } @else { <h2>Configurar próximo número automático</h2><form (ngSubmit)="guardar()"><p>Valor anterior: {{ actual.proximo }} → nuevo: {{ proximo }}</p><label>Motivo del cambio<textarea name="motivo" [(ngModel)]="motivo" minlength="10" maxlength="1000" required [disabled]="ocupado()"></textarea></label><label>Próximo número a asignar<input name="proximo" type="number" inputmode="numeric" step="1" [min]="actual.minimo" max="2147483647" [(ngModel)]="proximo" required [disabled]="ocupado()" /></label><p>Mínimo permitido: {{ actual.minimo }}. Los registros históricos anteriores no retroceden el contador.</p><ion-button type="submit" [disabled]="ocupado() || !valido()">Guardar configuración</ion-button></form> } }<ion-button (click)="cargar()" [disabled]="ocupado()">Actualizar información</ion-button>@if (mensaje()) { <p role="status">{{ mensaje() }}</p> }<app-rectificacion-numeracion (rectificada)="cargar()" /><app-reservas-eliminadas (rectificada)="cargar()" /></ion-content>',
  styles: ['label { display: grid; gap: .5rem; max-width: 30rem; } input { width: 100%; min-height: 48px; }'],
})
export class NumeracionPage {
  @ViewChild(ReservasEliminadasComponent) rectificacion?: ReservasEliminadasComponent;
  @ViewChild(RectificacionNumeracionComponent) excepcional?: RectificacionNumeracionComponent;
  ionViewWillLeave() { this.rectificacion?.cancelar(); this.excepcional?.cancelar(); }
  private readonly servicio = inject(NumeracionPerforacionService);
  readonly estado = signal<EstadoNumeracion | null>(null);
  readonly ocupado = signal(false);
  readonly mensaje = signal('');
  proximo: number | null = null;
  motivo = "";
  ionViewWillEnter() { return this.cargar(); }
  valido() { return this.motivo.trim().length>=10 && this.motivo.trim().length<=1000 && numeroPerforacionValido(this.proximo) && this.proximo >= (this.estado()?.minimo ?? 1); }
  async cargar() {
    if (this.ocupado()) return;
    this.ocupado.set(true); this.mensaje.set('');
    try { const estado = await this.servicio.obtener(); this.estado.set(estado); this.proximo = estado.proximo; }
    catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.ocupado.set(false); }
  }
  async guardar() {
    const estado = this.estado();
    if (!estado || !this.valido() || this.ocupado()) return;
    this.ocupado.set(true); this.mensaje.set('');
    try {
      this.estado.set(await this.servicio.configurar(this.proximo!, estado.proximo,this.motivo.trim()));
      this.mensaje.set('Configuración guardada.');
    } catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.ocupado.set(false); }
  }
}
