import { Component, inject, input, signal } from '@angular/core';
import { PozosCreateService } from '../../../../shared/services/pozos-create.service';
import { Router } from '@angular/router';
import { NuevoPozo, Sitio } from '../../../../shared/types/schemas';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
} from '@ionic/angular/standalone';
import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { FotoPozoService } from '../../../../shared/services/foto-service/fotoPozo.service';
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';
@Component({
  selector: 'app-pozos-create',
  imports: [
    IonContent,
    IonCard,
    IonCardContent,
    PozosFormComponent,
    IonToolbar,
    IonButtons,
    IonBackButton,
  
  ],
  templateUrl: './pozos-create.page.html',
  styleUrl: './pozos-create.page.css',
})
export class PozosCreatePage {
  public createService: PozosCreateService = inject(PozosCreateService);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public id_pozo = input.required<number>();
  public fotoPozoService = inject(FotoPozoService);
  public sitioReturn: SitioReturnService = inject(SitioReturnService);

  public nuevoPozo = signal<NuevoPozo>({
    id_propietario: 0,
    id_sitio: 0,
    id_perforador: 0,
  });

  ionViewWillEnter() {
    const sitio = this.sitioReturn.sitioCreado();

    console.log('sitio devuelto al crear pozo:', sitio);

    if (sitio) {
      this.nuevoPozo.update((p) => ({
        ...p,
        id_sitio: sitio.id_sitio,
      }));

      this.sitioReturn.sitioCreado.set(null);
    }
  }

  async guardarPozo(data: { pozo: NuevoPozo; foto: File | null }) {
    console.log(data.pozo);
    const id_usuario = data.pozo.id_propietario;

    try {
      this.disabled.set(true);
      console.log('NUEVO POZO', this.nuevoPozo());
      const nuevoPozo = await this.createService.createPozo(id_usuario, data.pozo);

      if (data.foto) {
        await this.fotoPozoService.subirFoto(id_usuario, nuevoPozo.id_pozo, data.foto);
      }
      console.log('Pozo creado: ', nuevoPozo);
      this.router.navigate(['pozos-list']);
    } catch (err: any) {
      this.errorMessage.set(err.message);
    }
    this.disabled.set(false);
  }
  irAtras() {
    this.router.navigate([`pozo`]);
  }

  crearSitio() {
    const pozo = this.nuevoPozo();

    this.router.navigate(['/sitios-create', pozo.id_propietario], {
      state: { returnTo: this.router.url },
    });
  }
}
