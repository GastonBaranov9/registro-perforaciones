import { inject, Injectable } from '@angular/core';
import { AuthService } from '../../auth-service/auth.service';
import { IntervaloLitologico } from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class IntervaloLitologicoListService {
  public baseURL(id_usuario: number, id_pozo: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/intervalo_litologico`;
  }
  public authService = inject(AuthService);
  public httpClient = inject(HttpClient);
  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async getIntervalosLitologicos(id_pozo: number): Promise<IntervaloLitologico[]> {
    const id_usuario = this.getUserIdOrThrow();

    return await firstValueFrom(
      this.httpClient.get<IntervaloLitologico[]>(this.baseURL(id_usuario, id_pozo))
    );
  }

  public async deleteIntervaloLitologico(
    id_pozo: number,
    intervaloLit: IntervaloLitologico
  ): Promise<void> {
    const id_usuario = this.getUserIdOrThrow();

    await firstValueFrom(
      this.httpClient.delete(
        `${this.baseURL(id_usuario, id_pozo)}/${intervaloLit.id_intervalo_litologico}`
      )
    );
  }
}
