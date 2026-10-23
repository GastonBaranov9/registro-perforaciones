import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent } from '@ionic/angular/standalone';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';
import { PersonaAdministrada } from '../../../../shared/types/schemas';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { AccesoPersonaComponent } from '../../components/acceso-persona.component';

@Component({
  selector: 'app-usuarios-list',
  imports: [FormsModule, IonButton, IonCard, IonCardContent, IonContent, AccesoPersonaComponent],
  templateUrl: './usuarios-list.page.html',
  styleUrl: './usuarios-list.page.css',
})
export class UsuariosListPage {
  readonly auth = inject(AuthService);
  async eliminarIdentidad(persona: PersonaAdministrada) {
    if (!this.auth.tieneRol('administracion') || persona.cuenta_acceso || this.cargando()) return;
    if (!window.confirm(`Eliminar definitivamente la identidad ${persona.nombre} (ID ${persona.id_usuario}). El servidor solo lo permitirá si no tiene historial empresarial ni dependencias. ¿Confirmar?`)) return;
    this.cargando.set(true);
    try { await this.servicio.eliminarIdentidad(persona.id_usuario); await this.cargar(); }
    catch (e: any) { this.error.set(e?.error?.message || 'No se pudo eliminar la identidad. Sus datos se conservan.'); }
    finally { this.cargando.set(false); }
  }
  async eliminar(persona: PersonaAdministrada) {
    if (!this.auth.tieneRol('administracion') || this.cargando()) return;
    if (!window.confirm(`Eliminar el acceso de ${persona.nombre} (ID ${persona.id_usuario}) revocará sus sesiones, quitará sus credenciales e impedirá nuevos ingresos y sincronizaciones. La identidad, perforaciones, fotos y números se conservan. ¿Confirmar?`)) return;
    this.cargando.set(true);
    try { await this.servicio.deleteUsuario(persona.id_usuario); await this.cargar(); }
    catch { this.error.set('No se pudo eliminar el acceso. Compruebe la conexión y vuelva a consultar su estado.'); }
    finally { this.cargando.set(false); }
  }
  private readonly servicio = inject(UsuariosListService);
  private readonly router = inject(Router);
  personas = signal<PersonaAdministrada[]>([]);
  total = signal(0);
  offset = signal(0);
  cargando = signal(false);
  error = signal('');
  busqueda = '';
  private termino = '';

  async ionViewWillEnter() { await this.cargar(); }

  async buscar() {
    this.termino = this.busqueda.trim();
    this.offset.set(0);
    await this.cargar();
  }

  async pagina(delta: number) {
    this.offset.set(Math.max(0, this.offset() + delta));
    await this.cargar();
  }

  private async cargar() {
    this.cargando.set(true); this.error.set('');
    try {
      const respuesta = await this.servicio.buscarPersonas(this.termino, this.offset());
      this.personas.set(respuesta.personas);
      this.total.set(respuesta.total);
    } catch {
      this.error.set('No se pudo consultar el registro de personas.');
    } finally { this.cargando.set(false); }
  }

  abrir(persona: PersonaAdministrada) {
    this.router.navigate(persona.roles.includes('propietario')
      ? ['/propietarios-detail', persona.id_usuario]
      : ['/usuarios-edit', persona.id_usuario]);
  }

  editarCuenta(persona: PersonaAdministrada) {
    this.router.navigate(['/usuarios-edit', persona.id_usuario]);
  }
}
