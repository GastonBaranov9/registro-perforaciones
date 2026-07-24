import { HttpClient } from '@angular/common/http';
import { inject, Injectable, input } from '@angular/core';
import { Usuario, UsuarioBody } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UsuariosEditService {

  public baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}`;
  }
  public httpClient = inject(HttpClient);

  public async editPersona(id_usuario: number, body: UsuarioBody): Promise<Usuario> {
    try {
      return await firstValueFrom(
        this.httpClient.put<Usuario>(this.baseURL(id_usuario), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error("Formato de Email incorrecto");
    }
  }

  public async getUsuarioById(id_usuario: number): Promise<Usuario> {
    try {
      return await firstValueFrom(
        this.httpClient.get<Usuario>(this.baseURL(id_usuario))
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error?.message ?? err.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'Error al obtener usuario');
    }
  }
}
