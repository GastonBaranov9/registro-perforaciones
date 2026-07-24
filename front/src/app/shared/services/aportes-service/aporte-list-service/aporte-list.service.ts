import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../auth-service/auth.service';
import { HttpClient } from '@angular/common/http';
import { NivelAporte } from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AporteListService {

  public baseURL(id_usuario: number, id_pozo: number): string {
    return (
      environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/niveles_aporte`
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

  public async getNivelesAporte(id_pozo: number): Promise<NivelAporte[]> {
    const id_usuario = this.getUserIdOrThrow();

    return await firstValueFrom(
      this.httpClient.get<NivelAporte[]>(this.baseURL(id_usuario, id_pozo))
    );
  }

  public async deleteNivelAporte(
    id_pozo: number,
    nivelAporte: NivelAporte
  ): Promise<void> {
    const id_usuario = this.getUserIdOrThrow();

    await firstValueFrom(
      this.httpClient.delete(
        `${this.baseURL(id_usuario, id_pozo)}/${nivelAporte.id_nivel_aporte}`
      )
    );
  }
  
}
