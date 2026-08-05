import { Component, inject, input, OnInit, signal } from '@angular/core';
import { IntervaloDiametroCreateService } from '../../../../../../shared/services/intervalo-diametro-service/intervalo-diametro-create/intervalo-diametro-create.service';
import { Router } from '@angular/router';
import { IntervaloDiametroPerforacionBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonToolbar, IonButtons, IonButton, IonBackButton, ToastController } from '@ionic/angular/standalone';
import { IntervaloDiamFormComponent } from '../components/intervalo-diam-form.component/intervalo-diam-form.component';
import { IntervaloDiametroListService } from '../../../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';
import { sugerirInicioSiguienteIntervalo } from '../../../../../../shared/utils/datos-tecnicos-borrador';

@Component({
  selector: 'app-intervalos-diametros-create',
  imports: [IonContent, IonCard, IonCardContent, IntervaloDiamFormComponent, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './intervalos-diametros-create.page.html',
  styleUrl: './intervalos-diametros-create.page.css',
})
export class IntervalosDiametrosCreatePage implements OnInit {
  public createIntDiamService: IntervaloDiametroCreateService = inject(
    IntervaloDiametroCreateService
  );
   public toastController = inject(ToastController);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  private lista = inject(IntervaloDiametroListService);
  private pozos = inject(PozosEditService);

  public intervaloDiametro = signal<IntervaloDiametroPerforacionBody>({
    desde_m: 0,
    hasta_m: 0,
    diametro_pulg: 0,
  });

  async ngOnInit() {
    try {
      const [intervalos, pozo] = await Promise.all([this.lista.getIntervalosDiametros(this.id_pozo()), this.pozos.getPozoById(this.id_pozo())]);
      const sugerencia = sugerirInicioSiguienteIntervalo(intervalos, pozo.profundidad_final_m);
      if (sugerencia.permitido) this.intervaloDiametro.update((actual) => ({ ...actual, desde_m: sugerencia.desde_m }));
      else this.errorMessage.set(sugerencia.mensaje);
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo sugerir la continuidad.'); }
  }

  async guardarIntDiametro(body: IntervaloDiametroPerforacionBody) {
    const id_pozo = this.id_pozo();

    try {
      this.disabled.set(true);
      const nuevoIntervalo = await this.createIntDiamService.createIntervaloDiametro(id_pozo, body);

      console.log('Intervalo diametro creado: ', nuevoIntervalo);
      this.router.navigate([`/pozos/${id_pozo}/intervalos-diametros-list`]);
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
    this.router.navigate([`pozos/${this.id_pozo()}/intervalos-diametros-list`]);
  }
}
