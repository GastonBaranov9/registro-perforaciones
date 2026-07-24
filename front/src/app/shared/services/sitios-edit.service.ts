import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Sitio, SitioBody } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SitiosEditService {
  public baseURL(id_usuario: number, id_sitio: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/sitios/${id_sitio}`;
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

  public async editSitio(id_sitio: number, body: SitioBody): Promise<Sitio> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.put<Sitio>(this.baseURL(id_usuario, id_sitio), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error.message);
    }
  }

  public async getSitioById(id_sitio: number): Promise<Sitio> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(this.httpClient.get<Sitio>(this.baseURL(id_usuario, id_sitio)));
    } catch (err: any) {
      console.log('Mensaje de error', err.error?.message ?? err.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'Error al obtener sitio');
    }
  }
}
