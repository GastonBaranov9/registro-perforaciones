import { Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonContent } from '@ionic/angular/standalone';
import { DEPARTAMENTOS_URUGUAY } from '../../../../shared/constants/departamentos-uruguay';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';
import { PerforacionAsociada, PropietarioOperativo } from '../../../../shared/types/schemas';
import { AccesoPersonaComponent } from '../../components/acceso-persona.component';

@Component({
  selector: 'app-propietario-detail',
  standalone: true,
  imports: [DatePipe, FormsModule, IonButton, IonContent, AccesoPersonaComponent],
  templateUrl: './propietario-detail.page.html',
  styleUrl: './propietario-detail.page.css',
})
export class PropietarioDetailPage {
  id_usuario = input.required<number>();
  private readonly propietarios = inject(PropietariosOperativosService);
  private readonly usuarios = inject(UsuariosListService);
  readonly router = inject(Router);
  readonly departamentos = DEPARTAMENTOS_URUGUAY;
  propietario = signal<PropietarioOperativo | null>(null);
  perforaciones = signal<PerforacionAsociada[]>([]);
  total = signal(0);
  offset = signal(0);
  error = signal('');
  mensaje = signal('');
  ocupado = signal(false);

  async ionViewWillEnter() {
    this.error.set('');
    try {
      const [persona, pozos] = await Promise.all([
        this.propietarios.obtener(this.id_usuario()), this.usuarios.perforacionesDe(this.id_usuario()),
      ]);
      this.propietario.set(persona);
      this.perforaciones.set(pozos.perforaciones);
      this.total.set(pozos.total);
    } catch { this.error.set('No se pudo cargar la ficha del propietario.'); }
  }

  async guardar() {
    const persona = this.propietario();
    if (!persona || this.ocupado()) return;
    this.ocupado.set(true); this.error.set(''); this.mensaje.set('');
    try {
      const actualizado = await this.propietarios.actualizar(this.id_usuario(), {
        nombre: persona.nombre, documento_rut: persona.documento_rut,
        telefono: persona.telefono, email: persona.email, direccion: persona.direccion,
        localidad: persona.localidad, departamento: persona.departamento,
        observaciones: persona.observaciones,
      });
      this.propietario.set(actualizado);
      this.mensaje.set('Datos del propietario guardados.');
    } catch { this.error.set('No se pudieron guardar los datos del propietario.'); }
    finally { this.ocupado.set(false); }
  }

  async pagina(delta: number) {
    this.offset.set(Math.max(0, this.offset() + delta));
    try {
      const pozos = await this.usuarios.perforacionesDe(this.id_usuario(), this.offset());
      this.perforaciones.set(pozos.perforaciones); this.total.set(pozos.total);
    } catch { this.error.set('No se pudo cargar esta página de perforaciones.'); }
  }
}
