import { Component, inject, OnInit, signal } from '@angular/core';
import { IntervaloLitologicoListService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { ActivatedRoute, Router } from '@angular/router';
import { IntervaloLitologico } from '../../../../../../shared/types/schemas';
import { ToastController, ViewWillEnter } from '@ionic/angular';
import {
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonButtons,
  IonToolbar,
  IonBackButton,
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-intervalos-litologicos-list',
  imports: [
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonButtons,
    IonToolbar,
    IonBackButton,
  ],
  templateUrl: './intervalos-litologicos-list.page.html',
  styleUrl: './intervalos-litologicos-list.page.css',
})
export class IntervalosLitologicosListPage implements OnInit, ViewWillEnter {
  public intervaloLitologicoListService = inject(IntervaloLitologicoListService);
  public toastController = inject(ToastController);
  public ruta = inject(ActivatedRoute);
  public intervalosLitologicos = signal<IntervaloLitologico[]>([]);
  public id_pozo: number | null = null;
  public router = inject(Router);

  ngOnInit() {
    this.id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarIntervalosLitologicos();
  }
  ionViewWillEnter(): void {
    this.id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarIntervalosLitologicos();
  }
  private async cargarIntervalosLitologicos() {
    if (!this.id_pozo) throw new Error('Pozo no encontrado');
    const intervaloLit = await this.intervaloLitologicoListService.getIntervalosLitologicos(
      this.id_pozo
    );
    this.intervalosLitologicos.set(intervaloLit);
  }

  public async borrarIntervaloLit(intervaloLit: IntervaloLitologico) {
    try {
      if (!this.id_pozo) throw new Error('Pozo no encontrado');

      await this.intervaloLitologicoListService.deleteIntervaloLitologico(
        this.id_pozo,
        intervaloLit
      );
      await this.ionViewWillEnter();
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

  irAEditar(id_pozo: number, intervalolit: IntervaloLitologico) {
    this.router.navigate([
      `pozos/${id_pozo}/intervalos-litologicos-edit/${intervalolit.id_intervalo_litologico}`,
    ]);
  }
  irAIntervaloLit() {
    this.router.navigate([`/pozos/${this.id_pozo}/intervalos-litologicos-create`]);
  }
  irAtras() {
    this.router.navigate([`/pozos-list`]);
  }
}
