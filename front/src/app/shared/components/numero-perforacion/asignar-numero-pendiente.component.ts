import { Component, inject, input, output, signal } from '@angular/core';
import { NumeroPerforacionComponent } from './numero-perforacion.component';
import { NumeracionPerforacionService, numeroPerforacionValido } from '../../services/numeracion-perforacion.service';

@Component({
  selector: 'app-asignar-numero-pendiente', imports: [NumeroPerforacionComponent],
  template: '<section><h3>Identificar perforación del piloto</h3><app-numero-perforacion [numero]="numero" (numeroChange)="numero=$event" [deshabilitado]="guardando()" ayuda="Ingrese el número real confirmado. Una vez asignado no se podrá cambiar." /><button type="button" (click)="asignar()" [disabled]="guardando() || !valido()">Asignar número real</button>@if (mensaje()) { <p role="alert">{{ mensaje() }}</p> }</section>',
  styles: ['section { padding: .75rem; } button { min-height: 48px; }'],
})
export class AsignarNumeroPendienteComponent {
  readonly idPozo = input.required<number>();
  readonly asignado = output<number>();
  readonly guardando = signal(false);
  readonly mensaje = signal('');
  numero: number | null = null;
  private readonly servicio = inject(NumeracionPerforacionService);
  valido() { return numeroPerforacionValido(this.numero); }
  async asignar() {
    if (!this.valido() || this.guardando()) return;
    this.guardando.set(true); this.mensaje.set('');
    try { const resultado = await this.servicio.asignarPendiente(this.idPozo(), this.numero!); this.asignado.emit(resultado.numero_perforacion); }
    catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.guardando.set(false); }
  }
}
