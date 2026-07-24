import { Component, inject, input, OnInit, resource, signal } from '@angular/core';
import { IntervaloDiametroListService } from '../../../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { IntervaloDiametroPerforacion } from '../../../../../../shared/types/schemas';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonCardTitle,
  IonCardHeader,
  IonCard,
  IonContent,
  ViewWillEnter,
  IonToolbar,
  IonButtons,
  IonBackButton,
  ToastController,
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-intervalos-diametros-list',
  imports: [
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonCardTitle,
    IonCardHeader,
    IonCard,
    IonContent,
    IonToolbar,
    IonButtons,
    IonBackButton,
  ],
  templateUrl: './intervalos-diametros-list.page.html',
  styleUrl: './intervalos-diametros-list.page.css',
})
export class IntervalosDiametrosListPage implements OnInit, ViewWillEnter {
  public intervaloDiametroListService = inject(IntervaloDiametroListService);
  public intervalosDiametros = signal<IntervaloDiametroPerforacion[]>([]);
  public toastController = inject(ToastController);
  public ruta = inject(ActivatedRoute);
  public id_pozo = input.required<number>();
  public router = inject(Router);

  ngOnInit() {
    let id = this.id_pozo();
    id = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarNivelesAporte();
  }
  ionViewWillEnter(): void {
    let id = this.id_pozo();
    id = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarNivelesAporte();
  }
  private async cargarNivelesAporte() {
    if (!this.id_pozo) throw new Error('Pozo no encontrado');
    const intervaloDiam = await this.intervaloDiametroListService.getIntervalosDiametros(
      this.id_pozo()
    );
    this.intervalosDiametros.set(intervaloDiam);
    this.ionViewWillEnter();
  }
  public intDiamResource = resource({
    params: () => ({ idPozo: this.id_pozo() }),
    loader: ({ params }) => this.intervaloDiametroListService.getIntervalosDiametros(params.idPozo),
  });

  public async borrarIntervaloDiam(intervaloDiam: IntervaloDiametroPerforacion) {
    try {
      const id_pozo = this.id_pozo();
      if (!id_pozo) throw new Error('Pozo no encontrado');
      await this.intervaloDiametroListService.deleteIntervaloDiametro(id_pozo, intervaloDiam);
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

  irAEditar(intervaloDiam: IntervaloDiametroPerforacion) {
    const id_pozo = this.id_pozo();
    this.router.navigate([
      `/pozos/${id_pozo}/intervalos-diametros-edit/${intervaloDiam.id_intervalo_diametro_perforacion}`,
    ]);
  }

  irACrear() {
    const id_pozo = this.id_pozo();
    this.router.navigate([`/pozos/${id_pozo}/intervalos-diametros-create`]);
  }
  irAtras() {
    this.router.navigate([`/pozos-list`]);
  }
}
