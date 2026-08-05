import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatosTecnicosBorrador, ElementoBorrador, IntervaloDiametroPerforacionBody, IntervaloFiltroBody, IntervaloLitologicoBody, NivelAporteBody } from '../../../../shared/types/schemas';
import { ordenarDatosTecnicos, sugerirInicioSiguienteIntervalo, validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';

@Component({
  selector: 'app-datos-tecnicos-borrador',
  imports: [FormsModule],
  templateUrl: './datos-tecnicos-borrador.component.html',
  styleUrl: './datos-tecnicos-borrador.component.css',
})
export class DatosTecnicosBorradorComponent {
  readonly profundidad = input<number | undefined>();
  readonly guardando = input(false);
  readonly inicial = input<DatosTecnicosBorrador | null>(null);
  readonly cambiado = output<DatosTecnicosBorrador>();
  readonly datos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
  private siguienteId = 1;
  private inicializado = false;
  readonly errorAgregar = signal('');

  constructor() {
    effect(() => {
      const inicial = this.inicial();
      if (inicial && !this.inicializado) {
        this.inicializado = true;
        this.datos.set(ordenarDatosTecnicos(inicial));
        this.cambiado.emit(this.datos());
      }
    });
  }

  agregarLitologia() {
    const sugerencia = sugerirInicioSiguienteIntervalo(this.datos().intervalosLitologicos.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), intervalosLitologicos: [...this.datos().intervalosLitologicos, this.local<IntervaloLitologicoBody>({ desde_m: sugerencia.desde_m, hasta_m: Number.NaN, material: '' })] });
  }
  agregarDiametro() {
    const sugerencia = sugerirInicioSiguienteIntervalo(this.datos().intervalosDiametro.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), intervalosDiametro: [...this.datos().intervalosDiametro, this.local<IntervaloDiametroPerforacionBody>({ desde_m: sugerencia.desde_m, hasta_m: Number.NaN, diametro_pulg: 1, material_tuberia: 'PVC' })] });
  }
  agregarFiltro() {
    const sugerencia = sugerirInicioSiguienteIntervalo(this.datos().intervalosFiltro.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), intervalosFiltro: [...this.datos().intervalosFiltro, this.local<IntervaloFiltroBody>({ desde_m: sugerencia.desde_m, hasta_m: Number.NaN, diametro_pulg: 1, material_tuberia: 'PVC' })] });
  }
  agregarAporte() { this.actualizar({ ...this.datos(), nivelesAporte: [...this.datos().nivelesAporte, this.local<NivelAporteBody>({ profundidad_m: 0 })] }); }
  quitarLitologia(id: string) { this.actualizar({ ...this.datos(), intervalosLitologicos: this.datos().intervalosLitologicos.filter((item) => item.idLocal !== id) }); }
  quitarDiametro(id: string) { this.actualizar({ ...this.datos(), intervalosDiametro: this.datos().intervalosDiametro.filter((item) => item.idLocal !== id) }); }
  quitarFiltro(id: string) { this.actualizar({ ...this.datos(), intervalosFiltro: this.datos().intervalosFiltro.filter((item) => item.idLocal !== id) }); }
  quitarAporte(id: string) { this.actualizar({ ...this.datos(), nivelesAporte: this.datos().nivelesAporte.filter((item) => item.idLocal !== id) }); }
  notificarEdicion() { this.actualizar(this.datos()); }
  errores() { return validarDatosTecnicos(this.datos(), this.profundidad()); }

  private local<T>(dato: T): ElementoBorrador<T> { return { idLocal: `local-${this.siguienteId++}`, dato }; }
  private actualizar(datos: DatosTecnicosBorrador) { const ordenados = ordenarDatosTecnicos(datos); this.datos.set(ordenados); this.cambiado.emit(ordenados); }
}
