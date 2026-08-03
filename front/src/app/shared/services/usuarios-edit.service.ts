import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  UsuarioActualizarBody,
  UsuarioPublico,
} from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UsuariosEditService {
  private readonly httpClient = inject(HttpClient);

  private baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}`;
  }

  public async editUsuario(
    id_usuario: number,
    body: UsuarioActualizarBody
  ): Promise<UsuarioPublico> {
    try {
      return await firstValueFrom(
        this.httpClient.put<UsuarioPublico>(
          this.baseURL(id_usuario),
          body
        )
      );
    } catch (err: any) {
      if (err.status === 0) {
        throw new Error(err.message);
      }

      throw new Error(
        err.error?.message ?? 'No se pudo editar el usuario'
      );
    }
  }

  public async getUsuarioById(
    id_usuario: number
  ): Promise<UsuarioPublico> {
    try {
      return await firstValueFrom(
        this.httpClient.get<UsuarioPublico>(
          this.baseURL(id_usuario)
        )
      );
    } catch (err: any) {
      if (err.status === 0) {
        throw new Error(err.message);
      }

      throw new Error(
        err.error?.message ?? 'No se pudo obtener el usuario'
      );
    }
  }
}