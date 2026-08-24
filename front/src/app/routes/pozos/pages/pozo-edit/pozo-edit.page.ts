import { Component, inject, input, resource, signal } from '@angular/core';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { Router } from '@angular/router';
import { AccionFotoEdicion, DatosTecnicosBorrador, NuevoPozo, PropietarioOperativoActualizarBody, Sitio } from '../../../../shared/types/schemas';
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
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
import { PerfilLitologicoVistaPreviaComponent } from '../../components/perfil-litologico-vista-previa/perfil-litologico-vista-previa.component';
import { normalizarFechaCalendarioInput } from '../../../../shared/utils/fechas';
import { mensajeHumano } from '../../../../shared/utils/errores';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
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
    PerfilLitologicoVistaPreviaComponent,
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
  public authService = inject(AuthService);
  private propietariosOperativos = inject(PropietariosOperativosService);
  buscarPropietarios = (texto: string) => this.candidatos.buscar('propietario', texto);
  buscarPerforadores = (texto: string) => this.candidatos.buscar('perforador', texto);
  private litologia = inject(IntervaloLitologicoListService);
  private diametros = inject(IntervaloDiametroListService);
  private filtros = inject(IntervalosFiltroService);
  private aportes = inject(AporteListService);

  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  public pozoResource = resource({
    params: () => ({ idPozo: this.id_pozo() }),
    loader: async ({ params }) => {
      const [pozo, personasBase, litologia, diametros, filtros, aportes] = await Promise.all([
        this.pozoEditService.getPozoById(params.idPozo), this.candidatos.obtener(),
        this.litologia.getIntervalosLitologicos(params.idPozo), this.diametros.getIntervalosDiametros(params.idPozo), this.filtros.listar(params.idPozo),
        this.aportes.getNivelesAporte(params.idPozo),
      ]);
      const [propietario, perforador] = await Promise.all([
        personasBase.propietarios.some((x) => x.id_usuario === pozo.id_propietario) ? null : this.candidatos.obtenerPorId('propietario', pozo.id_propietario),
        personasBase.perforadores.some((x) => x.id_usuario === pozo.id_perforador) ? null : this.candidatos.obtenerPorId('perforador', pozo.id_perforador),
      ]);
      const personas = {
        propietarios: propietario ? [propietario, ...personasBase.propietarios] : personasBase.propietarios,
        perforadores: perforador ? [perforador, ...personasBase.perforadores] : personasBase.perforadores,
      };
      const tecnicos: DatosTecnicosBorrador = {
        intervalosLitologicos: litologia.map((x) => ({ idLocal: `persistido-lit-${x.id_intervalo_litologico}`, dato: { id_intervalo_litologico: x.id_intervalo_litologico, desde_m: x.desde_m, hasta_m: x.hasta_m, material: x.material, id_litologia: x.id_litologia ?? undefined } })),
        intervalosDiametro: diametros.map((x) => ({ idLocal: `persistido-dia-${x.id_intervalo_diametro_perforacion}`, dato: { desde_m: x.desde_m, hasta_m: x.hasta_m, diametro_pulg: x.diametro_pulg, material_tuberia: x.material_tuberia ?? '' } })),
        intervalosFiltro: filtros.map((x) => ({ idLocal: `persistido-fil-${x.id_intervalo_filtro}`, ranuraOriginal: x.ranura_mm, dato: { id_intervalo_filtro:x.id_intervalo_filtro,desde_m:x.desde_m,hasta_m:x.hasta_m,diametro_pulg:x.diametro_pulg,material_tuberia:x.material_tuberia,ranura_mm:x.ranura_mm } })),
        nivelesAporte: aportes.map((x) => ({ idLocal: `persistido-apo-${x.id_nivel_aporte}`, dato: { profundidad_m: x.profundidad_m } })),
      };
      return { pozo: { ...pozo, fecha_inicio: normalizarFechaCalendarioInput(pozo.fecha_inicio), fecha_fin: normalizarFechaCalendarioInput(pozo.fecha_fin) }, personas, sitios: pozo.sitio ? [pozo.sitio] : [] as Sitio[], tecnicos };
    },
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public datosTecnicos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
  public sitiosActualizados = signal<Sitio[] | null>(null);
  public profundidadBorrador = signal<number | undefined>(undefined);
  public borradorDirty = signal(false);
  public versionDescartar = signal(0);
  mensajeErrorCarga() { return mensajeHumano(this.pozoResource.error(), 'No fue posible cargar los datos del pozo.'); }

  ionViewWillEnter(): void {
    const sitio = this.sitioReturn.sitioCreado();
    if (!sitio) return;
    this.sitioReturn.sitioCreado.set(null);
    this.sitiosActualizados.update((actualizados) => {
      const actuales = actualizados ?? this.pozoResource.value()?.sitios ?? [];
      if (!actuales.some((actual) => actual.id_sitio === sitio.id_sitio)) return actualizados;
      return actuales.map((actual) => actual.id_sitio === sitio.id_sitio ? sitio : actual);
    });
  }

  async handleEdit(data: { pozo: NuevoPozo; foto: File | null; fotoAccion: AccionFotoEdicion }) {
    if (this.disabled()) return;
    const errores = validarDatosTecnicos(this.datosTecnicos(), data.pozo.profundidad_final_m);
    if (errores.length) { this.errorMessage.set(errores.join(' ')); return; }
    try {
      this.disabled.set(true);
      await this.pozoEditService.editPozoCompleto(this.id_pozo(), data.pozo, this.datosTecnicos(), data.foto, data.fotoAccion);
      this.borradorDirty.set(false);
      await this.router.navigate(['/pozos-detail', this.id_pozo()]);
    } catch (error: unknown) { this.errorMessage.set(mensajeHumano(error, 'No se pudo actualizar la perforación.')); }
    finally { this.disabled.set(false); }
  }
  recargar(): void {
    if (this.borradorDirty() && !window.confirm('Hay cambios técnicos sin guardar. ¿Desea descartarlos y recargar?')) return;
    this.borradorDirty.set(false);
    this.versionDescartar.update((version) => version + 1);
    this.pozoResource.reload();
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
      this.errorMessage.set(mensajeHumano(error, 'No se pudo eliminar la fotografía.'));
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
  async actualizarPropietario(evento: { id: number; body: PropietarioOperativoActualizarBody }) {
    if (this.disabled()) return;
    try {
      this.disabled.set(true); this.errorMessage.set('');
      const actualizado = await this.propietariosOperativos.actualizar(evento.id, evento.body);
      const candidato = this.pozoResource.value()?.personas.propietarios.find((p) => p.id_usuario === evento.id);
      if (candidato) Object.assign(candidato, actualizado, { roles: candidato.roles });
    } catch (error: unknown) { this.errorMessage.set(mensajeHumano(error, 'No se pudo actualizar el propietario.')); }
    finally { this.disabled.set(false); }
  }
}
