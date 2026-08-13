import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CandidatoPozo, CatalogosPersonasPozo } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class CandidatosPozoService {
  private http = inject(HttpClient);
  obtener(opciones: { rol?: 'propietario' | 'perforador'; busqueda?: string; id?: number; limite?: number } = {}): Promise<CatalogosPersonasPozo> {
    let params = new HttpParams();
    if (opciones.busqueda) params = params.set(opciones.rol ?? 'propietario', opciones.busqueda);
    if (opciones.id) params = params.set(`${opciones.rol ?? 'propietario'}_id`, opciones.id);
    if (opciones.limite) params = params.set('limite', opciones.limite);
    return firstValueFrom(this.http.get<CatalogosPersonasPozo>(`${environment.apiURL}pozos/candidatos-personas`, { params }));
  }

  buscar(rol: 'propietario' | 'perforador', busqueda: string): Promise<CandidatoPozo[]> {
    return this.obtener({ rol, busqueda, limite: 20 }).then((catalogos) => rol === 'propietario' ? catalogos.propietarios : catalogos.perforadores);
  }

  obtenerPorId(rol: 'propietario' | 'perforador', id: number): Promise<CandidatoPozo | null> {
    return this.obtener({ rol, id, limite: 1 }).then((catalogos) => (rol === 'propietario' ? catalogos.propietarios : catalogos.perforadores)[0] ?? null);
  }
}
