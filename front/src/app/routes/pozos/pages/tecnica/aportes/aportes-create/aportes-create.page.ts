import { Component, inject, input, signal } from '@angular/core';
import { IonContent, IonCard, IonCardContent, IonToolbar, IonButtons, IonButton, IonBackButton } from "@ionic/angular/standalone";
import { AporteCreateService } from '../../../../../../shared/services/aportes-service/aporte-create-service/aporte-create.service';
import { ActivatedRoute, Router } from '@angular/router';
import { NivelAporteBody } from '../../../../../../shared/types/schemas';
import { AportesFormComponent } from "../components/aportes-form/aportes-form.component";
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-aportes-create',
  imports: [IonContent, IonCard, IonCardContent, AportesFormComponent, IonToolbar, IonBackButton, IonButtons],
  templateUrl: './aportes-create.page.html',
  styleUrl: './aportes-create.page.css',
})
export class AportesCreatePage {
  public aporteCreateService: AporteCreateService= inject(AporteCreateService);
public toastController = inject(ToastController)
  public router: Router = inject(Router);
  public activateRoute = inject(ActivatedRoute);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();


  public nivelAp = signal<NivelAporteBody>({
    profundidad_m: 0,
  });


  async guardarIntervaloLit(body: NivelAporteBody) {
    const id_pozo = this.id_pozo();
    try {
      this.disabled.set(true);
      const nuevoNivelAporte = await this.aporteCreateService.createNivelAporte(
        id_pozo,
        body
      );
      console.log('Nivel aporte creado: ', nuevoNivelAporte);
      this.router.navigate([`/pozos/${id_pozo}/aportes-list`]);
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
