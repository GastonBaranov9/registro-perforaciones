import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Usuario, UsuarioBody } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class UsuariosCreateService {
  public baseURL : string = environment.apiURL + "usuarios"
  public httpClient = inject(HttpClient);

  public async createUsuario(body: UsuarioBody): Promise<Usuario> {
    try {
      return await firstValueFrom(
        this.httpClient.post<Usuario>(this.baseURL, body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw err;
    }
  }
}
