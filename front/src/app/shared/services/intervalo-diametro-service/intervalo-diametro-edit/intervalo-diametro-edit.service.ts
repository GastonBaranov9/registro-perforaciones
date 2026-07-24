import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuthService } from '../../auth-service/auth.service';
import { environment } from '../../../../../environments/environment';
import {
  IntervaloDiametroPerforacion,
  IntervaloDiametroPerforacionBody,
} from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class IntervaloDiametroEditService {
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

  public async editIntervaloDiam(
    id_pozo: number,
    id_intervalo: number,
    body: IntervaloDiametroPerforacionBody
  ): Promise<IntervaloDiametroPerforacion> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.put<IntervaloDiametroPerforacion>(
          `${this.baseURL(id_usuario, id_pozo)}/intervalo_diametro_perforacion/${id_intervalo}`,
          body
        )
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new err;
    }
  }

  public async getIntDiamById(
    id_pozo: number,
    id_intervalo: number
  ): Promise<IntervaloDiametroPerforacionBody> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.get<IntervaloDiametroPerforacionBody>(
          `${this.baseURL(id_usuario, id_pozo)}/intervalo_diametro_perforacion/${id_intervalo}`
        )
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error?.message ?? err.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'Error al obtener intervalo de diámetro');
    }
  }
}
