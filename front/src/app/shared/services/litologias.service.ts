import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LitologiaActualizarBody, LitologiaCrearBody, LitologiaPublica } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class LitologiasService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiURL + 'litologias';

  listar(incluirInactivas = false): Promise<LitologiaPublica[]> {
    const params = incluirInactivas ? new HttpParams().set('incluir_inactivas', 'true') : undefined;
    return firstValueFrom(this.http.get<LitologiaPublica[]>(this.url, { params }));
  }

  obtener(id: number): Promise<LitologiaPublica> { return firstValueFrom(this.http.get<LitologiaPublica>(`${this.url}/${id}`)); }
  crear(body: LitologiaCrearBody): Promise<LitologiaPublica> { return firstValueFrom(this.http.post<LitologiaPublica>(this.url, body)); }
  actualizar(id: number, body: LitologiaActualizarBody): Promise<LitologiaPublica> { return firstValueFrom(this.http.put<LitologiaPublica>(`${this.url}/${id}`, body)); }
  activar(id: number): Promise<LitologiaPublica> { return firstValueFrom(this.http.patch<LitologiaPublica>(`${this.url}/${id}/activar`, {})); }
  desactivar(id: number): Promise<LitologiaPublica> { return firstValueFrom(this.http.patch<LitologiaPublica>(`${this.url}/${id}/desactivar`, {})); }
}
