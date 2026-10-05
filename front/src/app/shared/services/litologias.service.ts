import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LitologiaActualizarBody, LitologiaCrearBody, LitologiaPublica } from '../types/schemas';
import { RuntimePlatformService } from '../../core/native/runtime-platform.service';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

@Injectable({ providedIn: 'root' })
export class LitologiasService {
  private readonly runtime = inject(RuntimePlatformService);
  /** El catálogo administrativo cambia poco; se comparte durante 5 minutos. */
  private static readonly ACTIVAS_TTL_MS = 5 * 60 * 1000;
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiURL + 'litologias';
  private activasCache: Promise<LitologiaPublica[]> | null = null;
  private activasCacheExpiraEn = 0;
  private historicasCache = new Map<number, Promise<LitologiaPublica>>();

  listar(incluirInactivas = false): Promise<LitologiaPublica[]> {
    const params = incluirInactivas ? new HttpParams().set('incluir_inactivas', 'true') : undefined;
    if (incluirInactivas) return firstValueFrom(this.http.get<LitologiaPublica[]>(this.url, { params }));
    if (!this.activasCache || Date.now() >= this.activasCacheExpiraEn) {
      this.activasCache = firstValueFrom(this.http.get<LitologiaPublica[]>(this.url)).then(async rows => {
        if (this.runtime.isNative()) {
          try { await Filesystem.writeFile({ directory: Directory.Data, path: 'offline-v1/catalogo.json', data: JSON.stringify({ url: this.url, rows }), encoding: Encoding.UTF8, recursive: true }); } catch { /* Online data remains usable; offline reports a missing catalog if needed. */ }
        }
        return rows;
      }).catch(async (error: unknown) => {
        this.activasCache = null;
        this.activasCacheExpiraEn = 0;
        if (this.runtime.isNative()) {
          try {
            const file = await Filesystem.readFile({ directory: Directory.Data, path: 'offline-v1/catalogo.json', encoding: Encoding.UTF8 });
            const cached = JSON.parse(String(file.data));
            if (cached.url === this.url && Array.isArray(cached.rows)) return cached.rows as LitologiaPublica[];
          } catch { /* Show the original error without inventing catalog IDs. */ }
        }
        throw error;
      });
      this.activasCacheExpiraEn = Date.now() + LitologiasService.ACTIVAS_TTL_MS;
    }
    return this.activasCache;
  }
  refresh(): Promise<LitologiaPublica[]> { this.invalidarCache(); return this.listar(); }
  invalidate(): void { this.invalidarCache(); }

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
  private invalidarCache() { this.activasCache = null; this.activasCacheExpiraEn = 0; this.historicasCache.clear(); }
}
