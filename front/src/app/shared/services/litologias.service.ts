import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LitologiaActualizarBody, LitologiaCrearBody, LitologiaPublica } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class LitologiasService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiURL + 'litologias';
  private activasCache: Promise<LitologiaPublica[]> | null = null;
  private historicasCache = new Map<number, Promise<LitologiaPublica>>();

  listar(incluirInactivas = false): Promise<LitologiaPublica[]> {
    const params = incluirInactivas ? new HttpParams().set('incluir_inactivas', 'true') : undefined;
    if (incluirInactivas) return firstValueFrom(this.http.get<LitologiaPublica[]>(this.url, { params }));
    if (!this.activasCache) {
      this.activasCache = firstValueFrom(this.http.get<LitologiaPublica[]>(this.url)).catch((error: unknown) => {
        this.activasCache = null;
        throw error;
      });
    }
    return this.activasCache;
  }

  obtener(id: number): Promise<LitologiaPublica> {
    const existente = this.historicasCache.get(id);
    if (existente) return existente;
    const carga = firstValueFrom(this.http.get<LitologiaPublica>(`${this.url}/${id}`)).catch((error: unknown) => {
      this.historicasCache.delete(id);
      throw error;
    });
    this.historicasCache.set(id, carga);
    return carga;
  }
  async crear(body: LitologiaCrearBody): Promise<LitologiaPublica> {
    const resultado = await firstValueFrom(this.http.post<LitologiaPublica>(this.url, body));
    this.invalidarCache();
    return resultado;
  }
  async actualizar(id: number, body: LitologiaActualizarBody): Promise<LitologiaPublica> {
    const resultado = await firstValueFrom(this.http.put<LitologiaPublica>(`${this.url}/${id}`, body));
    this.invalidarCache();
    return resultado;
  }
  async activar(id: number): Promise<LitologiaPublica> {
    const resultado = await firstValueFrom(this.http.patch<LitologiaPublica>(`${this.url}/${id}/activar`, {}));
    this.invalidarCache();
    return resultado;
  }
  async desactivar(id: number): Promise<LitologiaPublica> {
    const resultado = await firstValueFrom(this.http.patch<LitologiaPublica>(`${this.url}/${id}/desactivar`, {}));
    this.invalidarCache();
    return resultado;
  }
  private invalidarCache() { this.activasCache = null; this.historicasCache.clear(); }
}
