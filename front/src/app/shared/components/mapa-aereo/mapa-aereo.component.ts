import { Component, computed, inject, input, OnChanges, OnInit, signal, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { coordenadasRegistradasValidas } from '../../utils/coordenadas';
import { ProtectedResourceDirective } from '../../../core/resources/protected-resource.directive';

@Component({
  selector: 'app-mapa-aereo', standalone: true,
  imports: [ProtectedResourceDirective],
  template: `
    <section class="mapa-aereo" aria-label="Mapa aéreo del sitio">
      @if (cargando()) { <p role="status">Consultando mapa aéreo…</p> }
      @else if (mensajeCoordenadas()) { <p>{{ mensajeCoordenadas() }}</p> }
      @else if (!configurado()) { <p>Mapa aéreo no configurado</p> }
      @else if (falloImagen()) { <p>Mapa aéreo no disponible</p> }
      @else {
        <img [protectedSrc]="urlImagen()" (protectedResourceError)="falloImagen.set(true)" alt="Fotografía aérea de la ubicación del pozo" />
        @if (atribucion()) { <small>{{ atribucion() }}</small> }
      }
    </section>`,
  styles: [`img{display:block;width:100%;max-width:720px;height:auto;object-fit:contain}small{display:block;margin-top:.25rem}`],
})
export class MapaAereoComponent implements OnInit, OnChanges {
  idSitio = input.required<number>(); idUsuario = input.required<number>();
  latitud = input<string | null | undefined>(); longitud = input<string | null | undefined>();
  preview = input(false);
  private http = inject(HttpClient);
  cargando = signal(true); configurado = signal(false); atribucion = signal(''); falloImagen = signal(false); mensajeCoordenadas = signal('');
  coordenadasVersion = computed(() => {
    const latitud=String(this.latitud() ?? '').trim(),longitud=String(this.longitud() ?? '').trim();
    return latitud && longitud ? encodeURIComponent(`${latitud},${longitud}`) : '';
  });
  urlImagen = () => {
    const base=`${environment.apiURL}usuarios/${this.idUsuario()}/sitios/${this.idSitio()}/mapa-aereo${this.preview() ? '/preview' : ''}`;
    const version=this.coordenadasVersion();
    if (this.preview()) {
      const latitud=encodeURIComponent(String(this.latitud() ?? '').trim());
      const longitud=encodeURIComponent(String(this.longitud() ?? '').trim());
      return `${base}?latitud=${latitud}&longitud=${longitud}`;
    }
    return version ? `${base}?v=${version}` : base;
  };
  private actualizacion = 0;
  private inicializado = false;
  private estadoConsultado = false;
  private estadoEnCurso = false;
  ngOnInit() { this.inicializado = true; void this.actualizarEstado(); }
  ngOnChanges(changes: SimpleChanges) {
    if (!this.inicializado) return;
    if (changes['latitud'] || changes['longitud']) {
      this.validarCoordenadas();
      if (this.coordenadasValidas() && !this.estadoConsultado && !this.estadoEnCurso) void this.actualizarEstado();
      return;
    }
    void this.actualizarEstado();
  }
  private coordenadasValidas() {
    const latitud=String(this.latitud() ?? '').trim(),longitud=String(this.longitud() ?? '').trim();
    return Boolean(latitud && longitud && coordenadasRegistradasValidas(latitud,longitud));
  }
  private validarCoordenadas() {
    this.falloImagen.set(false); this.mensajeCoordenadas.set('');
    const latitud=String(this.latitud() ?? '').trim(),longitud=String(this.longitud() ?? '').trim();
    if(!latitud&&!longitud){this.mensajeCoordenadas.set('Coordenadas no registradas');this.cargando.set(false);return false;}
    if(!coordenadasRegistradasValidas(latitud,longitud)){this.mensajeCoordenadas.set('Coordenadas inválidas');this.cargando.set(false);return false;}
    return true;
  }
  private async actualizarEstado() {
    const actualizacion = ++this.actualizacion;
    if (!this.validarCoordenadas()) return;
    this.configurado.set(false);this.cargando.set(true);
    this.estadoEnCurso = true;
    try {
      const estado = await firstValueFrom(this.http.get<{ configurado:boolean; atribucion?:string }>(`${environment.apiURL}mapas/estado`));
      if (actualizacion !== this.actualizacion) return;
      this.configurado.set(estado.configurado); this.atribucion.set(estado.atribucion ?? ''); this.estadoConsultado = true;
    } catch { if (actualizacion === this.actualizacion) this.configurado.set(false); }
    finally { this.estadoEnCurso = false; if (actualizacion === this.actualizacion) this.cargando.set(false); }
  }
}
