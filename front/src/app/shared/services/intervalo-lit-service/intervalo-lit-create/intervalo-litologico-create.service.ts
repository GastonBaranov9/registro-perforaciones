import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import {
  IntervaloLitologico,
  IntervaloLitologicoBody,
  Pozo,
  Usuario,
} from '../../../types/schemas';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../auth-service/auth.service';

@Injectable({
  providedIn: 'root',
})
export class IntervaloLitologicoCreateService {
  public authService = inject(AuthService);
   public httpClient = inject(HttpClient);

  public baseURL(id_usuario: number, id_pozo: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/intervalo_litologico`;
  }
  
  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async createIntervaloLit(
    id_pozo: number,
    body: IntervaloLitologicoBody
  ): Promise<IntervaloLitologico> {

    const id_usuario = await this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.post<IntervaloLitologico>(this.baseURL(id_usuario, id_pozo), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new err
    }
  }
}
