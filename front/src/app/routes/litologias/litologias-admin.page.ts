import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonItem, IonLabel } from '@ionic/angular/standalone';
import { familiasLitologia, LitologiaActualizarBody, LitologiaCrearBody, LitologiaPublica, patronesLitologia } from '../../shared/types/schemas';
import { LitologiasService } from '../../shared/services/litologias.service';
import { especificacionPatron, type PatronCatalogo } from '../../shared/canonical/litologia-patrones';

type Formulario = LitologiaCrearBody & { activo?: boolean };

@Component({
  selector: 'app-litologias-admin',
  standalone: true,
  imports: [FormsModule, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonLabel, IonButton],
  templateUrl: './litologias-admin.page.html',
  styleUrl: './litologias-admin.page.css',
})
export class LitologiasAdminPage {
  readonly service = inject(LitologiasService);
  readonly litologias = signal<LitologiaPublica[]>([]);
  readonly busqueda = signal('');
  readonly familia = signal('');
  readonly estado = signal('todas');
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly guardando = signal(false);
  readonly formulario = signal<Formulario>(this.vacio());
  readonly editando = signal<number | null>(null);
  readonly familias = familiasLitologia;
  readonly patrones = patronesLitologia;

  constructor() { void this.cargar(); }

  filtradas(): LitologiaPublica[] {
    const texto = this.busqueda().trim().toLocaleLowerCase();
    return this.litologias().filter((x) => (!texto || `${x.nombre} ${x.codigo}`.toLocaleLowerCase().includes(texto)) && (!this.familia() || x.familia === this.familia()) && (this.estado() === 'todas' || (this.estado() === 'activas' ? x.activo : !x.activo)));
  }

  editar(litologia: LitologiaPublica) {
    this.editando.set(litologia.id_litologia);
    this.formulario.set({ codigo: litologia.codigo, nombre: litologia.nombre, familia: litologia.familia, color: litologia.color, patron: litologia.patron, orden: litologia.orden, activo: litologia.activo });
  }
  nuevo() { this.editando.set(null); this.formulario.set(this.vacio()); }
  async guardar() {
    try {
      this.guardando.set(true); this.error.set('');
      const id = this.editando();
      if (id == null) await this.service.crear(this.formulario());
      else { const { codigo: _codigo, activo: _activo, ...body } = this.formulario(); void _codigo; void _activo; await this.service.actualizar(id, body as LitologiaActualizarBody); }
      this.nuevo(); await this.cargar();
    } catch (e: unknown) { this.error.set(this.mensaje(e)); }
    finally { this.guardando.set(false); }
  }
  async cambiarEstado(litologia: LitologiaPublica) {
    try { this.error.set(''); await (litologia.activo ? this.service.desactivar(litologia.id_litologia) : this.service.activar(litologia.id_litologia)); await this.cargar(); }
    catch (e: unknown) { this.error.set(this.mensaje(e)); }
  }
  async cargar() {
    this.cargando.set(true); this.error.set('');
    try { this.litologias.set(await this.service.listar(true)); }
    catch (e: unknown) { this.error.set(this.mensaje(e)); }
    finally { this.cargando.set(false); }
  }
  actualizarCampo<K extends keyof Formulario>(campo: K, valor: Formulario[K]) { this.formulario.update((f) => ({ ...f, [campo]: campo === 'color' && typeof valor === 'string' ? valor.toUpperCase() as Formulario[K] : valor })); }
  actualizarOrden(valor: string) { this.actualizarCampo('orden', Number(valor)); }
  patronSpec(patron: PatronCatalogo) { return especificacionPatron(patron); }
  patronForma(patron: PatronCatalogo) { return especificacionPatron(patron).forma; }
  private vacio(): Formulario { return { codigo: '', nombre: '', familia: 'otro', color: '#6B625A', patron: 'granite', orden: 0 }; }
  private mensaje(e: unknown): string { const x = e as { error?: { message?: string }; message?: string }; return x.error?.message ?? x.message ?? 'No se pudo completar la operación.'; }
}
