import { Component, inject, input, resource, signal } from '@angular/core';
import { AporteEditService } from '../../../../../../shared/services/aportes-service/aporte-edit-service/aporte-edit.service';
import { Router } from '@angular/router';
import { NivelAporteBody } from '../../../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonSpinner, IonButton, IonToolbar, IonButtons, IonBackButton, ToastController } from "@ionic/angular/standalone";
import { AportesFormComponent } from "../components/aportes-form/aportes-form.component";

@Component({
  selector: 'app-aportes-edit',
  imports: [IonContent, IonCard, IonCardContent, AportesFormComponent, IonSpinner, IonButton, IonToolbar, IonButtons, IonBackButton],
  templateUrl: './aportes-edit.page.html',
  styleUrl: './aportes-edit.page.css',
})
export class AportesEditPage {
public nivelAporteService: AporteEditService = inject(AporteEditService);
public toastController = inject(ToastController)
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  public id_nivel_aporte = input.required<number>();

  public nivelResource = resource({
    params: () => ({ idPozo: this.id_pozo(), idNivel: this.id_nivel_aporte() }),
    loader: ({ params }) =>
      this.nivelAporteService.getNivelById(params.idPozo, params.idNivel),
  });

  async handleEdit(nivel: NivelAporteBody) {
    try {
      const id_pozo = this.id_pozo();
      const id_nivel = this.id_nivel_aporte();
      this.disabled.set(true);
      const nivelEdit = await this.nivelAporteService.editNivelAporte(
        id_pozo,
        id_nivel,
        nivel
      );

      console.log('Perforacion editada', nivelEdit);
      this.router.navigate([`pozos/${id_pozo}/aportes-list`]);
    } catch (err: any) {
            const toast = await this.toastController.create({
        message: err.error.message,
        duration: 1000,
        position: 'bottom',
        color: 'danger',
        animated: true

      });
      await toast.present();

    }
    this.disabled.set(false);
  }

   irAtras() {
    this.router.navigate([`pozos/${this.id_pozo()}/aportes-list`]);
  }


}
