import { Component, inject, input, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';
import {
  IntervaloDiametroPerforacion,
  IntervaloDiametroPerforacionBody,
} from '../../../../../../shared/types/schemas';
import { IntervaloDiametroEditService } from '../../../../../../shared/services/intervalo-diametro-service/intervalo-diametro-edit/intervalo-diametro-edit.service';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonButton,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonTitle,
  ToastController,
} from '@ionic/angular/standalone';
import { IntervaloDiamFormComponent } from '../components/intervalo-diam-form.component/intervalo-diam-form.component';

@Component({
  selector: 'app-intervalos-diametros-edit',
  imports: [
    IonContent,
    IonCard,
    IonCardContent,
    IntervaloDiamFormComponent,
    IonSpinner,
    IonButton,
    IonToolbar,
    IonButtons,
    IonBackButton,
  ],
  templateUrl: './intervalos-diametros-edit.page.html',
  styleUrl: './intervalos-diametros-edit.page.css',
})
export class IntervalosDiametrosEditPage {
  public interevaloEditService: IntervaloDiametroEditService = inject(IntervaloDiametroEditService);
  public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  public id_intervalo_diametro = input.required<number>();

  public intervaloResource = resource({
    params: () => ({ idPozo: this.id_pozo(), idIntervalo: this.id_intervalo_diametro() }),
    loader: ({ params }) =>
      this.interevaloEditService.getIntDiamById(params.idPozo, params.idIntervalo),
  });

  async handleEdit(intervalo: IntervaloDiametroPerforacionBody) {
    try {
      const id_pozo = this.id_pozo();
      const id_intervalo_diametro = this.id_intervalo_diametro();
      this.disabled.set(true);
      const intervaloDiamEdit = await this.interevaloEditService.editIntervaloDiam(
        id_pozo,
        id_intervalo_diametro,
        intervalo
      );

      console.log('Perforacion editada', intervaloDiamEdit);
      this.router.navigate([`/pozos/${id_pozo}/intervalos-diametros-list`]);
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
    this.disabled.set(false);
  }
  irAtras() {
    this.router.navigate([`pozos/${this.id_pozo()}/intervalos-diametros-list`]);
  }
}
