import { Component, inject, signal } from '@angular/core';
import { PozosCreateService } from '../../../../shared/services/pozos-create.service';
import { Router } from '@angular/router';
import { AccionFotoEdicion, CatalogosPersonasPozo, DatosTecnicosBorrador, NuevoPozo } from '../../../../shared/types/schemas';
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
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
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
    IonButton,
    DatosTecnicosBorradorComponent,
  ],
  templateUrl: './pozos-create.page.html',
  styleUrl: './pozos-create.page.css',
})
export class PozosCreatePage {
  public createService: PozosCreateService = inject(PozosCreateService);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  public candidatosService = inject(CandidatosPozoService);
  public catalogos = signal<CatalogosPersonasPozo | null>(null);
  public cargandoCatalogos = signal(true);
  public datosTecnicos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });

  public nuevoPozo = signal<NuevoPozo>({
    id_propietario: 0,
    id_sitio: 0,
    id_perforador: 0,
  });

  async ionViewWillEnter() {
    const sitio = this.sitioReturn.sitioCreado();

    console.log('sitio devuelto al crear pozo:', sitio);

    if (sitio) {
      this.nuevoPozo.update((p) => ({
        ...p,
        id_sitio: sitio.id_sitio,
      }));

      this.sitioReturn.sitioCreado.set(null);
    }
    if (!this.catalogos()) await this.cargarCatalogos();
  }

  async cargarCatalogos() {
    try {
      this.cargandoCatalogos.set(true); this.errorMessage.set('');
      const catalogos = await this.candidatosService.obtener();
      this.catalogos.set(catalogos);
      if (catalogos.perforadores.length === 1) this.nuevoPozo.update((p) => ({ ...p, id_perforador: catalogos.perforadores[0].id_usuario }));
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudieron cargar las personas.'); }
    finally { this.cargandoCatalogos.set(false); }
  }

  async guardarPozo(data: { pozo: NuevoPozo; foto: File | null; fotoAccion?: AccionFotoEdicion }) {
    if (this.disabled()) return;
    const id_usuario = data.pozo.id_propietario;
    const errores = validarDatosTecnicos(this.datosTecnicos(), data.pozo.profundidad_final_m);
    if (errores.length) {
      this.errorMessage.set(errores.join(' '));
      return;
    }

    try {
      this.disabled.set(true);
      this.errorMessage.set('');
      const resultado = await this.createService.createPozoCompleto(id_usuario, data.pozo, this.datosTecnicos(), data.foto);
      await this.router.navigate(['/pozos-detail', resultado.pozo.id_pozo]);
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear la perforación.');
    } finally {
      this.disabled.set(false);
    }
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
