import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DatosTecnicosBorrador, NuevoPozo, Pozo, PozoCompletoBody, PozoCompletoResultado } from '../types/schemas';
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
    } catch (error: unknown) {
      const respuesta = error as { status?: number; message?: string; error?: { message?: string } };
      if (respuesta.status === 0) throw new Error(respuesta.message);
      throw new Error(respuesta.error?.message ?? respuesta.message ?? 'No se pudo crear la perforación.');
    }
  }

  public async createPozoCompleto(
    idUsuario: number,
    pozo: NuevoPozo,
    tecnicos: DatosTecnicosBorrador,
    foto: File | null,
  ): Promise<PozoCompletoResultado> {
    const body: PozoCompletoBody = {
      pozo,
      intervalos_litologicos: tecnicos.intervalosLitologicos.map((item) => ({ ...item.dato })),
      intervalos_diametro: tecnicos.intervalosDiametro.map((item) => ({ ...item.dato })),
      niveles_aporte: tecnicos.nivelesAporte.map((item) => ({ ...item.dato })),
    };
    if (foto) body.foto = await convertirFoto(foto);
    try {
      return await firstValueFrom(
        this.httpClient.post<PozoCompletoResultado>(`${this.baseURL(idUsuario)}/completo`, body),
      );
    } catch (error: unknown) {
      const respuesta = error as { status?: number; message?: string; error?: { message?: string } };
      throw new Error(respuesta.error?.message ?? respuesta.message ?? 'No se pudo crear la perforación.');
    }
  }
}

async function convertirFoto(foto: File): Promise<NonNullable<PozoCompletoBody['foto']>> {
  if (foto.type !== 'image/jpeg' && foto.type !== 'image/png') throw new Error('La fotografía debe ser JPEG o PNG.');
  const bytes = new Uint8Array(await foto.arrayBuffer());
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { mime_type: foto.type, base64: btoa(binario) };
}
