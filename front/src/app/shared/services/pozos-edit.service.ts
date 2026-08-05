import { HttpClient } from '@angular/common/http';
import { inject, Injectable, input } from '@angular/core';
import { AccionFotoEdicion, DatosTecnicosBorrador, NuevoPozo, Pozo, PozoCompletoResultado, PozoCompletoUpdateBody } from '../types/schemas';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PozosEditService {
  public baseURL(id_usuario: number, id_pozo: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}`;
  }
  public httpClient = inject(HttpClient);
  private auth = inject(AuthService);

  private getUserIdOrThrow(): number {
    const id = this.auth.userId();
    if (!id) {
      throw new Error('No se encontró id_usuario autenticado');
    }
    return id;
  }

  public async editPozo(id_pozo: number, body: NuevoPozo): Promise<NuevoPozo> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(
        this.httpClient.put<Pozo>(this.baseURL(id_usuario, id_pozo), body)
      );
    } catch (error: unknown) {
      const respuesta = error as { status?: number; message?: string; error?: { message?: string } };
      if (respuesta.status === 0) throw new Error(respuesta.message);
      throw new Error(respuesta.error?.message ?? respuesta.message ?? 'No se pudo editar el pozo.');
    }
  }

  public async editPozoCompleto(idPozo: number, pozo: NuevoPozo, tecnicos: DatosTecnicosBorrador, foto: File | null, fotoAccion: AccionFotoEdicion): Promise<PozoCompletoResultado> {
    const idUsuario = this.getUserIdOrThrow();
    const body: PozoCompletoUpdateBody = {
      pozo,
      intervalos_litologicos: tecnicos.intervalosLitologicos.map((x) => ({ ...x.dato })),
      intervalos_diametro: tecnicos.intervalosDiametro.map((x) => ({ ...x.dato })),
      niveles_aporte: tecnicos.nivelesAporte.map((x) => ({ ...x.dato })),
      foto_accion: fotoAccion,
    };
    if (foto) body.foto = await convertirFoto(foto);
    try {
      return await firstValueFrom(this.httpClient.put<PozoCompletoResultado>(`${this.baseURL(idUsuario, idPozo)}/completo`, body));
    } catch (error: unknown) {
      const respuesta = error as { message?: string; error?: { message?: string } };
      throw new Error(respuesta.error?.message ?? respuesta.message ?? 'No se pudo actualizar la perforación.');
    }
  }

  public async getPozoById(id_pozo: number): Promise<Pozo> {
    const id_usuario = this.getUserIdOrThrow();
    try {
      return await firstValueFrom(this.httpClient.get<Pozo>(this.baseURL(id_usuario, id_pozo)));
    } catch (error: unknown) {
      const respuesta = error as { status?: number; message?: string; error?: { message?: string } };
      if (respuesta.status === 0) throw new Error(respuesta.message);
      throw new Error(respuesta.error?.message ?? 'Error al obtener el pozo');
    }
  }
}

async function convertirFoto(foto: File): Promise<NonNullable<PozoCompletoUpdateBody['foto']>> {
  if (foto.type !== 'image/jpeg' && foto.type !== 'image/png') throw new Error('La fotografía debe ser JPEG o PNG.');
  const bytes = new Uint8Array(await foto.arrayBuffer());
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { mime_type: foto.type, base64: btoa(binario) };
}
