import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { IonInput, IonLabel, IonButton, IonContent } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  imports: [IonInput, FormsModule, IonButton, IonContent, IonLabel],
  templateUrl: './login.page.html',
  styleUrl: './login.page.css',
})
export class LoginPage {
  private authService = inject(AuthService);
  private router = inject(Router);
  public disabled = signal<boolean>(false);
  public error = signal('');
  private ruta = inject(ActivatedRoute);
  public credenciales = {
    email: '',
    password: '',
  };

  public async logIn(email: string, password: string) {
    if (this.disabled()) return;
    this.error.set('');
    this.disabled.set(true);
    try {
      await this.authService.logged(email, password);
      this.credenciales.password = '';
      const redirectTo = this.ruta.snapshot.queryParamMap.get('redirectTo');

      if (redirectTo) {
        await this.router.navigateByUrl(redirectTo);
      } else {
        await this.router.navigate(['/home']);
      }
    } catch (err: unknown) {
      const mensajes = [
        'Email o contraseña incorrectas',
        'Sin conexión. No fue posible iniciar sesión.',
        'Debes actualizar la aplicación para continuar.',
      ];
      this.error.set(err instanceof Error && mensajes.includes(err.message)
        ? err.message : 'No se pudo iniciar sesión. Intentá nuevamente.');
    } finally {
      this.disabled.set(false);
    }
  }
}
