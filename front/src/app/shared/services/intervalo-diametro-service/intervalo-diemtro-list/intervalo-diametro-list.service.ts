import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../auth-service/auth.service';
import { HttpClient } from '@angular/common/http';
import { IntervaloDiametroPerforacion } from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class IntervaloDiametroListService {
  public baseURL(id_usuario: number, id_pozo: number): string {
    return (
      environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/intervalo_diametro_perforacion`
    );
  }
  public authService = inject(AuthService);
  private httpClient = inject(HttpClient);

  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async getIntervalosDiametros(id_pozo: number): Promise<IntervaloDiametroPerforacion[]> {
    const id_usuario = this.getUserIdOrThrow();

    return await firstValueFrom(
      this.httpClient.get<IntervaloDiametroPerforacion[]>(this.baseURL(id_usuario, id_pozo))
    );
  }

  public async deleteIntervaloDiametro(
    id_pozo: number,
    intervaloDiam: IntervaloDiametroPerforacion
  ): Promise<void> {
    const id_usuario = this.getUserIdOrThrow();

    await firstValueFrom(
      this.httpClient.delete(
        `${this.baseURL(id_usuario, id_pozo)}/${intervaloDiam.id_intervalo_diametro_perforacion}`
      )
    );
  }
}
