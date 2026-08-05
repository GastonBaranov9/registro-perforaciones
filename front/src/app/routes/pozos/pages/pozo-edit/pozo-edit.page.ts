import { Component, inject, input, resource, signal } from '@angular/core';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { Router } from '@angular/router';
import { AccionFotoEdicion, DatosTecnicosBorrador, NuevoPozo } from '../../../../shared/types/schemas';
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
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
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
    DatosTecnicosBorradorComponent,
  ],
  templateUrl: './pozo-edit.page.html',
  styleUrl: './pozo-edit.page.css',
})
export class PozoEditPage {
  public pozoEditService: PozosEditService = inject(PozosEditService);
  public router: Router = inject(Router);
  public id_pozo = input.required<number>();
  public fotoPozoService = inject(FotoPozoService);
  private candidatos = inject(CandidatosPozoService);
  private litologia = inject(IntervaloLitologicoListService);
  private diametros = inject(IntervaloDiametroListService);
  private aportes = inject(AporteListService);

  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  public pozoResource = resource({
    params: () => ({ idPozo: this.id_pozo() }),
    loader: async ({ params }) => {
      const [pozo, personas, litologia, diametros, aportes] = await Promise.all([
        this.pozoEditService.getPozoById(params.idPozo), this.candidatos.obtener(),
        this.litologia.getIntervalosLitologicos(params.idPozo), this.diametros.getIntervalosDiametros(params.idPozo),
        this.aportes.getNivelesAporte(params.idPozo),
      ]);
      const tecnicos: DatosTecnicosBorrador = {
        intervalosLitologicos: litologia.map((x) => ({ idLocal: `persistido-lit-${x.id_intervalo_litologico}`, dato: { desde_m: x.desde_m, hasta_m: x.hasta_m, material: x.material } })),
        intervalosDiametro: diametros.map((x) => ({ idLocal: `persistido-dia-${x.id_intervalo_diametro_perforacion}`, dato: { desde_m: x.desde_m, hasta_m: x.hasta_m, diametro_pulg: x.diametro_pulg } })),
        nivelesAporte: aportes.map((x) => ({ idLocal: `persistido-apo-${x.id_nivel_aporte}`, dato: { profundidad_m: x.profundidad_m } })),
      };
      return { pozo, personas, tecnicos };
    },
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public datosTecnicos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], nivelesAporte: [] });

  async handleEdit(data: { pozo: NuevoPozo; foto: File | null; fotoAccion: AccionFotoEdicion }) {
    if (this.disabled()) return;
    const errores = validarDatosTecnicos(this.datosTecnicos(), data.pozo.profundidad_final_m);
    if (errores.length) { this.errorMessage.set(errores.join(' ')); return; }
    try {
      this.disabled.set(true);
      await this.pozoEditService.editPozoCompleto(this.id_pozo(), data.pozo, this.datosTecnicos(), data.foto, data.fotoAccion);
      await this.router.navigate(['/pozos-detail', this.id_pozo()]);
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo actualizar.'); }
    finally { this.disabled.set(false); }
  }
  async eliminarFotoPersistida() {
    const pozo = this.pozoResource.value()?.pozo;
    if (!pozo?.foto_url || this.disabled()) return;
    try {
      this.disabled.set(true);
      this.errorMessage.set('');
      await this.fotoPozoService.eliminarFoto(pozo.id_propietario, this.id_pozo());
      this.pozoResource.reload();
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo eliminar la fotografía.');
    } finally {
      this.disabled.set(false);
    }
  }
  irAtras() {
    this.router.navigate([`pozos-list`]);
  }

  editarSitio() {
    const pozo = this.pozoResource.value()?.pozo;
    if (!pozo) return;

    this.router.navigate(['/sitios-edit', pozo.id_sitio], {
      state: { returnTo: this.router.url },
    });
  }
}
