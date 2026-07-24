import { HttpClient } from '@angular/common/http';
import { inject, Injectable, output } from '@angular/core';
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
      return await firstValueFrom(
        this.httpClient.post<any>(this.baseURL(id_usuario, id_pozo), formData)
      );
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      if (err.status === 0) throw new Error(err.message);
      throw new Error(err.error.message);
    }
  }
}
