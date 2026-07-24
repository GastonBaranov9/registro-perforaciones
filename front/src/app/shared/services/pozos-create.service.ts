import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { NuevoPozo, Pozo } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PozosCreateService {
  public baseURL(id_usuario: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos`;
  }
  public httpClient = inject(HttpClient);

  public async createPozo(id_usuario: number, body: NuevoPozo): Promise<Pozo> {
    try {
      return await firstValueFrom(
        this.httpClient.post<Pozo>(this.baseURL(id_usuario), body)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error.message);
    }
  }
}
