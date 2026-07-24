import { Component, input, OnInit, output } from '@angular/core';
import { SitioBody } from '../../../../shared/types/schemas';
import {
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { Geolocation } from '@capacitor/geolocation';
import { throwError } from 'rxjs';
@Component({
  selector: 'app-sitios-form',
  templateUrl: './sitios-form.component.html',
  styleUrls: ['./sitios-form.component.scss'],
  imports: [FormsModule, IonList, IonItem, IonLabel, IonInput, IonButton],
})
export class SitiosFormComponent implements OnInit {
  public sitio = input.required<SitioBody>();
  public saved = output<SitioBody>();
  public cargandoUbicacion = true;

  handleSitio() {
    this.saved.emit(this.sitio());
  }

  async ngOnInit(): Promise<void> {
    await this.getLocation();
  }

  public async getLocation(): Promise<void> {
    try {
      let currentLocation = await Geolocation.getCurrentPosition();
      console.log(currentLocation.coords.latitude);
      this.sitio().latitud = JSON.stringify(currentLocation.coords.latitude);
      console.log(currentLocation.coords.longitude);
      this.sitio().longitud = JSON.stringify(currentLocation.coords.longitude);
    } catch (e) {
      throw e;
    } finally {
      this.cargandoUbicacion = false;
    }
  }
}
