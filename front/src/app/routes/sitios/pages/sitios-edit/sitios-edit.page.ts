import { Component, inject, input, resource, signal } from '@angular/core';
import { SitiosFormComponent } from '../../components/sitios-form/sitios-form.component';
import { SitiosEditService } from '../../../../shared/services/sitios-edit.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SitioBody } from '../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonButton } from '@ionic/angular/standalone';
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { MapaAereoComponent } from '../../../../shared/components/mapa-aereo/mapa-aereo.component';
import { mensajeHumano } from '../../../../shared/utils/errores';

type CoordenadasMapa = { latitud: string; longitud: string };

@Component({
  selector: 'app-sitios-edit',
  imports: [IonContent, IonCard, IonCardContent, SitiosFormComponent, IonButton, MapaAereoComponent],
  templateUrl: './sitios-edit.page.html',
  styleUrl: './sitios-edit.page.css',
})
export class SitiosEditPage {
  public editSitioService = inject(SitiosEditService);
  public activateRoute = inject(ActivatedRoute);
  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  private router: Router = inject(Router);
  public auth = inject(AuthService);

  public id_sitio = input.required<number>();

  public sitio = signal<SitioBody>({
    departamento: '',
  });

  public sitioResource = resource({
    params: () => ({ id: this.id_sitio() }),
    loader: ({ params }) => this.editSitioService.getSitioById(params.id),
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public coordenadasPendientesMapa = signal<CoordenadasMapa | null>(null);

  returnTo = signal('/sitios-list');

  ngOnInit() {
    const candidata = globalThis.history.state?.returnTo;
    this.returnTo.set(typeof candidata === 'string' && (/^\/pozo-edit\/\d+$/.test(candidata) || /^\/pozos-detail\/\d+$/.test(candidata)) ? candidata : '/sitios-list');
  }

  async handleEdit(sitio: SitioBody) {
    try {
      this.disabled.set(true);
      const editado = await this.editSitioService.editSitio(this.id_sitio(), sitio);
      this.sitioReturn.sitioCreado.set(editado);
      await this.router.navigateByUrl(this.returnTo());
    } catch (error: unknown) {
      this.errorMessage.set(mensajeHumano(error, 'No se pudo actualizar el sitio.'));
    } finally {
      this.disabled.set(false);
    }
  }
  actualizarMapa(coordenadas: CoordenadasMapa | null) { this.coordenadasPendientesMapa.set(coordenadas); }
  volver() { this.router.navigateByUrl(this.returnTo()); }
}
