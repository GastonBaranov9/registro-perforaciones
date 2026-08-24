import { Component, inject, input, resource } from '@angular/core';
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonItem, IonLabel, IonList } from '@ionic/angular/standalone';
import { SitiosListService } from '../../../../shared/services/sitios-list.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { MapaAereoComponent } from '../../../../shared/components/mapa-aereo/mapa-aereo.component';

@Component({
  selector: 'app-sitio-detail',
  imports: [IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonItem, IonLabel, IonList, MapaAereoComponent],
  templateUrl: './sitio-detail.page.html',
  styleUrl: './sitio-detail.page.css',
})
export class SitioDetailPage {
  id_sitio = input.required<number>();
  private sitios = inject(SitiosListService);
  auth = inject(AuthService);
  sitio = resource({ params: () => ({ id: this.id_sitio() }), loader: ({ params }) => this.sitios.getSitioById(params.id) });
}
