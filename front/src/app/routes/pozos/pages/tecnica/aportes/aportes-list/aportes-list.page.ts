import { Component, inject, input, OnInit, signal } from '@angular/core';
import { AporteListService } from '../../../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { NivelAporte } from '../../../../../../shared/types/schemas';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController, ViewWillEnter } from '@ionic/angular';
import {
  IonContent,
  IonButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButtons,
  IonToolbar,
  IonBackButton,
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-aportes-list',
  imports: [
    IonContent,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButtons,
    IonToolbar,
    IonBackButton,
  ],
  templateUrl: './aportes-list.page.html',
  styleUrl: './aportes-list.page.css',
})
export class AportesListPage implements OnInit, ViewWillEnter {
  public aporteListService = inject(AporteListService);
  public toastController = inject(ToastController);
  public ruta = inject(ActivatedRoute);
  public nivelesAporte = signal<NivelAporte[]>([]);
  public id_pozo: number | null = null;
  public router = inject(Router);

  ngOnInit() {
    this.id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarNivelesAporte();
  }
  ionViewWillEnter(): void {
    this.id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
    this.cargarNivelesAporte();
  }
  private async cargarNivelesAporte() {
    if (!this.id_pozo) throw new Error('Pozo no encontrado');
    const nivelAporte = await this.aporteListService.getNivelesAporte(this.id_pozo);
    this.nivelesAporte.set(nivelAporte);
    this.ionViewWillEnter();
  }
  public async borrarNivelAporte(nivelAporte: NivelAporte) {
    try {
      if (!this.id_pozo) throw new Error('Pozo no encontrado');
      await this.aporteListService.deleteNivelAporte(this.id_pozo, nivelAporte);
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

  irAEditar(nivelAporte: NivelAporte) {
    console.log(nivelAporte, nivelAporte.id_nivel_aporte);
    this.router.navigate([`/pozos/${this.id_pozo}/aportes-edit/${nivelAporte.id_nivel_aporte}`]);
  }

  irACrear() {
    this.router.navigate([`/pozos/${this.id_pozo}/aportes-create`]);
  }
  irAtras() {
    this.router.navigate([`/pozos-list`]);
  }
}
