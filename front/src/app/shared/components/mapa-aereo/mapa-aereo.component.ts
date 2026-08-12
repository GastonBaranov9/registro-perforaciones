import { Component, inject, input, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { coordenadasRegistradasValidas } from '../../utils/coordenadas';

@Component({
  selector: 'app-mapa-aereo', standalone: true,
  template: `
    <section class="mapa-aereo" aria-label="Mapa aéreo del sitio">
      @if (cargando()) { <p role="status">Consultando mapa aéreo…</p> }
      @else if (mensajeCoordenadas()) { <p>{{ mensajeCoordenadas() }}</p> }
      @else if (!configurado()) { <p>Mapa aéreo no configurado</p> }
      @else if (falloImagen()) { <p>Mapa aéreo no disponible</p> }
      @else {
        <img [src]="urlImagen()" (error)="falloImagen.set(true)" alt="Fotografía aérea de la ubicación del pozo" />
        @if (atribucion()) { <small>{{ atribucion() }}</small> }
      }
    </section>`,
  styles: [`img{display:block;width:100%;max-width:720px;height:auto;object-fit:contain}small{display:block;margin-top:.25rem}`],
})
export class MapaAereoComponent implements OnInit {
  idSitio = input.required<number>(); idUsuario = input.required<number>();
  latitud = input<string | null | undefined>(); longitud = input<string | null | undefined>();
  private http = inject(HttpClient);
  cargando = signal(true); configurado = signal(false); atribucion = signal(''); falloImagen = signal(false); mensajeCoordenadas = signal('');
  urlImagen = () => `${environment.apiURL}usuarios/${this.idUsuario()}/sitios/${this.idSitio()}/mapa-aereo`;
  async ngOnInit() {
    const latitud=String(this.latitud() ?? '').trim(),longitud=String(this.longitud() ?? '').trim();
    if(!latitud&&!longitud){this.mensajeCoordenadas.set('Coordenadas no registradas');this.cargando.set(false);return;}
    if(!coordenadasRegistradasValidas(latitud,longitud)){this.mensajeCoordenadas.set('Coordenadas inválidas');this.cargando.set(false);return;}
    try {
      const estado = await firstValueFrom(this.http.get<{ configurado:boolean; atribucion?:string }>(`${environment.apiURL}mapas/estado`));
      this.configurado.set(estado.configurado); this.atribucion.set(estado.atribucion ?? '');
    } catch { this.configurado.set(false); }
    finally { this.cargando.set(false); }
  }
}
