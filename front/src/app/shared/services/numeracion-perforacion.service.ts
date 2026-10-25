import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface EstadoNumeracion { proximo: number | null; minimo: number; agotado: boolean; puede_retroceder?:boolean }
export interface RevisionContador { anterior:number|null;nuevo:number;tipo:string;disponible:boolean;motivo:string;bloqueos:string[];salto_grande:boolean;token:string|null }
export interface EventoNumeracion { id:string;anterior:number|null;proximo:number;motivo:string|null;cambiado_en:string;responsable:string;responsable_id:string|null;tipo:string }
export interface VistaRectificacion {
  token: string | null;
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
      token:vista.token, confirmacion:'RECTIFICAR', pruebas_confirmadas:sinReferencias,
      desde, esperado: vista.proximo, mayor_esperado: vista.mayor_asignado, motivo,
      sin_referencias_externas: sinReferencias,
      reservas: vista.reservas.map(({ numero_perforacion, id_pozo_original, asignado_en }) => ({ numero_perforacion, id_pozo_original, asignado_en })),
    })));
  }
  revisar(proximo:number,motivo:string){return this.peticion(firstValueFrom(this.http.post<RevisionContador>(this.url+'/revision',{proximo,motivo})));}
  historial(antes?:string){return this.peticion(firstValueFrom(this.http.get<EventoNumeracion[]>(this.url+'/historial',{params:antes?{antes}:{}})));}
  configurar(proximo: number, esperado: number | null, motivo:string,confirmacion?:{token:string;confirmacion:string;registros_fisicos_confirmados:boolean}) {
    return this.peticion(firstValueFrom(this.http.put<EstadoNumeracion>(this.url, { proximo, esperado, motivo,...confirmacion })));
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
