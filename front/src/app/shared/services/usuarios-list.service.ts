import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UsuarioPublico } from '../types/schemas';
import { environment } from '../../../environments/environment';
@Injectable({
  providedIn: 'root',
})
export class UsuariosListService {
  public baseURL : string = environment.apiURL + "usuarios"
  public httpClient = inject(HttpClient);

  public async getListaUsuarios(): Promise<UsuarioPublico[]> {
    return await firstValueFrom(this.httpClient.get<UsuarioPublico[]>(this.baseURL));
  }

  public async deleteUsuario(id_usuario: number): Promise<void> {
    await firstValueFrom(this.httpClient.delete(`${this.baseURL}/${id_usuario}`));
  }


}
