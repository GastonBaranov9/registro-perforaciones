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
import { EjeCoordenada, normalizarCoordenadaTexto } from '../../../../shared/utils/coordenadas';
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
    const resultado = pendiente ? { ...this.sitio(), latitud: pendiente.latitud, longitud: pendiente.longitud } : { ...this.sitio() };
    const alguna = Boolean(String(resultado.latitud ?? '').trim() || String(resultado.longitud ?? '').trim());
    if (alguna && (!normalizarCoordenadaTexto(resultado.latitud, 'latitud') || !normalizarCoordenadaTexto(resultado.longitud, 'longitud'))) {
      this.ubicacionError.set('Las coordenadas no son válidas.'); return;
    }
    this.saved.emit(resultado);
  }

  actualizarCoordenada(eje:EjeCoordenada, valor:unknown) {
    const texto=valor == null ? '' : String(valor);
    const pendiente=this.ubicacionPendiente();
    if(pendiente) this.ubicacionPendiente.set({...pendiente,[eje]:texto});
    else this.sitio()[eje]=texto;
  }

  normalizarCoordenada(eje:EjeCoordenada) {
    const objetivo=this.ubicacionPendiente() ?? this.sitio();
    const original=objetivo[eje];
    if(!String(original ?? '').trim()){this.ubicacionError.set('');return;}
    const normalizada=normalizarCoordenadaTexto(original,eje);
    if(!normalizada){this.ubicacionError.set(`La ${eje} no es válida.`);return;}
    this.actualizarCoordenada(eje,normalizada);this.ubicacionError.set('');
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
