import { Component, inject, output, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { IonInput, IonLabel, IonButton, IonContent } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-login',
  imports: [IonInput, FormsModule, IonButton, IonContent, IonLabel],
  templateUrl: './login.page.html',
  styleUrl: './login.page.css',
})
export class LoginPage {
  private authService = inject(AuthService);
  private toastController = inject(ToastController);
  private router = inject(Router);
  public disabled = signal<boolean>(false);
  private ruta = inject(ActivatedRoute);
  public credenciales = {
    email: '',
    password: '',
  };

  public async logIn(email: string, password: string) {
    try {
      await this.authService.logged(email, password);
      const redirectTo = this.ruta.snapshot.queryParamMap.get('redirectTo');

      if (redirectTo) {
        this.router.navigate([redirectTo]);
      } else {
        this.router.navigate(['/home']);
      }
    } catch (err: any) {
        const toast = await this.toastController.create({
          message: err.message,
          duration: 1000,
          position: 'bottom',
          color: 'danger',
          animated: true

      
        });

        await toast.present();

    }
  }
}
