import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../auth-service/auth.service';
import { NivelAporte, NivelAporteBody } from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AporteEditService {
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

  public async editNivelAporte(
    id_pozo: number,
    id_aporte: number,
    body: NivelAporteBody
  ): Promise<NivelAporte> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.put<NivelAporte>(
          `${this.baseURL(id_usuario, id_pozo)}/niveles_aporte/${id_aporte}`,
          body
        )
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw err;
    }
  }

  public async getNivelById(
    id_pozo: number,
    id_aporte: number
  ): Promise<NivelAporteBody> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.get<NivelAporteBody>(
          `${this.baseURL(id_usuario, id_pozo)}/niveles_aporte/${id_aporte}`
        )
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error?.message ?? err.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'Error al obtener nivel de aporte');
    }
  }
}
