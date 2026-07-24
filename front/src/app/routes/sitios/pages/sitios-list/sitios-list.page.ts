import { Component, inject, OnInit, signal } from '@angular/core';
import { SitiosListService } from '../../../../shared/services/sitios-list.service';
import { Router } from '@angular/router';
import { single } from 'rxjs';
import { Sitio } from '../../../../shared/types/schemas';
import {
  ViewWillEnter,
  IonGrid,
  IonRow,
  IonCol,
  IonButton,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
} from '@ionic/angular/standalone';
import { ToastController } from '@ionic/angular';
@Component({
  selector: 'app-sitios-list',
  imports: [
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
  ],
  templateUrl: './sitios-list.page.html',
  styleUrl: './sitios-list.page.css',
})
export class SitiosListPage implements OnInit, ViewWillEnter {
  public sitioListService = inject(SitiosListService);
  public toastController = inject(ToastController);
  private router = inject(Router);
  public sitios = signal<Sitio[]>([]);

  async ngOnInit() {
    const sitios = await this.sitioListService.getAllSitios();
    this.sitios.set(sitios);
  }

  async ionViewWillEnter() {
    const sitios = await this.sitioListService.getAllSitios();
    this.sitios.set(sitios);
  }

  irAEditar(sitio: Sitio) {
    this.router.navigate(['/sitios-edit', sitio.id_sitio]);
  }

  public async borrarSitio(sitio: Sitio) {
    try {
      await this.sitioListService.deleteSitio(sitio.id_sitio);
      this.ionViewWillEnter();
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: err.error.message,
        duration: 1000,
        position: 'bottom',
        color: 'danger',
        animated: true,
      });

      await toast.present();
    }
  }
}
