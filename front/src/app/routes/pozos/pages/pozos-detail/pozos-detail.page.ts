import { EdicionPozoService } from '../../../../shared/services/edicion-pozo.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { AsignarNumeroPendienteComponent } from '../../../../shared/components/numero-perforacion/asignar-numero-pendiente.component';
import { Component, inject, signal } from '@angular/core';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonImg,
  IonToolbar,
  IonButtons,
  ViewWillEnter,
} from '@ionic/angular/standalone';
import { IntervaloDiametroPerforacion, IntervaloFiltro, IntervaloLitologico, NivelAporte, Pozo } from '../../../../shared/types/schemas';
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { PdfGenerate } from '../../../../shared/services/pdf-generate/pdf-generate';
import { environment } from '../../../../../environments/environment';
import { PerfilLitologicoComponent } from '../../../../shared/components/perfil-litologico/perfil-litologico.component';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { formatearFechaCalendario } from '../../../../shared/utils/fechas';
import { representarSitio } from '../../../../shared/utils/sitio-humano';
import { MapaAereoComponent } from '../../../../shared/components/mapa-aereo/mapa-aereo.component';
import { ProtectedResourceDirective } from '../../../../core/resources/protected-resource.directive';

@Component({
  selector: 'app-pozos-detail',
  imports: [
    AsignarNumeroPendienteComponent,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonImg,
    IonToolbar,
    IonButtons,
    PerfilLitologicoComponent,
    MapaAereoComponent,
    ProtectedResourceDirective,
  ],
  templateUrl: './pozos-detail.page.html',
  styleUrl: './pozos-detail.page.css',
})
export class PozosDetailPage implements ViewWillEnter {
  readonly permisos = inject(EdicionPozoService);
  readonly authService = inject(AuthService);
  numeroAsignado(numero: number) { this.pozo.update((p) => p ? { ...p, numero_perforacion: numero } : p); }
  readonly formatearFechaCalendario = formatearFechaCalendario;
  readonly representarSitio = representarSitio;
  public informeService: PdfGenerate = inject(PdfGenerate);
  public pozoEditService = inject(PozosEditService);
  public ruta = inject(ActivatedRoute);
  public router = inject(Router);
  public id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
  public pozo = signal<Pozo | undefined>(undefined);
  public errorMessage = signal<string>('');
  public generandoPdf = signal(false);
  public errorPdf = signal('');
  public litologia = signal<IntervaloLitologico[]>([]);
  public diametros = signal<IntervaloDiametroPerforacion[]>([]);
  public aportes = signal<NivelAporte[]>([]);
  public filtros = signal<IntervaloFiltro[]>([]);
  public versionPerfil = signal(0);
  private litologiaService = inject(IntervaloLitologicoListService);
  private diametroService = inject(IntervaloDiametroListService);
  private aporteService = inject(AporteListService);
  private filtroService = inject(IntervalosFiltroService);

  async ionViewWillEnter(){
    this.versionPerfil.update((version) => version + 1);
    this.errorMessage.set('');
    try {
      const data = await this.pozoEditService.getPozoById(this.id_pozo);
      this.pozo.set(data);
      this.getFoto();
      await this.cargarTecnicos();
    } catch {
      this.pozo.set(undefined);
      this.errorMessage.set('No se pudo recargar el detalle actualizado.');
    }
  }
  private async cargarTecnicos() {
    try {
      const [litologia, diametros, filtros, aportes] = await Promise.all([
        this.litologiaService.getIntervalosLitologicos(this.id_pozo),
        this.diametroService.getIntervalosDiametros(this.id_pozo),
        this.filtroService.listar(this.id_pozo),
        this.aporteService.getNivelesAporte(this.id_pozo),
      ]);
      this.litologia.set(litologia);
      this.diametros.set(diametros);
      this.filtros.set(filtros);
      this.aportes.set(aportes);
    } catch {
      this.errorMessage.set('No se pudieron cargar todos los datos técnicos.');
    }
  }
  public irAEditarPozo() {
    if (!this.permisos.puedeEditar(this.pozo())) return;
    this.router.navigate([`pozo-edit/${this.id_pozo}`]);
  }
  ubicacionPropietario(): string {
    const pozo = this.pozo();
    return [pozo?.propietario_localidad, pozo?.propietario_departamento].filter((valor): valor is string => Boolean(valor)).join(', ');
  }
getFoto() {
  const foto = this.pozo()?.foto_url;
  if (!foto) return null;

  if (foto.startsWith('http')) {
    return foto;
  }
  
  let path = foto;
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return environment.serverURL + path;
}
  async generarPdf(): Promise<void> {
    if (this.generandoPdf()) return;
    this.errorPdf.set('');
    const pozo = this.pozo();
    if (!pozo) {
      this.errorPdf.set('No se pudo obtener la información del pozo.');
      return;
    }
    this.generandoPdf.set(true);
    try {
      await this.informeService.exportarInformePozo(pozo.id_propietario ?? pozo.id_perforador, this.id_pozo);
    } catch {
      this.errorPdf.set('No se pudo generar o abrir el PDF. Verificá la conexión e intentá nuevamente.');
    } finally {
      this.generandoPdf.set(false);
    }
  }
}
