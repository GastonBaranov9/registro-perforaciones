import { Component, inject, input, resource, signal } from '@angular/core';
import { IntervaloLitologicoEditService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-edit/intervalo-litologico-edit.service';
import { Router } from '@angular/router';
import { IntervaloLitologicoBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonSpinner, IonButton, IonToolbar, IonButtons, IonBackButton, ToastController } from '@ionic/angular/standalone';
import { IntervaloLitFormComponent } from '../components/intervalo-lit-form/intervalo-lit-form.component';

@Component({
  selector: 'app-intervalos-litologicos-edit',
  imports: [IonContent, IonCard, IonCardContent, IntervaloLitFormComponent, IonSpinner, IonButton, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './intervalos-litologicos-edit.page.html',
  styleUrl: './intervalos-litologicos-edit.page.css',
})
export class IntervalosLitologicosEditPage {
  public interevaloEditLito: IntervaloLitologicoEditService = inject(
    IntervaloLitologicoEditService
  );
   public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  public id_intervalo_litologico = input.required<number>();

  public intervaloResource = resource({
    params: () => ({ idPozo: this.id_pozo(), idIntervalo: this.id_intervalo_litologico() }),
    loader: ({ params }) => this.interevaloEditLito.getIntLito(params.idPozo, params.idIntervalo),
  });

  async handleEdit(intervalo: IntervaloLitologicoBody) {
    try {
      const id_pozo = this.id_pozo();
      const id_intervalo_litologico = this.id_intervalo_litologico();
      this.disabled.set(true);
      const intervaloLitoEdit = await this.interevaloEditLito.editIntervaloLito(
        id_pozo,
        id_intervalo_litologico,
        intervalo
      );

      console.log('Intervalo editado', intervaloLitoEdit);
       this.router.navigate([`/pozos/${id_pozo}/intervalos-litologicos-list`]);
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
    this.router.navigate([`pozos/${this.id_pozo()}/intervalos-litologicos-list`]);
  }
}
