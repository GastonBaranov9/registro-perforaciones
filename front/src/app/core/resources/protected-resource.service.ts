import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  isWebApiRequest,
  NativeBackendConfigService,
} from '../native/native-backend-config.service';
import {
  RuntimePlatformService,
  RuntimePlatformUnknownError,
} from '../native/runtime-platform.service';

export interface ProtectedResourceHandle {
  readonly url: string;
  revoke(): void;
}

export class ProtectedResourceUrlError extends Error {
  constructor() {
    super('El recurso protegido solicitado no pertenece a la API autorizada.');
    this.name = 'ProtectedResourceUrlError';
  }
}

@Injectable({ providedIn: 'root' })
export class ProtectedResourceService {
  private readonly http = inject(HttpClient);
  private readonly runtime = inject(RuntimePlatformService);
  private readonly backend = inject(NativeBackendConfigService);

  load(rawUrl: string): Observable<ProtectedResourceHandle> {
    switch (this.runtime.platform()) {
      case 'web':
        return isWebApiRequest(rawUrl, environment.apiURL)
          ? of({ url: rawUrl, revoke: () => undefined })
          : throwError(() => new ProtectedResourceUrlError());
      case 'android':
      case 'ios':
        if (!this.backend.isAuthorizedApiRequest(rawUrl)) {
          return throwError(() => new ProtectedResourceUrlError());
        }
        return this.http.get(rawUrl, { responseType: 'blob' }).pipe(
          map((blob) => {
            const objectUrl = URL.createObjectURL(blob);
            let revoked = false;
            return {
              url: objectUrl,
              revoke: () => {
                if (revoked) return;
                revoked = true;
                URL.revokeObjectURL(objectUrl);
              },
            };
          }),
        );
      case 'unknown':
        return throwError(() => new RuntimePlatformUnknownError());
    }
  }
}
