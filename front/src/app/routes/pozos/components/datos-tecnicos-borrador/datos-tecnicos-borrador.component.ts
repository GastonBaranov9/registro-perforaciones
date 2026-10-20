import { afterNextRender, Component, ElementRef, effect, inject, Injector, input, output, signal, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatosTecnicosBorrador, ElementoBorrador, IntervaloDiametroPerforacionBody, IntervaloFiltroBody, IntervaloLitologicoBody, NivelAporteBody } from '../../../../shared/types/schemas';
import { ordenarDatosTecnicos, sugerirInicioSiguienteIntervalo, sugerirIntervaloLitologico, validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
import { SelectorLitologiaComponent } from '../../../../shared/components/selector-litologia/selector-litologia.component';
import { huellaDatosTecnicos } from '../../../../shared/utils/estado-formulario-perforacion';

@Component({
  selector: 'app-datos-tecnicos-borrador',
  imports: [FormsModule, SelectorLitologiaComponent],
  templateUrl: './datos-tecnicos-borrador.component.html',
  styleUrl: './datos-tecnicos-borrador.component.css',
})
export class DatosTecnicosBorradorComponent {
  readonly profundidad = input<number | undefined>();
  readonly guardando = input(false);
  readonly inicial = input<DatosTecnicosBorrador | null>(null);
  readonly versionDescartar = input(0);
  readonly cambiado = output<DatosTecnicosBorrador>();
  readonly estadoSucio = output<boolean>();
  readonly datos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
  private siguienteId = 1;
  private readonly injector = inject(Injector);
  readonly filasDinamicas = viewChildren<ElementRef<HTMLElement>>('filaDinamica');
  readonly dirty = signal(false);
  private baseDatos = huellaDatosTecnicos(this.datos());
  private ultimoInicial: DatosTecnicosBorrador | null = null;
  private ultimaVersionDescartar = 0;
  readonly errorAgregar = signal('');

  constructor() {
    effect(() => {
      const inicial = this.inicial();
      const version = this.versionDescartar();
      const cambioRemoto = inicial !== this.ultimoInicial;
      const descarteConfirmado = version !== this.ultimaVersionDescartar;
      if (!cambioRemoto && !descarteConfirmado) return;
      if (inicial && (!this.dirty() || descarteConfirmado)) {
        this.ultimoInicial = inicial;
        this.ultimaVersionDescartar = version;
        this.datos.set(structuredClone(ordenarDatosTecnicos(inicial)));
        this.baseDatos = huellaDatosTecnicos(this.datos());
        const ids = [...inicial.intervalosLitologicos, ...inicial.intervalosDiametro, ...inicial.intervalosFiltro, ...inicial.nivelesAporte].map(item => Number(String(item.idLocal).replace(/^local-/, ''))).filter(Number.isFinite);
        this.siguienteId = Math.max(this.siguienteId, ...ids.map(id => id + 1));
        this.cambiado.emit(this.datos());
        this.dirty.set(false);
        this.estadoSucio.emit(false);
      }
    });
  }

  agregarLitologia() {
    if (this.guardando()) return;
    const sugerencia = sugerirIntervaloLitologico(this.datos().intervalosLitologicos.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    const nueva = this.local<IntervaloLitologicoBody>({ desde_m: sugerencia.desde_m, hasta_m: sugerencia.hasta_m, material: '' });
    this.actualizar({ ...this.datos(), intervalosLitologicos: [...this.datos().intervalosLitologicos, nueva] });
    this.enfocarNueva(nueva.idLocal);
  }
  agregarSello() {
    if (this.guardando() || this.datos().sello_sanitario_constructivo != null) return;
    this.actualizar({ ...this.datos(), sello_sanitario_constructivo: { desde_m: Number.NaN, hasta_m: Number.NaN } });
    this.enfocarNueva('sello-sanitario');
  }
  quitarSello() {
    if (this.guardando()) return;
    this.actualizar({ ...this.datos(), sello_sanitario_constructivo: null });
  }
  private enfocarNueva(idLocal: string) {
    afterNextRender(() => {
      const fila = this.filasDinamicas().find((ref) => ref.nativeElement.dataset['capa'] === idLocal)?.nativeElement;
      if (!fila || this.guardando()) return;
      fila.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
      fila.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, { injector: this.injector });
  }
  seleccionarLitologia(item: IntervaloLitologicoBody, id: number | null, nombre: string) {
    item.id_litologia = id ?? undefined;
    if (id != null) item.material = nombre;
    this.notificarEdicion();
  }
  provisional(item: IntervaloLitologicoBody, texto: string | null) {
    item.litologia_provisional = texto;
    if (texto != null) { item.id_litologia = undefined; item.material = texto.trim(); }
    this.notificarEdicion();
  }
  agregarDiametro() {
    if (this.guardando()) return;
    const sugerencia = sugerirInicioSiguienteIntervalo(this.datos().intervalosDiametro.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), intervalosDiametro: [...this.datos().intervalosDiametro, this.local<IntervaloDiametroPerforacionBody>({ desde_m: sugerencia.desde_m, hasta_m: Number.NaN, diametro_pulg: 1, material_tuberia: 'PVC' })] });
    this.enfocarNueva(this.datos().intervalosDiametro.at(-1)!.idLocal);
  }
  agregarFiltro() {
    if (this.guardando()) return;
    const sugerencia = sugerirInicioSiguienteIntervalo(this.datos().intervalosFiltro.map((x) => x.dato), this.profundidad());
    if (!sugerencia.permitido) { this.errorAgregar.set(sugerencia.mensaje); return; }
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), intervalosFiltro: [...this.datos().intervalosFiltro, this.local<IntervaloFiltroBody>({ desde_m: sugerencia.desde_m, hasta_m: Number.NaN, diametro_pulg: 1, material_tuberia: 'PVC', ranura_mm: null })] });
    this.enfocarNueva(this.datos().intervalosFiltro.at(-1)!.idLocal);
  }
  agregarAporte() {
    if (this.guardando()) return;
    this.errorAgregar.set('');
    this.actualizar({ ...this.datos(), nivelesAporte: [...this.datos().nivelesAporte, this.local<NivelAporteBody>({ profundidad_m: 0 })] });
    this.enfocarNueva(this.datos().nivelesAporte.at(-1)!.idLocal);
  }
  quitarLitologia(id: string) { this.actualizar({ ...this.datos(), intervalosLitologicos: this.datos().intervalosLitologicos.filter((item) => item.idLocal !== id) }); }
  quitarDiametro(id: string) { this.actualizar({ ...this.datos(), intervalosDiametro: this.datos().intervalosDiametro.filter((item) => item.idLocal !== id) }); }
  quitarFiltro(id: string) { this.actualizar({ ...this.datos(), intervalosFiltro: this.datos().intervalosFiltro.filter((item) => item.idLocal !== id) }); }
  quitarAporte(id: string) { this.actualizar({ ...this.datos(), nivelesAporte: this.datos().nivelesAporte.filter((item) => item.idLocal !== id) }); }
  notificarEdicion() { this.actualizar(this.datos()); }
  errores() { return validarDatosTecnicos(this.datos(), this.profundidad()); }
  puedeConservarRanuraNoEspecificada(item: ElementoBorrador<IntervaloFiltroBody>): boolean {
    return item.dato.id_intervalo_filtro != null
      && (item.ranuraOriginal === null || (item.ranuraOriginal === undefined && item.dato.ranura_mm === null));
  }

  private local<T>(dato: T): ElementoBorrador<T> { return { idLocal: `local-${this.siguienteId++}`, dato }; }
  private actualizar(datos: DatosTecnicosBorrador) {
    // El orden visible es el de incorporación; las validaciones ordenan copias.
    const actualizado = { ...datos };
    this.datos.set(actualizado);
    this.cambiado.emit(actualizado);
    const dirty = huellaDatosTecnicos(actualizado) !== this.baseDatos;
    this.dirty.set(dirty);
    this.estadoSucio.emit(dirty);
  }
}
