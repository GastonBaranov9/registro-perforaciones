import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExportarKmlService {
  private readonly http = inject(HttpClient);

  async descargar(): Promise<{ exportadas: number | null; omitidas: number | null }> {
    const respuesta = await firstValueFrom(this.http.get(`${environment.apiURL}pozos/exportar/kml`, {
      responseType: 'blob', observe: 'response',
    }));
    const blob = respuesta.body;
    if (!blob?.size || blob.type.split(';')[0].trim().toLowerCase() !== 'application/vnd.google-earth.kml+xml') {
      throw new Error('No se recibió un archivo KML válido.');
    }
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    try {
      enlace.href = url;
      enlace.download = 'perforaciones-raulsilva.kml';
      document.body.appendChild(enlace);
      enlace.click();
    } finally {
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return {
      exportadas: contador(respuesta.headers.get('X-KML-Exportadas')),
      omitidas: contador(respuesta.headers.get('X-KML-Omitidas')),
    };
  }
}

function contador(valor: string | null): number | null {
  if (valor === null || !/^\d+$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) ? numero : null;
}
