import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NumeracionPerforacionService, numeroPerforacionValido } from '../../services/numeracion-perforacion.service';

@Component({
  selector: 'app-numero-perforacion', imports: [FormsModule],
  template: '<label>Número real de perforación<input type="number" inputmode="numeric" min="1" max="2147483647" step="1" [disabled]="deshabilitado()" [ngModel]="numero()" [ngModelOptions]="{standalone:true}" (ngModelChange)="cambiar($event)" (blur)="consultar()" /></label><p>{{ ayuda() }}</p>@if (mensaje()) { <p role="status" [class.error]="utilizado()">{{ mensaje() }}</p> }',
  styles: [':host { display: block; padding: .75rem; } label { display: grid; gap: .5rem; } input { width: 100%; min-height: 48px; } p { margin: .5rem 0; }'],
})
export class NumeroPerforacionComponent {
  readonly numero = input<number | null | undefined>(null);
  readonly deshabilitado = input(false);
  readonly ayuda = input('Dejar vacío para asignación automática. Complete solo si conoce el número real del registro histórico. Un número igual o superior al próximo automático avanzará el contador.');
  readonly numeroChange = output<number | null>();
  readonly mensaje = signal('');
  readonly utilizado = signal(false);
  private readonly servicio = inject(NumeracionPerforacionService);
  private version = 0;
  cambiar(numero: number | null) {
    this.version++; this.mensaje.set(''); this.utilizado.set(false);
    this.numeroChange.emit(numero);
  }
  async consultar() {
    const numero = this.numero(), version = ++this.version;
    if (numero == null) { this.mensaje.set(''); return; }
    if (!numeroPerforacionValido(numero)) {
      this.utilizado.set(true); this.mensaje.set('Ingrese un entero entre 1 y 2147483647.'); return;
    }
    this.mensaje.set('Comprobando número…');
    try {
      const resultado = await this.servicio.consultar(numero);
      if (version !== this.version || numero !== this.numero()) return;
      this.utilizado.set(resultado.utilizado);
      this.mensaje.set(resultado.utilizado ? 'Este número ya está utilizado o reservado.' : 'Disponible al consultar. Se confirmará al guardar.');
    } catch (error) {
      if (version === this.version) this.mensaje.set(error instanceof Error ? error.message : 'No se pudo comprobar el número.');
    }
  }
}
