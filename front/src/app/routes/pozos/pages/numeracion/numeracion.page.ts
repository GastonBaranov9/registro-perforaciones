import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { EstadoNumeracion, NumeracionPerforacionService, numeroPerforacionValido } from '../../../../shared/services/numeracion-perforacion.service';

@Component({
  imports: [FormsModule, IonContent, IonButton, RouterLink],
  template: '<ion-content class="ion-padding"><ion-button routerLink="/pozo">Volver</ion-button><h1>Numeración de perforaciones</h1><p>Numeración única para toda la empresa. Los números asignados quedan reservados y no se pueden modificar.</p>@if (estado(); as actual) { <p>Próximo número automático: <strong>{{ actual.proximo ?? "Sin configurar" }}</strong></p>@if (actual.agotado) { <p role="alert">Se agotó el rango disponible.</p> } @else { <form (ngSubmit)="guardar()"><label>Próximo número a asignar<input name="proximo" type="number" inputmode="numeric" step="1" [min]="actual.minimo" max="2147483647" [(ngModel)]="proximo" required [disabled]="ocupado()" /></label><p>Mínimo permitido: {{ actual.minimo }}. Los registros históricos anteriores no retroceden el contador.</p><ion-button type="submit" [disabled]="ocupado() || !valido()">Guardar configuración</ion-button></form> } }<ion-button (click)="cargar()" [disabled]="ocupado()">Actualizar información</ion-button>@if (mensaje()) { <p role="status">{{ mensaje() }}</p> }</ion-content>',
  styles: ['label { display: grid; gap: .5rem; max-width: 30rem; } input { width: 100%; min-height: 48px; }'],
})
export class NumeracionPage {
  private readonly servicio = inject(NumeracionPerforacionService);
  readonly estado = signal<EstadoNumeracion | null>(null);
  readonly ocupado = signal(false);
  readonly mensaje = signal('');
  proximo: number | null = null;
  ionViewWillEnter() { return this.cargar(); }
  valido() { return numeroPerforacionValido(this.proximo) && this.proximo >= (this.estado()?.minimo ?? 1); }
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
      this.estado.set(await this.servicio.configurar(this.proximo!, estado.proximo));
      this.mensaje.set('Configuración guardada.');
    } catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.ocupado.set(false); }
  }
}
