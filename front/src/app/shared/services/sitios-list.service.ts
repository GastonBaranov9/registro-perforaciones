import { inject, Injectable } from '@angular/core';
import { first, firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Sitio } from '../types/schemas';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';
@Injectable({
  providedIn: 'root',
})
export class SitiosListService {
  public baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/sitios`;
  }

  public httpClient = inject(HttpClient);
  public authService = inject(AuthService);

  private getUserIdOrThrow(): number {
    const id = this.authService.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async getAllSitios(): Promise<Sitio[]> {
    const id_usuario = this.getUserIdOrThrow();
    return await firstValueFrom(this.httpClient.get<Sitio[]>(this.baseURL(id_usuario)));
  }

  public async deleteSitio(id_sitio: number): Promise<void> {
    const id_usuario = this.getUserIdOrThrow();

    await firstValueFrom(this.httpClient.delete(`${this.baseURL(id_usuario)}/${id_sitio}`));
  }
}
