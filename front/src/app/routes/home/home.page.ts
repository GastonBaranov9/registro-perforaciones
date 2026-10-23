import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { LitologiasService } from '../../shared/services/litologias.service';
import { IonContent } from '@ionic/angular/standalone';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonContent, RouterLink],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {
  readonly auth = inject(AuthService);
  private catalogo = inject(LitologiasService);
  ionViewWillEnter() {
    if (this.auth.isNative() && this.auth.tieneRol('perforador')) void this.catalogo.listar().catch(() => undefined);
  }
}
