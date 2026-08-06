import { Component, inject, input, OnInit, signal } from '@angular/core';
import { IntervaloLitologicoCreateService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-create/intervalo-litologico-create.service';
import { ActivatedRoute, Router } from '@angular/router';
import { IntervaloLitologicoBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonToolbar, IonButtons, IonButton, IonBackButton, ToastController } from '@ionic/angular/standalone';
import { IntervaloLitFormComponent } from '../components/intervalo-lit-form/intervalo-lit-form.component';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';
import { IntervaloLitologicoListService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { sugerirInicioSiguienteIntervalo } from '../../../../../../shared/utils/datos-tecnicos-borrador';

@Component({
  selector: 'app-intervalos-litologicos-create',
  imports: [IonContent, IonCard, IonCardContent, IntervaloLitFormComponent, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './intervalos-litologicos-create.page.html',
  styleUrl: './intervalos-litologicos-create.page.css',
})
export class IntervalosLitologicosCreatePage implements OnInit {
  public createService: IntervaloLitologicoCreateService = inject(IntervaloLitologicoCreateService);
 public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public activateRoute = inject(ActivatedRoute);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  private lista = inject(IntervaloLitologicoListService);
  private pozos = inject(PozosEditService);


  public intervaloLitologico = signal<IntervaloLitologicoBody>({
    desde_m: 0,
    hasta_m: 0,
    material: "",
  });

  async ngOnInit() {
    try {
      const [intervalos, pozo] = await Promise.all([this.lista.getIntervalosLitologicos(this.id_pozo()), this.pozos.getPozoById(this.id_pozo())]);
      const sugerencia = sugerirInicioSiguienteIntervalo(intervalos, pozo.profundidad_final_m);
      if (sugerencia.permitido) this.intervaloLitologico.update((actual) => ({ ...actual, desde_m: sugerencia.desde_m }));
      else this.errorMessage.set(sugerencia.mensaje);
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo sugerir la continuidad.'); }
  }


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
    } catch (error: unknown) {
      const respuesta = error as { error?: { message?: string }; message?: string };
      const toast = await this.toastController.create({
        message: respuesta.error?.message ?? respuesta.message ?? 'No se pudo crear el intervalo.',
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
