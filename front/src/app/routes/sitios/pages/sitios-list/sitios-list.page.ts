import { PermisosSitioService } from '../../../../shared/services/permisos-sitio.service';
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
  } from '@ionic/angular/standalone';
import { ToastController } from '@ionic/angular';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
@Component({
  providers: [PermisosSitioService],
  selector: 'app-sitios-list',
  imports: [
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    ],
  templateUrl: './sitios-list.page.html',
  styleUrl: './sitios-list.page.css',
})
export class SitiosListPage implements OnInit, ViewWillEnter {
  readonly permisosSitio = inject(PermisosSitioService);
  public sitioListService = inject(SitiosListService);
  public toastController = inject(ToastController);
  private router = inject(Router);
  public sitios = signal<Sitio[]>([]);
  public authService = inject(AuthService);

  async ngOnInit() {
    const sitios = await this.sitioListService.getAllSitios();
    this.sitios.set(sitios);
  }

  async ionViewWillEnter() {
    this.permisosSitio.recargar();
    const sitios = await this.sitioListService.getAllSitios();
    this.sitios.set(sitios);
  }

  irAEditar(sitio: Sitio) {
    if (!this.permisosSitio.puedeEditar(sitio.id_sitio)) return;
    this.router.navigate(['/sitios-edit', sitio.id_sitio]);
  }
  irADetalle(sitio: Sitio) { this.router.navigate(['/sitio-detail', sitio.id_sitio]); }

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
