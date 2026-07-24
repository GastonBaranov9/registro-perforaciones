import { Component, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { EstiloPaginas } from '../../../../components/estilo-paginas/estilo-paginas';
import { MainStore } from '../../../shared/services/mainstore-service/main.store';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sitio',
  templateUrl: './sitio.page.html',
  styleUrls: ['./sitio.page.css'],
  imports: [IonContent, EstiloPaginas],
})
export class SitioPage {
public mainStore = inject(MainStore)
public user = this.mainStore.user()
public router = inject(Router)

crearSitio() {
  this.router.navigate(
    ['/sitios-create', this.user?.id_usuario],
    { state: { returnTo: '/sitios-list' } }
  );
}
}
