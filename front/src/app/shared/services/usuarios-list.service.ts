import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PaginaPerforaciones, PaginaPersonas, UsuarioPublico } from '../types/schemas';
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

  public async buscarPersonas(buscar = '', offset = 0): Promise<PaginaPersonas> {
    return firstValueFrom(this.httpClient.get<PaginaPersonas>(`${this.baseURL}/personas`, {
      params: { buscar, offset, limite: 30 },
    }));
  }

  public async perforacionesDe(id: number, offset = 0): Promise<PaginaPerforaciones> {
    return firstValueFrom(this.httpClient.get<PaginaPerforaciones>(`${this.baseURL}/personas/${id}/perforaciones`, {
      params: { offset, limite: 30 },
    }));
  }

  public async deleteUsuario(id_usuario: number): Promise<void> {
    await firstValueFrom(this.httpClient.delete(`${this.baseURL}/${id_usuario}`));
  }


}
