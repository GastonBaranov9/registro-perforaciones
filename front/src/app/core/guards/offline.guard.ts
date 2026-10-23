import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OfflineService } from '../native/offline.service';
export const offlineGuard: CanActivateFn = async () => {
  const offline = inject(OfflineService), router = inject(Router);
  await offline.auth.bootstrap();
  try { await offline.owner(); return true; }
  catch { return router.createUrlTree(['/login']); }
};
