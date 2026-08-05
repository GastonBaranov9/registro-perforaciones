import { Component, effect, inject, input, signal } from '@angular/core';
import { PerfilLitologicoService } from '../../services/perfil-litologico.service';
import { PerfilLitologico } from '../../types/schemas';

@Component({
  selector: 'app-perfil-litologico',
  templateUrl: './perfil-litologico.component.html',
  styleUrl: './perfil-litologico.component.css',
})
export class PerfilLitologicoComponent {
  readonly idUsuario = input<number | null>(null);
  readonly idPozo = input<number | null>(null);
  readonly modelo = input<PerfilLitologico | null | undefined>(undefined);
  readonly versionPerfil = input(0);
  readonly perfil = signal<PerfilLitologico | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  private readonly service = inject(PerfilLitologicoService);
  private solicitudVigente = 0;

  constructor() {
    effect(() => {
      const modelo = this.modelo();
      if (modelo !== undefined) {
        ++this.solicitudVigente;
        this.perfil.set(modelo);
        this.cargando.set(false);
        this.error.set('');
        return;
      }
      const parametros = { idUsuario: this.idUsuario(), idPozo: this.idPozo(), version: this.versionPerfil() };
      if (parametros.idUsuario == null || parametros.idPozo == null) return;
      void this.cargar(parametros.idUsuario, parametros.idPozo);
    });
  }

  reintentar() {
    const idUsuario = this.idUsuario(); const idPozo = this.idPozo();
    if (idUsuario != null && idPozo != null) void this.cargar(idUsuario, idPozo);
  }

  private async cargar(idUsuario: number, idPozo: number) {
    const solicitud = ++this.solicitudVigente;
    this.cargando.set(true);
    this.error.set('');
    this.perfil.set(null);
    try {
      const perfil = await this.service.getPerfil(idUsuario, idPozo);
      if (solicitud === this.solicitudVigente) this.perfil.set(perfil);
    } catch {
      if (solicitud === this.solicitudVigente) this.error.set('No se pudo cargar el perfil litológico actualizado.');
    } finally {
      if (solicitud === this.solicitudVigente) this.cargando.set(false);
    }
  }

  y(metros: number, rango: PerfilLitologico['rangos'][number]) {
    const geometria = this.perfil()!.geometria;
    return geometria.columna.y + ((metros - rango.desde_m) / (rango.hasta_m - rango.desde_m)) * geometria.columna.alto;
  }

  alto(desde: number, hasta: number, rango: PerfilLitologico['rangos'][number]) {
    return this.y(Math.min(hasta, rango.hasta_m), rango) - this.y(Math.max(desde, rango.desde_m), rango);
  }

  ticks(perfil: PerfilLitologico, rango: PerfilLitologico['rangos'][number]) {
    const resultado = [rango.desde_m];
    let valor = Math.ceil(rango.desde_m / perfil.paso_escala_m) * perfil.paso_escala_m;
    for (; valor < rango.hasta_m; valor += perfil.paso_escala_m) if (valor > rango.desde_m) resultado.push(valor);
    resultado.push(rango.hasta_m);
    return resultado;
  }

  tramosEnRango(perfil: PerfilLitologico, rango: PerfilLitologico['rangos'][number]) {
    return perfil.tramos.filter((tramo) => tramo.desde_m < rango.hasta_m && tramo.hasta_m > rango.desde_m);
  }

  aportesEnRango(perfil: PerfilLitologico, rango: PerfilLitologico['rangos'][number]) {
    return perfil.aportes.filter((aporte) => aporte.profundidad_m >= rango.desde_m && aporte.profundidad_m <= rango.hasta_m);
  }
  construccionEnRango(perfil: PerfilLitologico, rango: PerfilLitologico['rangos'][number]) { return [...perfil.tuberias, ...perfil.filtros].filter((t) => t.desde_m < rango.hasta_m && t.hasta_m > rango.desde_m); }
  etiquetasEnRango(perfil: PerfilLitologico, rango: PerfilLitologico['rangos'][number]) { return perfil.etiquetas.filter((etiqueta) => etiqueta.rango_desde_m === rango.desde_m); }

  xAporte(fraccion: number) { const columna=this.perfil()!.geometria.columna; return columna.x + fraccion * columna.ancho; }
  yBandaAporte(profundidad: number, rango: PerfilLitologico['rangos'][number], alto = 8) { return this.y(profundidad, rango) - alto / 2; }
  xEtiqueta(normalizada: number) { return normalizada * this.perfil()!.geometria.ancho_logico; }
  yEtiqueta(posicionNormalizada: number) { const geometria=this.perfil()!.geometria; return geometria.columna.y + posicionNormalizada * geometria.columna.alto; }
  puntosConector(etiqueta: PerfilLitologico['etiquetas'][number]) { return etiqueta.conector.puntos.map((p) => `${p.x_normalizada*this.perfil()!.geometria.ancho_logico},${p.y_normalizada*this.perfil()!.geometria.alto_logico}`).join(' '); }
  xMarca(inicio: boolean) { const columna=this.perfil()!.geometria.columna; return columna.x-(inicio?10:0); }
  xMarcadorAporte() { const columna=this.perfil()!.geometria.columna; return columna.x+columna.ancho+12; }
  xTextoEscala() { return this.perfil()!.geometria.x_texto_escala; }

  patron(patron: string) {
    return `url(#perfil-${patron})`;
  }

}
