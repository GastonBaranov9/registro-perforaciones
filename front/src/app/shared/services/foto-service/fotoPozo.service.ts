import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class FotoPozoService {
  public baseURL(id_usuario: number, id_pozo: number): string {
    return environment.apiURL + `usuarios/${id_usuario}/pozos/${id_pozo}/foto`;
  }
  private httpClient = inject(HttpClient);

  public async subirFoto(id_usuario: number, id_pozo: number, foto: File) {
    const formData = new FormData();
    formData.append('foto', foto);

    try {
      return await firstValueFrom(this.httpClient.post<unknown>(this.baseURL(id_usuario, id_pozo), formData));
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string; error?: { message?: string } };
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error?.message ?? 'No se pudo subir la fotografía.');
    }
  }

  public async eliminarFoto(id_usuario: number, id_pozo: number): Promise<void> {
    await firstValueFrom(this.httpClient.delete<void>(this.baseURL(id_usuario, id_pozo)));
  }
}
