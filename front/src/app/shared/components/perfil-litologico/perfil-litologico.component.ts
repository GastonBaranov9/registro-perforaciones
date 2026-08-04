import { Component, inject, input, OnInit, signal } from '@angular/core';
import { PerfilLitologicoService } from '../../services/perfil-litologico.service';
import { PerfilLitologico } from '../../types/schemas';

@Component({
  selector: 'app-perfil-litologico',
  templateUrl: './perfil-litologico.component.html',
  styleUrl: './perfil-litologico.component.css',
})
export class PerfilLitologicoComponent implements OnInit {
  readonly idUsuario = input.required<number>();
  readonly idPozo = input.required<number>();
  readonly perfil = signal<PerfilLitologico | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  private readonly service = inject(PerfilLitologicoService);

  async ngOnInit() {
    try {
      this.perfil.set(await this.service.getPerfil(this.idUsuario(), this.idPozo()));
    } catch {
      this.error.set('No se pudo cargar el perfil litológico.');
    } finally {
      this.cargando.set(false);
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

  patron(patron: string) {
    return `url(#perfil-${patron})`;
  }

  etiqueta(tramo: PerfilLitologico['tramos'][number]) {
    return `${tramo.desde_m}–${tramo.hasta_m} m · ${tramo.material}`;
  }
}
