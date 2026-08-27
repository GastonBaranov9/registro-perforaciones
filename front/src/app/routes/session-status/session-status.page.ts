import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonContent, IonSpinner } from '@ionic/angular/standalone';
import { AuthService } from '../../shared/services/auth-service/auth.service';

@Component({
  selector: 'app-session-status',
  imports: [IonButton, IonContent, IonSpinner],
  templateUrl: './session-status.page.html',
  styleUrl: './session-status.page.css',
})
export class SessionStatusPage {
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  reason(): string {
    return (
      this.route.snapshot.data['reason'] ??
      this.route.snapshot.queryParamMap.get('reason') ??
      this.auth.state()
    );
  }

  async retry(): Promise<void> {
    if (this.auth.state() === 'logout-pending') await this.auth.logout();
    else await this.auth.getUser().catch(() => undefined);

    if (this.auth.state() === 'authenticated') await this.router.navigateByUrl('/home');
    if (this.auth.state() === 'unauthenticated') await this.router.navigateByUrl('/login');
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    if (this.auth.state() === 'unauthenticated') await this.router.navigateByUrl('/login');
  }
}
