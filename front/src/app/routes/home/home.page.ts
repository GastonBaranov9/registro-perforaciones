import { Component, inject } from '@angular/core';
import { IonButton, IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { MainStore } from '../../shared/services/mainstore-service/main.store';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonContent, IonButton],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {
  readonly mainStore = inject(MainStore);
  private readonly router = inject(Router);
  irAAdministracion() { void this.router.navigate(['/litologias-admin']); }
}
