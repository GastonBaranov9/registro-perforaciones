import { Component, input, output, signal } from '@angular/core';
import { SitioBody } from '../../../../shared/types/schemas';
import {
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { capturarUbicacionActual, UbicacionCapturada } from '../../../../shared/utils/geolocalizacion';
@Component({
  selector: 'app-sitios-form',
  templateUrl: './sitios-form.component.html',
  styleUrls: ['./sitios-form.component.scss'],
  imports: [FormsModule, DecimalPipe, IonList, IonItem, IonLabel, IonInput, IonButton],
})
export class SitiosFormComponent {
  public sitio = input.required<SitioBody>();
  public saved = output<SitioBody>();
  public cargandoUbicacion = signal(false);
  public ubicacionPendiente = signal<UbicacionCapturada | null>(null);
  public ubicacionError = signal('');

  handleSitio() {
    const pendiente = this.ubicacionPendiente();
    this.saved.emit(pendiente ? { ...this.sitio(), latitud: pendiente.latitud, longitud: pendiente.longitud } : { ...this.sitio() });
  }

  public async getLocation(): Promise<void> {
    try {
      this.cargandoUbicacion.set(true); this.ubicacionError.set('');
      this.ubicacionPendiente.set(await capturarUbicacionActual());
    } catch (error: unknown) {
      this.ubicacionError.set(error instanceof Error ? error.message : 'No fue posible obtener la ubicación.');
    } finally {
      this.cargandoUbicacion.set(false);
    }
  }
  cancelarUbicacion() { this.ubicacionPendiente.set(null); this.ubicacionError.set(''); }
}
