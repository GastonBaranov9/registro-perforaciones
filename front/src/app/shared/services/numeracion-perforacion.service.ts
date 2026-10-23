import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EstadoNumeracion { proximo: number | null; minimo: number; agotado: boolean }
export interface VistaRectificacion {
  proximo: number | null; mayor_asignado: number;
  reservas: { numero_perforacion: number; id_pozo_original: string; asignado_en: string; bloqueada: boolean }[];
}
export function numeroPerforacionValido(numero: unknown): numero is number {
  return typeof numero === 'number' && Number.isInteger(numero) && numero >= 1 && numero <= 2147483647;
}
@Injectable({ providedIn: 'root' })
export class NumeracionPerforacionService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiURL + 'pozos/numeracion';
  obtener() { return this.peticion(firstValueFrom(this.http.get<EstadoNumeracion>(this.url))); }
  previsualizar(desde: number) {
    return this.peticion(firstValueFrom(this.http.get<VistaRectificacion>(this.url + '/rectificacion/' + desde)));
  }
  rectificar(desde: number, vista: VistaRectificacion, motivo: string, sinReferencias: boolean) {
    return this.peticion(firstValueFrom(this.http.post<EstadoNumeracion & { rectificacion_id: string }>(this.url + '/rectificacion', {
      desde, esperado: vista.proximo, mayor_esperado: vista.mayor_asignado, motivo,
      sin_referencias_externas: sinReferencias,
      reservas: vista.reservas.map(({ numero_perforacion, id_pozo_original, asignado_en }) => ({ numero_perforacion, id_pozo_original, asignado_en })),
    })));
  }
  configurar(proximo: number, esperado: number | null) {
    return this.peticion(firstValueFrom(this.http.put<EstadoNumeracion>(this.url, { proximo, esperado })));
  }
  consultar(numero: number) {
    return this.peticion(firstValueFrom(this.http.get<{ utilizado: boolean }>(this.url + '/disponibilidad/' + numero)));
  }
  asignarPendiente(id: number, numero_perforacion: number) {
    return this.peticion(firstValueFrom(this.http.patch<{ numero_perforacion: number }>(
      environment.apiURL + 'pozos/' + id + '/numero-perforacion', { numero_perforacion })));
  }
  private async peticion<T>(promise: Promise<T>): Promise<T> {
    try { return await promise; }
    catch (error) {
      const respuesta = error as { error?: { message?: string } };
      throw new Error(respuesta.error?.message ?? 'No se pudo consultar o actualizar la numeración.');
    }
  }
}
