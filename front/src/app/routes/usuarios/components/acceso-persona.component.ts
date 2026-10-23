import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../shared/services/auth-service/auth.service';

@Component({
  selector: 'app-acceso-persona', imports: [FormsModule],
  template: `@if (auth.tieneRol('administracion')) {
    <details><summary>Crear acceso al sistema</summary>
      <p>Cuenta de acceso / permisos. Se activará el rol Propietario para esta identidad. El email de contacto se administra por separado.</p>
      <label>Email de acceso <input type="email" [(ngModel)]="email" autocomplete="off" /></label>
      <label>Contraseña inicial <input type="password" [(ngModel)]="password" autocomplete="new-password" /></label>
      <label>Confirmar contraseña <input type="password" [(ngModel)]="confirmar" autocomplete="new-password" /></label>
      <button type="button" (click)="crear()" [disabled]="ocupado()">Activar acceso de Propietario</button>
      @if (error()) { <p role="alert">{{ error() }}</p> }
    </details>
  }`,
  styles: ['label { display:block; margin-block:.5rem; } input { display:block; min-height:44px; width:100%; } button { min-height:44px; }'],
})
export class AccesoPersonaComponent {
  id = input.required<number>(); creado = output<void>();
  readonly auth = inject(AuthService);
  private http = inject(HttpClient);
  email = ''; password = ''; confirmar = '';
  error = signal(''); ocupado = signal(false);
  async crear() {
    if (!this.auth.tieneRol('administracion') || this.ocupado()) return;
    if (this.password !== this.confirmar || this.password.length < 8) { this.error.set('Confirme una contraseña de al menos 8 caracteres.'); return; }
    this.ocupado.set(true); this.error.set('');
    try {
      await firstValueFrom(this.http.post(`${environment.apiURL}usuarios/personas/${this.id()}/acceso`, { email: this.email, password: this.password, confirmar: this.confirmar }));
      this.creado.emit();
    } catch (e: any) { this.error.set(e?.error?.message || 'No se pudo crear el acceso. Compruebe la conexión y el email.'); }
    finally { this.password = ''; this.confirmar = ''; this.ocupado.set(false); }
  }
}
