import { Component, inject, input, signal } from '@angular/core';
import { IntervaloLitologicoCreateService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-create/intervalo-litologico-create.service';
import { ActivatedRoute, Router } from '@angular/router';
import { IntervaloLitologicoBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonToolbar, IonButtons, IonButton, IonBackButton, ToastController } from '@ionic/angular/standalone';
import { IntervaloLitFormComponent } from '../components/intervalo-lit-form/intervalo-lit-form.component';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';

@Component({
  selector: 'app-intervalos-litologicos-create',
  imports: [IonContent, IonCard, IonCardContent, IntervaloLitFormComponent, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './intervalos-litologicos-create.page.html',
  styleUrl: './intervalos-litologicos-create.page.css',
})
export class IntervalosLitologicosCreatePage {
  public createService: IntervaloLitologicoCreateService = inject(IntervaloLitologicoCreateService);
 public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public activateRoute = inject(ActivatedRoute);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();


  public intervaloLitologico = signal<IntervaloLitologicoBody>({
    desde_m: 0,
    hasta_m: 0,
    material: "",
  });


  async guardarIntervaloLit(body: IntervaloLitologicoBody) {
    const id_pozo = this.id_pozo();
    try {
      this.disabled.set(true);
      const nuevoIntervaloLit = await this.createService.createIntervaloLit(
        id_pozo,
        body
      );
      console.log('Intervalo creado creado: ', nuevoIntervaloLit);
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
