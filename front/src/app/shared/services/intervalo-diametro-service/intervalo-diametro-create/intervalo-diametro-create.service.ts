import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../auth-service/auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IntervaloDiametroPerforacion,
  IntervaloDiametroPerforacionBody,
} from '../../../types/schemas';

@Injectable({
  providedIn: 'root',
})
export class IntervaloDiametroCreateService {
  public authService = inject(AuthService);
  private httpClient = inject(HttpClient);

  public baseURL(id_usuario: number, id_pozo: number): string {
    return (
      environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/intervalo_diametro_perforacion`
    );
  }

  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async createIntervaloDiametro(
    id_pozo: number,
    body: IntervaloDiametroPerforacionBody
  ): Promise<IntervaloDiametroPerforacion> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.post<IntervaloDiametroPerforacion>(this.baseURL(id_usuario, id_pozo), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new err
    }
  }
}
