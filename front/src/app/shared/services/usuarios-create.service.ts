import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  UsuarioCrearBody,
  UsuarioPublico,
} from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UsuariosCreateService {
  private readonly baseURL = environment.apiURL + 'usuarios';
  private readonly httpClient = inject(HttpClient);

  public async createUsuario(
    body: UsuarioCrearBody
  ): Promise<UsuarioPublico> {
    try {
      return await firstValueFrom(
        this.httpClient.post<UsuarioPublico>(
          this.baseURL,
          body
        )
      );
    } catch (err: any) {
      if (err.status === 0) {
        throw new Error(err.message);
      }

      throw new Error(
        err.error?.message ?? 'No se pudo crear el usuario'
      );
    }
  }
}