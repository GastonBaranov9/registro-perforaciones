import { Component, effect, inject, OnDestroy, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import {
  IonApp,
  IonRouterLink,
  IonRouterOutlet,
  IonToolbar,
  IonTitle,
  IonHeader,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonMenu,
  IonBackButton,
  IonList,
  IonItem,
  IonMenuToggle,
  IonLabel,
  IonButton,
  IonIcon,
} from '@ionic/angular/standalone';
import { MainStore } from './shared/services/mainstore-service/main.store';
import { WebsocketService } from './shared/services/websocket.service';
import { AuthService } from './shared/services/auth-service/auth.service';


@Component({
  selector: 'app-root',
  imports: [
    IonRouterOutlet,
    IonContent,
    IonApp,
    IonTitle,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonList,
    IonMenuToggle,
    IonItem,
    RouterLink,
    IonButton,
    IonLabel,
    IonMenuButton,
    IonMenu,
    IonBackButton
],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  protected readonly title = signal('front');
  public mainStore = inject(MainStore);
  public webSocketService = inject(WebsocketService);
  public authService = inject(AuthService);

  public wsConnection = effect(() => {
    if (this.authService.isWeb() && this.mainStore.user()) {
      this.webSocketService.connect();
    } else this.webSocketService.disconnect();
  });

  ngOnDestroy(): void {
    this.webSocketService.disconnect();
  }
}
