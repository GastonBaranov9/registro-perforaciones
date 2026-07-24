import { HttpClient } from '@angular/common/http';
import { inject, Injectable, input } from '@angular/core';
import { NuevoPozo, Pozo } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PozosEditService {
  public baseURL(id_usuario: number, id_pozo: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}`;
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

  public async editPozo(id_pozo: number, body: NuevoPozo): Promise<NuevoPozo> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.put<Pozo>(this.baseURL(id_usuario, id_pozo), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error.message);
    }
  }

  public async getPozoById(id_pozo: number): Promise<Pozo> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(this.httpClient.get<Pozo>(this.baseURL(id_usuario, id_pozo)));
    } catch (err: any) {
      console.log('Mensaje de error', err.error?.message ?? err.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'Error al obtener usuario');
    }
  }
}
