import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PerfilLitologico } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class PerfilLitologicoService {
  private readonly http = inject(HttpClient);

  getPerfil(idUsuario: number, idPozo: number) {
    return firstValueFrom(
      this.http.get<PerfilLitologico | null>(
        `${environment.apiURL}usuarios/${idUsuario}/pozos/${idPozo}/perfil-litologico`,
      ),
    );
  }
}
