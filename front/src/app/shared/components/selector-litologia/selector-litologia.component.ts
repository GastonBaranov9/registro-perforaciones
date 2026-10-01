import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LitologiaPublica } from '../../types/schemas';
import { LitologiasService } from '../../services/litologias.service';

@Component({
  selector: 'app-selector-litologia',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './selector-litologia.component.html',
  styleUrl: './selector-litologia.component.css',
})
export class SelectorLitologiaComponent {
  private static siguienteId = 0;
  readonly listaId = 'litologias-' + (++SelectorLitologiaComponent.siguienteId);
  readonly abierto = signal(false);
  readonly indiceActivo = signal(-1);
  readonly seleccionado = input<number | null | undefined>(null);
  readonly materialHistorico = input('');
  readonly deshabilitado = input(false);
  readonly requerirSeleccion = input(false);
  readonly seleccionadoChange = output<number | null>();
  readonly nombreChange = output<string>();
  readonly opciones = signal<LitologiaPublica[]>([]);
  readonly busqueda = signal('');
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly seleccionada = computed(() => this.opciones().find((x) => x.id_litologia === this.seleccionado()) ?? null);
  private readonly service = inject(LitologiasService);
  private ultimoId: number | null | undefined;
  private yaCargo = false;

  constructor() {
    effect(() => {
      const id = this.seleccionado();
      if (!this.yaCargo || id !== this.ultimoId) { this.ultimoId = id; this.yaCargo = true; void this.cargar(id); }
    });
  }

  opcionesFiltradas(): LitologiaPublica[] {
    const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/_/g, ' ').trim();
    const texto = normalizar(this.busqueda());
    return this.opciones().filter((x) => (x.activo || x.id_litologia === this.seleccionado()) && (!texto || normalizar(x.nombre + ' ' + x.familia).includes(texto)));
  }

  async reintentar() { await this.cargar(this.seleccionado()); }

  buscar(texto: string) { this.busqueda.set(texto); this.abierto.set(true); this.indiceActivo.set(-1); }
  cerrar(event: FocusEvent) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.abierto.set(false);
  }
  teclado(event: KeyboardEvent) {
    const opciones = this.opcionesFiltradas();
    if (event.key === 'Escape') { this.abierto.set(false); event.preventDefault(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); this.abierto.set(true);
      const paso = event.key === 'ArrowDown' ? 1 : -1;
      this.indiceActivo.set(opciones.length ? (this.indiceActivo() < 0 ? (paso > 0 ? 0 : opciones.length - 1) : (this.indiceActivo() + paso + opciones.length) % opciones.length) : -1);
      requestAnimationFrame(() => document.getElementById(this.listaId + '-' + this.indiceActivo())?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' && this.abierto()) {
      event.preventDefault();
      const opcion = opciones[this.indiceActivo()] ?? (opciones.length === 1 ? opciones[0] : undefined);
      if (opcion) this.seleccionar(String(opcion.id_litologia));
    }
  }

  seleccionar(valor: string) {
    if (this.deshabilitado()) return;
    const id = valor ? Number(valor) : null;
    const opcion = this.opciones().find((x) => x.id_litologia === id);
    if (id != null && (!opcion || (!opcion.activo && id !== this.seleccionado()))) return;
    this.seleccionadoChange.emit(id);
    if (opcion) this.nombreChange.emit(opcion.nombre);
    this.busqueda.set(''); this.abierto.set(false); this.indiceActivo.set(-1);
  }

  private async cargar(id: number | null | undefined) {
    this.cargando.set(true); this.error.set('');
    try {
      const activas = await this.service.listar();
      if (id == null || activas.some((x) => x.id_litologia === id)) this.opciones.set(activas);
      else {
        const historica = await this.service.obtener(id);
        this.opciones.set([...activas, historica]);
      }
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las litologías.');
      this.opciones.set([]);
    } finally { this.cargando.set(false); }
  }
}
