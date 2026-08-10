import { Component, inject, input, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-mapa-aereo', standalone: true,
  template: `
    <section class="mapa-aereo" aria-label="Mapa aéreo del sitio">
      @if (cargando()) { <p role="status">Consultando mapa aéreo…</p> }
      @else if (!configurado()) { <p>Mapa aéreo no configurado</p> }
      @else if (falloImagen()) { <p>Mapa aéreo no disponible</p> }
      @else {
        <img [src]="urlImagen()" (error)="falloImagen.set(true)" alt="Fotografía aérea de la ubicación del pozo" />
        @if (atribucion()) { <small>{{ atribucion() }}</small> }
      }
    </section>`,
  styles: [`img{display:block;width:100%;max-width:720px;max-height:420px;object-fit:contain}small{display:block;margin-top:.25rem}`],
})
export class MapaAereoComponent implements OnInit {
  idSitio = input.required<number>(); idUsuario = input.required<number>();
  private http = inject(HttpClient);
  cargando = signal(true); configurado = signal(false); atribucion = signal(''); falloImagen = signal(false);
  urlImagen = () => `${environment.apiURL}usuarios/${this.idUsuario()}/sitios/${this.idSitio()}/mapa-aereo`;
  async ngOnInit() {
    try {
      const estado = await firstValueFrom(this.http.get<{ configurado:boolean; atribucion?:string }>(`${environment.apiURL}mapas/estado`));
      this.configurado.set(estado.configurado); this.atribucion.set(estado.atribucion ?? '');
    } catch { this.configurado.set(false); }
    finally { this.cargando.set(false); }
  }
}
