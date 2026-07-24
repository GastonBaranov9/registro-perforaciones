import { Component, inject, input, resource, signal } from '@angular/core';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { Router } from '@angular/router';
import { NuevoPozo, Pozo } from '../../../../shared/types/schemas';
import {
  IonButton,
  IonContent,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonToolbar,
  IonButtons,
  IonBackButton,
} from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { FotoPozoService } from '../../../../shared/services/foto-service/fotoPozo.service';
import { PdfGenerate } from '../../../../shared/services/pdf-generate/pdf-generate';
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';
@Component({
  selector: 'app-pozo-edit',
  imports: [
    IonButton,
    IonContent,
    IonSpinner,
    IonCard,
    IonCardContent,
    PozosFormComponent,
    IonToolbar,
    IonButtons,
    IonBackButton,
  ],
  templateUrl: './pozo-edit.page.html',
  styleUrl: './pozo-edit.page.css',
})
export class PozoEditPage {
  public pozoEditService: PozosEditService = inject(PozosEditService);
  public router: Router = inject(Router);
  public id_pozo = input.required<number>();
  public fotoPozoService = inject(FotoPozoService);

  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  public pozoResource = resource({
    params: () => ({ idPozo: this.id_pozo() }),
    loader: ({ params }) => this.pozoEditService.getPozoById(params.idPozo),
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

  async handleEdit(data: { pozo: NuevoPozo; foto: File | null }) {
    try {
      const id_usuario = data.pozo.id_propietario;
      this.disabled.set(true);
      const editado = await this.pozoEditService.editPozo(this.id_pozo(), data.pozo);

      if (data.foto) {
        await this.fotoPozoService.subirFoto(id_usuario, this.id_pozo(), data.foto);
      }

      console.log('Perforacion editada', editado);
      this.router.navigate(['pozos-list']);
    } catch (err: any) {
      this.errorMessage.set(err.message);
    }
    this.disabled.set(false);
  }
  irAtras() {
    this.router.navigate([`pozos-list`]);
  }

  editarSitio() {
    const pozo = this.pozoResource.value();
    if (!pozo) return;

    this.router.navigate(['/sitios-edit', pozo.id_sitio], {
      state: { returnTo: this.router.url },
    });
  }
}
