import { HttpClient } from '@angular/common/http';
import { effect, inject, Injectable, input } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Pozo } from '../types/schemas';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';
import { WebsocketService } from './websocket.service';

@Injectable({
  providedIn: 'root',
})
export class PozosListService {
  public baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos`;
  }
  public httpClient = inject(HttpClient);
  private auth = inject(AuthService);
  private getUserIdOrThrow(): number {
    const id = this.auth.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }


  public async getListaPozos(
    caudal_min?: number,
    caudal_max?: number,
    profundidad_max?: number,
    profundidad_min?: number,
    sello_sanitario?: boolean
  ): Promise<Pozo[]> {
    const id_usuario = this.getUserIdOrThrow();
    const params: any = {};
    if (caudal_min !== undefined) params.caudal_min = caudal_min;
    if (caudal_max !== undefined) params.caudal_max = caudal_max;
    if (profundidad_max !== undefined) params.profundidad_max = profundidad_max;
    if (profundidad_min !== undefined) params.profundidad_min = profundidad_min;
    if (sello_sanitario !== undefined) params.sello_sanitario = sello_sanitario;
    return await firstValueFrom(this.httpClient.get<Pozo[]>(this.baseURL(id_usuario), { params }));
  }

  public async deletePozo(id_pozo: number): Promise<void> {
    const id_usuario = this.getUserIdOrThrow();

    await firstValueFrom(this.httpClient.delete(`${this.baseURL(id_usuario)}/${id_pozo}`));
  }
}
