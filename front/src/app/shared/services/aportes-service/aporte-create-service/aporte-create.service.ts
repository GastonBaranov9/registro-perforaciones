import { inject, Injectable } from '@angular/core';
import { AuthService } from '../../auth-service/auth.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { NivelAporte, NivelAporteBody } from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AporteCreateService {

  public authService = inject(AuthService);
  private httpClient = inject(HttpClient);

  public baseURL(id_usuario: number, id_pozo: number): string {
    return (
      environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/niveles_aporte`
    );
  }

  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async createNivelAporte(
    id_pozo: number,
    body: NivelAporteBody
  ): Promise<NivelAporte> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.post<NivelAporte>(this.baseURL(id_usuario, id_pozo), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new err
    }
  }
  
}
