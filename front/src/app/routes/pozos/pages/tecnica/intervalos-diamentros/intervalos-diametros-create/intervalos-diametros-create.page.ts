import { Component, inject, input, signal } from '@angular/core';
import { IntervaloDiametroCreateService } from '../../../../../../shared/services/intervalo-diametro-service/intervalo-diametro-create/intervalo-diametro-create.service';
import { Router } from '@angular/router';
import { IntervaloDiametroPerforacionBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonToolbar, IonButtons, IonButton, IonBackButton, ToastController } from '@ionic/angular/standalone';
import { IntervaloDiamFormComponent } from '../components/intervalo-diam-form.component/intervalo-diam-form.component';

@Component({
  selector: 'app-intervalos-diametros-create',
  imports: [IonContent, IonCard, IonCardContent, IntervaloDiamFormComponent, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './intervalos-diametros-create.page.html',
  styleUrl: './intervalos-diametros-create.page.css',
})
export class IntervalosDiametrosCreatePage {
  public createIntDiamService: IntervaloDiametroCreateService = inject(
    IntervaloDiametroCreateService
  );
   public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();

  public intervaloDiametro = signal<IntervaloDiametroPerforacionBody>({
    desde_m: 0,
    hasta_m: 0,
    diametro_pulg: 0,
  });

  async guardarIntDiametro(body: IntervaloDiametroPerforacionBody) {
    const id_pozo = this.id_pozo();

    try {
      this.disabled.set(true);
      const nuevoIntervalo = await this.createIntDiamService.createIntervaloDiametro(id_pozo, body);

      console.log('Intervalo diametro creado: ', nuevoIntervalo);
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
