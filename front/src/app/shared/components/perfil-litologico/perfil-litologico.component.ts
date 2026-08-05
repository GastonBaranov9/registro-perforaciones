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
    return 70 + ((metros - rango.desde_m) / (rango.hasta_m - rango.desde_m)) * 700;
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

  xAporte(fraccion: number) { return 90 + fraccion * 180; }
  yBandaAporte(profundidad: number, rango: PerfilLitologico['rangos'][number], alto = 8) { return this.y(profundidad, rango) - alto / 2; }
  xEtiqueta(carril: 0 | 1 | 2 | 3) { return 310 + carril * 60; }
  yEtiqueta(posicionNormalizada: number) { return 70 + posicionNormalizada * 700; }

  patron(patron: string) {
    return `url(#perfil-${patron})`;
  }

}
