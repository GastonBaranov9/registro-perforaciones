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
    const texto = this.busqueda().trim().toLocaleLowerCase();
    return this.opciones().filter((x) => !texto || `${x.nombre} ${x.familia}`.toLocaleLowerCase().includes(texto));
  }

  async reintentar() { await this.cargar(this.seleccionado()); }

  seleccionar(valor: string) {
    const id = valor ? Number(valor) : null;
    this.seleccionadoChange.emit(id);
    const opcion = this.opciones().find((x) => x.id_litologia === id);
    if (opcion) this.nombreChange.emit(opcion.nombre);
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
