import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonCard, IonCardContent, IonContent } from '@ionic/angular/standalone';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';
import { PersonaAdministrada } from '../../../../shared/types/schemas';

@Component({
  selector: 'app-usuarios-list',
  imports: [FormsModule, IonButton, IonCard, IonCardContent, IonContent],
  templateUrl: './usuarios-list.page.html',
  styleUrl: './usuarios-list.page.css',
})
export class UsuariosListPage {
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
