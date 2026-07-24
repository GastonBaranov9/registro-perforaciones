import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Sitio, SitioBody } from '../types/schemas';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SitiosCreateService {
  public baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/sitios`;
  }
  public httpClient = inject(HttpClient);

  public async createSitio(id_usuario: number, body: SitioBody): Promise<Sitio> {

    try {
      return await firstValueFrom(
        this.httpClient.post<Sitio>(this.baseURL(id_usuario), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error.message);
    }
  }
  
}
