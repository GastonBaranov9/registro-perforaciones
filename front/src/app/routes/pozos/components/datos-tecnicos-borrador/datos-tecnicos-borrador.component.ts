import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatosTecnicosBorrador, ElementoBorrador, IntervaloDiametroPerforacionBody, IntervaloLitologicoBody, NivelAporteBody } from '../../../../shared/types/schemas';
import { ordenarDatosTecnicos, validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';

@Component({
  selector: 'app-datos-tecnicos-borrador',
  imports: [FormsModule],
  templateUrl: './datos-tecnicos-borrador.component.html',
  styleUrl: './datos-tecnicos-borrador.component.css',
})
export class DatosTecnicosBorradorComponent {
  readonly profundidad = input<number | undefined>();
  readonly guardando = input(false);
  readonly cambiado = output<DatosTecnicosBorrador>();
  readonly datos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], nivelesAporte: [] });
  private siguienteId = 1;

  agregarLitologia() { this.actualizar({ ...this.datos(), intervalosLitologicos: [...this.datos().intervalosLitologicos, this.local<IntervaloLitologicoBody>({ desde_m: 0, hasta_m: 1, material: '' })] }); }
  agregarDiametro() { this.actualizar({ ...this.datos(), intervalosDiametro: [...this.datos().intervalosDiametro, this.local<IntervaloDiametroPerforacionBody>({ desde_m: 0, hasta_m: 1, diametro_pulg: 1 })] }); }
  agregarAporte() { this.actualizar({ ...this.datos(), nivelesAporte: [...this.datos().nivelesAporte, this.local<NivelAporteBody>({ profundidad_m: 0 })] }); }
  quitarLitologia(id: string) { this.actualizar({ ...this.datos(), intervalosLitologicos: this.datos().intervalosLitologicos.filter((item) => item.idLocal !== id) }); }
  quitarDiametro(id: string) { this.actualizar({ ...this.datos(), intervalosDiametro: this.datos().intervalosDiametro.filter((item) => item.idLocal !== id) }); }
  quitarAporte(id: string) { this.actualizar({ ...this.datos(), nivelesAporte: this.datos().nivelesAporte.filter((item) => item.idLocal !== id) }); }
  notificarEdicion() { this.actualizar(this.datos()); }
  errores() { return validarDatosTecnicos(this.datos(), this.profundidad()); }

  private local<T>(dato: T): ElementoBorrador<T> { return { idLocal: `local-${this.siguienteId++}`, dato }; }
  private actualizar(datos: DatosTecnicosBorrador) { const ordenados = ordenarDatosTecnicos(datos); this.datos.set(ordenados); this.cambiado.emit(ordenados); }
}
