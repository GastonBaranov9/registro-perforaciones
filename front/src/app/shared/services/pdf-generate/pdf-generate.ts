import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PdfGenerate {
  private http = inject(HttpClient);
  private apiURL = environment.apiURL;
  private baseURL(id_usuario: number, id_pozo: number): string {
    return `${this.apiURL}usuarios/${id_usuario}/pozos/${id_pozo}`;
  }

  descargarInformePozo(id_usuario: number, id_pozo: number) {
    const url = `${this.baseURL(id_usuario, id_pozo)}/informe-pdf`;
    console.log('URL PDF:', url);
    return this.http.get(url, { responseType: 'blob' });
  }
}
