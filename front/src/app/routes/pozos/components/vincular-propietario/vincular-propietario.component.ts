import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CandidatoPozo } from '../../../../shared/types/schemas';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { SelectorPersonaPozoComponent } from '../selector-persona-pozo/selector-persona-pozo.component';
import { mensajeHumano } from '../../../../shared/utils/errores';

@Component({
  selector: 'app-vincular-propietario',
  imports: [FormsModule, SelectorPersonaPozoComponent],
  template: `<section aria-label="Vincular propietario">
    <h3>Vincular propietario real</h3>
    <p>Seleccione una identidad verificada. La vinculación conserva los demás datos y los cambios del formulario.</p>
    <app-selector-persona-pozo etiqueta="Propietario real" [candidatos]="candidatos()" [buscarRemoto]="buscar"
      [(seleccionado)]="seleccionado" (personaSeleccionada)="persona.set($event)" [deshabilitado]="ocupado() || deshabilitado()" />
    <button type="button" (click)="vincular()" [disabled]="!persona() || ocupado() || deshabilitado()">Vincular propietario seleccionado</button>
    <details><summary>Crear un propietario real verificado</summary>
      <label>Nombre y apellido <input [(ngModel)]="nombre" maxlength="160" [disabled]="ocupado() || deshabilitado()" /></label>
      <label>Documento / RUT <input [(ngModel)]="documento" maxlength="80" [disabled]="ocupado() || deshabilitado()" /></label>
      <label>Teléfono <input [(ngModel)]="telefono" maxlength="80" [disabled]="ocupado() || deshabilitado()" /></label>
      <button type="button" (click)="crear()" [disabled]="!nombre.trim() || ocupado() || deshabilitado()">Crear propietario real</button>
      <p>Se creará un registro administrado sin credenciales. Después podrá vincularlo al pozo.</p>
    </details>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
  </section>`,
  styles: ['section { padding: 1rem; border: 1px solid var(--ion-color-medium); margin-block: 1rem; } label { display: block; margin-block: .75rem; } input { width: 100%; min-height: 44px; } button { min-height: 44px; margin-block: .5rem; }'],
})
export class VincularPropietarioComponent {
  idPozo = input.required<number>();
  propietarioActual = input.required<number | null>();
  deshabilitado = input(false);
  vinculado = output<CandidatoPozo>();
  ocupacion = output<boolean>();
  private servicio = inject(PropietariosOperativosService);
  private busquedas = inject(CandidatosPozoService);
  buscar = (q: string) => this.busquedas.buscar('propietario', q);
  seleccionado: number | null = null;
  persona = signal<CandidatoPozo | null>(null);
  candidatos = signal<CandidatoPozo[]>([]);
  ocupado = signal(false);
  error = signal('');
  mensaje = signal('');
  nombre = ''; documento = ''; telefono = '';
  private ocupada(valor: boolean) { this.ocupado.set(valor); this.ocupacion.emit(valor); }
  async crear() {
    if (this.ocupado() || this.deshabilitado() || !this.nombre.trim()) return;
    this.ocupada(true); this.error.set(''); this.mensaje.set('');
    try {
      const persona = await this.servicio.crear({ nombre: this.nombre.trim(), documento_rut: this.documento, telefono: this.telefono });
      this.candidatos.set([persona]); this.persona.set(persona); this.seleccionado = persona.id_usuario;
      this.nombre = ''; this.documento = ''; this.telefono = '';
      this.mensaje.set('Propietario creado y seleccionado. Vincúlelo para completar la operación.');
    } catch (error) { this.error.set(mensajeHumano(error, 'No se pudo crear el propietario.')); }
    finally { this.ocupada(false); }
  }
  async vincular() {
    const persona = this.persona();
    if (!persona || this.ocupado() || this.deshabilitado()) return;
    this.ocupada(true); this.error.set(''); this.mensaje.set('');
    try {
      await this.servicio.vincular(this.idPozo(), persona.id_usuario, this.propietarioActual());
      this.vinculado.emit(persona); this.mensaje.set('Propietario vinculado.');
    } catch (error) { this.error.set(mensajeHumano(error, 'No se pudo vincular el propietario.')); }
    finally { this.ocupada(false); }
  }
}
