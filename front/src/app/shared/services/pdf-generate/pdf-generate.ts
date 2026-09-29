import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { Directory } from '@capacitor/filesystem';
import { CAPACITOR_FILESYSTEM, CAPACITOR_SHARE } from '../../../core/native/native-plugin.tokens';
import { RuntimePlatformService } from '../../../core/native/runtime-platform.service';

const PDF_CACHE = 'informes-pdf';
const MAX_CACHE_FILES = 10;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class PdfGenerate {
  private http = inject(HttpClient);
  private readonly runtime = inject(RuntimePlatformService);
  private readonly filesystem = inject(CAPACITOR_FILESYSTEM);
  private readonly share = inject(CAPACITOR_SHARE);
  private apiURL = environment.apiURL;
  private baseURL(id_usuario: number, id_pozo: number): string {
    return `${this.apiURL}usuarios/${id_usuario}/pozos/${id_pozo}`;
  }

  descargarInformePozo(id_usuario: number, id_pozo: number) {
    const url = `${this.baseURL(id_usuario, id_pozo)}/informe-pdf`;
    return this.http.get(url, { responseType: 'blob' });
  }

  async exportarInformePozo(idUsuario: number, idPozo: number): Promise<void> {
    if (!Number.isSafeInteger(idPozo) || idPozo <= 0) throw new Error('Pozo inválido');
    const blob = await firstValueFrom(this.descargarInformePozo(idUsuario, idPozo));
    const signature = await blob.slice(0, 5).text();
    if (!blob.size || blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf' || signature !== '%PDF-') {
      throw new Error('El informe recibido no es un PDF válido.');
    }
    const filename = `informe_pozo_${idPozo}.pdf`;
    if (this.runtime.isNative()) {
      const path = `${PDF_CACHE}/${filename}`;
      // Filesystem requiere base64 para escribir binarios en Android/iOS.
      const result = await this.filesystem.writeFile({
        path, directory: Directory.Cache, data: await pdfBase64(blob), recursive: true,
      });
      try {
        await this.limpiarCache(filename);
      } catch {
        // Un fallo de mantenimiento no invalida el PDF ya escrito. Se reintenta al exportar.
      }
      try {
        // Share infiere application/pdf de la extensión y concede acceso temporal al receptor.
        await this.share.share({ files: [result.uri], title: filename, dialogTitle: 'Abrir o compartir informe PDF' });
      } catch (error: unknown) {
        if (!(error instanceof Error && error.message === 'Share canceled')) throw error;
      }
    } else if (this.runtime.isWeb()) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        // Se libera en el siguiente turno para permitir que el navegador inicie la descarga.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } else {
      throw new Error('No se pudo determinar cómo abrir el informe.');
    }
  }

  private async limpiarCache(actual: string): Promise<void> {
    const { files } = await this.filesystem.readdir({ path: PDF_CACHE, directory: Directory.Cache });
    const anteriores = files
      .filter((file) => file.type === 'file' && /^informe_pozo_\d+\.pdf$/.test(file.name) && file.name !== actual)
      .sort((a, b) => b.mtime - a.mtime);
    for (const [index, file] of anteriores.entries()) {
      if (index >= MAX_CACHE_FILES - 1 || Date.now() - file.mtime > CACHE_MAX_AGE_MS) {
        try {
          await this.filesystem.deleteFile({ path: `${PDF_CACHE}/${file.name}`, directory: Directory.Cache });
        } catch {
          // La caché puede cambiar entre listar y borrar. Continuar con los demás informes.
        }
      }
    }
    // No borrar al cerrar Share: Android puede resolver antes de que el receptor lea el archivo.
    // Retención acotada (10 informes); se purgan los de más de 24 h en la siguiente exportación.
  }
}

function pdfBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
      : reject(new Error('No se pudo preparar el PDF.'));
    reader.onerror = () => reject(new Error('No se pudo preparar el PDF.'));
    reader.readAsDataURL(blob);
  });
}
