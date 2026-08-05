import { Component, inject, input, OnInit, resource, signal } from '@angular/core';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
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

@Component({
  selector: 'app-pozos-detail',
  imports: [
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
  ],
  templateUrl: './pozos-detail.page.html',
  styleUrl: './pozos-detail.page.css',
})
export class PozosDetailPage implements OnInit, ViewWillEnter {
  public informeService: PdfGenerate = inject(PdfGenerate);
  public pozoEditService = inject(PozosEditService);
  public ruta = inject(ActivatedRoute);
  public router = inject(Router);
  public id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
  public pozo = signal<Pozo | undefined>(undefined);
  public errorMessage = signal<string>('');
  public litologia = signal<IntervaloLitologico[]>([]);
  public diametros = signal<IntervaloDiametroPerforacion[]>([]);
  public aportes = signal<NivelAporte[]>([]);
  public filtros = signal<IntervaloFiltro[]>([]);
  private litologiaService = inject(IntervaloLitologicoListService);
  private diametroService = inject(IntervaloDiametroListService);
  private aporteService = inject(AporteListService);
  private filtroService = inject(IntervalosFiltroService);

  async ngOnInit() {
    const data = await this.pozoEditService.getPozoById(this.id_pozo);
    this.pozo.set(data);
    this.getFoto();
    await this.cargarTecnicos();
    
  }

  async ionViewWillEnter(){
    
   const data = await this.pozoEditService.getPozoById(this.id_pozo);
    this.pozo.set(data);
    this.getFoto();
    await this.cargarTecnicos();
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
    this.router.navigate([`pozo-edit/${this.id_pozo}`]);
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
  generarPdf() {
    const pozo = this.pozo();
    if (!pozo) {
      this.errorMessage.set('No se pudo obtener la información del pozo.');
      return;
    }
    const id_usuario = pozo.id_propietario;
    this.informeService.descargarInformePozo(id_usuario, this.id_pozo).subscribe((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe_pozo_${this.id_pozo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  }
}
