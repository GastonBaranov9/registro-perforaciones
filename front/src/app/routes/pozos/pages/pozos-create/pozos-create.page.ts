import { Component, DestroyRef, inject, signal, ViewChild } from '@angular/core';
import { huellaFormulario } from '../../../../shared/utils/estado-formulario-perforacion';
import { PozosCreateService } from '../../../../shared/services/pozos-create.service';
import { Router } from '@angular/router';
import { AccionFotoEdicion, CatalogosPersonasPozo, DatosTecnicosBorrador, NuevoPozo, PropietarioOperativoActualizarBody, PropietarioOperativoCrearBody, SitioBody } from '../../../../shared/types/schemas';
import {
  IonContent,
  IonCard,
  IonCardContent,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
} from '@ionic/angular/standalone';
import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { DATOS_TECNICOS_ESTANDAR } from '../../../../shared/constants/datos-tecnicos-estandar';
@Component({
  selector: 'app-pozos-create',
  imports: [
    IonContent,
    IonCard,
    IonCardContent,
    PozosFormComponent,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    DatosTecnicosBorradorComponent,
  ],
  templateUrl: './pozos-create.page.html',
  styleUrl: './pozos-create.page.css',
})
export class PozosCreatePage {
  public createService: PozosCreateService = inject(PozosCreateService);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  readonly creado = signal<{ id: number; numero?: number } | null>(null);
  public candidatosService = inject(CandidatosPozoService);
  public authService = inject(AuthService);
  public propietariosOperativos = inject(PropietariosOperativosService);
  buscarPropietarios = (texto: string) => this.candidatosService.buscar('propietario', texto);
  buscarPerforadores = (texto: string) => this.candidatosService.buscar('perforador', texto);
  public sitioNuevo = signal<SitioBody>({ departamento: '', localidad: '', latitud: '', longitud: '' });
  public catalogos = signal<CatalogosPersonasPozo | null>(null);
  public cargandoCatalogos = signal(true);
  public datosTecnicos = signal<DatosTecnicosBorrador>({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });

  public nuevoPozo = signal<NuevoPozo>({
    id_propietario: null,
    id_sitio: 0,
    id_perforador: 0,
    ...DATOS_TECNICOS_ESTANDAR,
  });

  @ViewChild(PozosFormComponent) formulario?: PozosFormComponent;
  private baseFormulario = this.huellaActual();
  private fotoGuardada: File | null = null;
  private readonly destroyRef = inject(DestroyRef);

  private huellaActual() { return huellaFormulario(this.nuevoPozo(), this.sitioNuevo(), this.datosTecnicos()); }
  tieneCambiosSinGuardar(): boolean {
    return this.huellaActual() !== this.baseFormulario
      || (this.formulario?.fotoFile ?? null) !== this.fotoGuardada
      || !!this.formulario?.eliminarFotoPendiente()
      || !!this.formulario?.tieneCambiosPropietario();
  }

  async ionViewWillEnter() {
    if (this.authService.isNative() && this.authService.tieneAlcancePerforador() && !this.authService.puedeOperarTodosLosPozos()) {
      await this.router.navigateByUrl('/trabajo-local'); return;
    }
    if (!this.catalogos()) await this.cargarCatalogos();
  }

  async cargarCatalogos() {
    try {
      this.cargandoCatalogos.set(true); this.errorMessage.set('');
      const catalogos = await this.candidatosService.obtener();
      this.catalogos.set(catalogos);
      const autenticado = this.authService.userId();
      const predeterminado = catalogos.perforadores.find((p) => p.id_usuario === autenticado)?.id_usuario ?? (catalogos.perforadores.length === 1 ? catalogos.perforadores[0].id_usuario : 0);
      if (predeterminado) this.nuevoPozo.update((p) => ({ ...p, id_perforador: predeterminado }));
      this.baseFormulario = this.huellaActual();
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudieron cargar las personas.'); }
    finally { this.cargandoCatalogos.set(false); }
  }

  async guardarPozo(data: { pozo: NuevoPozo; foto: File | null; fotoAccion?: AccionFotoEdicion }) {
    if (this.disabled()) return;
    if (this.creado()) { await this.verCreado(); return; }
    if (this.formulario?.capturaPendiente()) {
      this.errorMessage.set('Esperá a que termine la captura de ubicación o fotografía antes de guardar.'); return;
    }
    if (this.formulario?.tieneCambiosPropietario()) {
      this.errorMessage.set('Guardá o revertí los cambios del propietario antes de crear la perforación.'); return;
    }
    const id_usuario = data.pozo.id_propietario ?? this.authService.userId()!;
    const errores = validarDatosTecnicos(this.datosTecnicos(), data.pozo.profundidad_final_m);
    if (errores.length) {
      this.errorMessage.set(errores.join(' '));
      return;
    }

    try {
      this.disabled.set(true);
      this.errorMessage.set('');
      const enviado = structuredClone({ pozo: data.pozo, sitio: this.sitioNuevo(), tecnicos: this.datosTecnicos() });
      const fotoEnviada = data.foto;
      const rutaAlEnviar = this.router.url;
      const baseEnviada = huellaFormulario(enviado.pozo, enviado.sitio, enviado.tecnicos);
      const resultado = await this.createService.createPozoCompleto(id_usuario, enviado.pozo, enviado.sitio, enviado.tecnicos, fotoEnviada);
      this.creado.set({ id: resultado.pozo.id_pozo, numero: resultado.pozo.numero_perforacion ?? undefined });
      this.baseFormulario = baseEnviada;
      this.fotoGuardada = fotoEnviada;
      if (!this.destroyRef.destroyed && this.router.url === rutaAlEnviar) {
        // Retirar el alta confirmada de la pila de Ionic: volver a Crear debe
        // construir otra instancia, no recuperar una pantalla ya finalizada.
        await this.router.navigate(['/pozos-detail', resultado.pozo.id_pozo], { replaceUrl: true });
      }
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear la perforación.');
    } finally {
      this.disabled.set(false);
    }
  }
  async verCreado() {
    const creado = this.creado();
    if (!creado || this.destroyRef.destroyed) return;
    await this.router.navigate(['/pozos-detail', creado.id], { replaceUrl: true });
  }
  irAtras() {
    this.router.navigate([`pozo`]);
  }

  async crearPropietario(data: PropietarioOperativoCrearBody) {
    if (this.creado()) return;
    if (!this.authService.tieneRol('administracion') || this.disabled()) return;
    try {
      this.errorMessage.set(''); this.disabled.set(true);
      const enviado = { ...data };
      const formulario = this.formulario;
      const creado = await this.propietariosOperativos.crear(enviado);
      formulario?.confirmarPropietarioCreado(enviado);
      this.catalogos.update((actual) => actual ? { ...actual, propietarios: [creado, ...actual.propietarios] } : actual);
      this.nuevoPozo.update((pozo) => ({ ...pozo, id_propietario: creado.id_usuario, propietario_provisional: null }));
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear el propietario.');
    } finally { this.disabled.set(false); }
  }
  async actualizarPropietario(evento: { id: number; body: PropietarioOperativoActualizarBody }) {
    if (this.creado() || this.disabled()) return;
    try {
      this.errorMessage.set(''); this.disabled.set(true);
      const enviado = { ...evento.body };
      const formulario = this.formulario;
      const actualizado = await this.propietariosOperativos.actualizar(evento.id, enviado);
      formulario?.confirmarPropietarioActualizado(evento.id, enviado);
      this.catalogos.update((actual) => actual ? { ...actual, propietarios: actual.propietarios.map((p) => p.id_usuario === evento.id ? { ...p, ...actualizado, roles: p.roles } : p) } : actual);
    } catch (error: unknown) { this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo actualizar el propietario.'); }
    finally { this.disabled.set(false); }
  }
}
