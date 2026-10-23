import { ChangeDetectorRef, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LitologiaPublica } from '../../types/schemas';
import { LitologiasService } from '../../services/litologias.service';
import { DialogosFormularioService } from '../../../core/guards/cambios-perforacion.guard';

@Component({
  selector: 'app-selector-litologia',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
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
  readonly provisional = input<string | null | undefined>(null);
  readonly permitirProvisional = input(true);
  readonly provisionalChange = output<string | null>();
  readonly modoProvisional = signal(false);

  usarProvisional() {
    if (this.deshabilitado()) return;
    this.modoProvisional.set(true);
    this.seleccionadoChange.emit(null);
    this.provisionalChange.emit(this.provisional() ?? '');
    this.cerrarLista();
  }
  escribirProvisional(texto: string) {
    this.provisionalChange.emit(texto);
  }
  readonly opciones = signal<LitologiaPublica[]>([]);
  readonly busqueda = signal('');
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly seleccionada = computed(() => this.opciones().find((x) => x.id_litologia === this.seleccionado()) ?? null);
  private readonly service = inject(LitologiasService);
  private readonly dialogos = inject(DialogosFormularioService);
  private desregistrarDialogo?: () => void;
  private pagina?: HTMLElement;
  private readonly alSalirDePagina = () => this.cerrarLista();
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly mediaMovil = window.matchMedia('(max-width: 767px), (pointer: coarse)');
  readonly movil = signal(this.mediaMovil.matches);
  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');
  private ultimoId: number | null | undefined;
  private yaCargo = false;

  constructor() {
    const viewport = window.visualViewport;
    const ajustar = () => this.ajustarDialogo();
    const cambiarModo = () => {
      this.cerrarLista();
      this.movil.set(this.mediaMovil.matches);
    };
    this.mediaMovil.addEventListener('change', cambiarModo);
    viewport?.addEventListener('resize', ajustar);
    viewport?.addEventListener('scroll', ajustar);
    window.addEventListener('resize', ajustar);
    inject(DestroyRef).onDestroy(() => {
      this.cerrarLista();
      this.mediaMovil.removeEventListener('change', cambiarModo);
      viewport?.removeEventListener('resize', ajustar);
      viewport?.removeEventListener('scroll', ajustar);
      window.removeEventListener('resize', ajustar);
    });
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

  abrirMovil() {
    if (this.deshabilitado() || this.cargando()) return;
    this.abierto.set(true);
    this.changeDetector.detectChanges();
    const dialogo = this.dialogo()!.nativeElement;
    // La capa superior evita que ion-content o las tarjetas recorten las opciones.
    this.ajustarDialogo();
    dialogo.showModal();
    this.desregistrarDialogo?.();
    this.desregistrarDialogo = this.dialogos.registrar(() => this.cerrarLista());
    // Ionic conserva páginas sin destruir sus componentes. El evento se emite
    // sobre la página, no sobre sus hijos, y también ocurre en rutas sin guard.
    this.pagina = (this.host.nativeElement as HTMLElement).closest<HTMLElement>('.ion-page') ?? undefined;
    this.pagina?.addEventListener('ionViewWillLeave', this.alSalirDePagina);
    dialogo.querySelector('input')?.focus({ preventScroll: true });
  }

  cerrarLista() {
    this.desregistrarDialogo?.();
    this.desregistrarDialogo = undefined;
    this.pagina?.removeEventListener('ionViewWillLeave', this.alSalirDePagina);
    this.pagina = undefined;
    this.abierto.set(false);
    this.indiceActivo.set(-1);
    const dialogo = this.dialogo()?.nativeElement;
    if (dialogo?.open) dialogo.close();
  }

  alCerrarDialogo() {
    // Un close encolado de la apertura anterior no debe cerrar la nueva.
    if (!this.dialogo()?.nativeElement.open) this.cerrarLista();
  }

  @HostListener('document:ionBackButton', ['$event'])
  atrasAndroid(event: Event) {
    if (this.dialogo()?.nativeElement.open) {
      // Por encima de overlays (100) y navegación (0), sin continuar la cadena.
      const atras = event as CustomEvent<{ register: (prioridad: number, handler: () => void) => void }>;
      atras.detail.register(101, () => this.cerrarLista());
    }
  }

  private ajustarDialogo() {
    const dialogo = this.dialogo()?.nativeElement;
    if (!this.movil() || !this.abierto() || !dialogo) return;
    const viewport = window.visualViewport;
    // El teclado puede reducir sólo el viewport visual, sin cambiar el layout.
    Object.assign(dialogo.style, {
      top: `${(viewport?.offsetTop ?? 0) + 8}px`,
      left: `${(viewport?.offsetLeft ?? 0) + 8}px`,
      width: `${(viewport?.width ?? window.innerWidth) - 16}px`,
      height: `${(viewport?.height ?? window.innerHeight) - 16}px`,
    });
  }

  cerrar(event: FocusEvent) {
    // Ocultar el teclado suele generar focusout sin un nuevo elemento enfocado.
    if (!this.movil() && event.relatedTarget && !this.host.nativeElement.contains(event.relatedTarget as Node)) this.cerrarLista();
  }

  @HostListener('document:pointerdown', ['$event'])
  pulsarFuera(event: PointerEvent) {
    if (!this.movil() && this.abierto() && !this.host.nativeElement.contains(event.target as Node)) this.cerrarLista();
  }
  teclado(event: KeyboardEvent) {
    const opciones = this.opcionesFiltradas();
    if (event.key === 'Escape') {
      if (this.movil()) (event.target as HTMLElement | null)?.blur();
      else this.cerrarLista();
      event.preventDefault();
    }
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
    if (opcion) { this.modoProvisional.set(false); this.provisionalChange.emit(null); }
    if (opcion) this.nombreChange.emit(opcion.nombre);
    this.busqueda.set(''); this.cerrarLista();
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
