import { Component, DestroyRef, ElementRef, ViewChild, inject, output, signal } from '@angular/core';
import { IonButton, IonText } from '@ionic/angular/standalone';
import { CameraResultType, CameraSource } from '@capacitor/camera';
import { CAPACITOR_CAMERA } from '../../../../core/native/native-plugin.tokens';
import { RuntimePlatformService } from '../../../../core/native/runtime-platform.service';

// El receptor es dueño de vistaPrevia y debe revocar su ObjectURL al reemplazarla o destruirse.
export interface FotoSeleccionada { archivo: File; vistaPrevia: string; }
const MAXIMO_FOTO_BYTES = 5_000_000;
class FotoInvalidaError extends Error {}

@Component({ selector: 'app-foto', templateUrl: './foto.component.html', styleUrls: ['./foto.component.css'], imports: [IonButton, IonText] })
export class FotoComponent {
  @ViewChild('selectorFoto') private selectorFoto?: ElementRef<HTMLInputElement>;
  private readonly runtime = inject(RuntimePlatformService);
  private readonly camera = inject(CAPACITOR_CAMERA);
  private readonly destroyRef = inject(DestroyRef);
  readonly esNative = this.runtime.isNative();
  public fotoTomada = output<FotoSeleccionada>();
  public error = signal('');
  public procesando = signal(false);

  tomarFoto(): Promise<void> { return this.seleccionarNativa(CameraSource.Camera); }

  async abrirSelector(): Promise<void> {
    if (this.procesando()) return;
    this.error.set('');
    if (this.esNative) await this.seleccionarNativa(CameraSource.Photos);
    else if (this.runtime.isWeb()) this.selectorFoto?.nativeElement.click();
    else this.error.set('No se pudo determinar cómo seleccionar la fotografía. Reiniciá la aplicación.');
  }

  private async seleccionarNativa(source: CameraSource): Promise<void> {
    if (this.procesando() || !this.esNative) return;
    this.procesando.set(true);
    this.error.set('');
    try {
      const foto = await this.camera.getPhoto({
        source, resultType: CameraResultType.Uri, quality: 90,
        allowEditing: false, saveToGallery: false,
      });
      if (!foto.webPath) throw new Error('Foto sin ruta');
      const respuesta = await fetch(foto.webPath);
      if (!respuesta.ok) throw new Error('No se pudo leer la foto');
      const blob = await respuesta.blob();
      const formato = foto.format.toLowerCase();
      const tipo = formato === 'jpeg' || formato === 'jpg' ? 'image/jpeg'
        : formato === 'png' ? 'image/png' : blob.type;
      await this.emitirArchivo(new File([blob], `foto_pozo.${formato}`, { type: tipo }));
    } catch (error: unknown) {
      const mensaje = error && typeof error === 'object' && 'message' in error
        ? String(error.message) : '';
      // Camera 8.0.0 comunica la cancelación mediante estos mensajes en Android/iOS.
      if (!/^(User cancelled photos app|User cancelled camera|User canceled photos app)\.?$/i.test(mensaje)) {
        this.error.set(error instanceof FotoInvalidaError ? error.message
          : /denied|permission/i.test(mensaje)
            ? 'No se permitió acceder a la cámara o las fotos. Revisá los permisos de la app en Ajustes.'
            : 'No se pudo obtener la fotografía. Intentá nuevamente.');
      }
    } finally { this.procesando.set(false); }
  }

  async archivoCambiado(evento: Event): Promise<void> {
    if (this.procesando()) return;
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.item(0) ?? null;
    input.value = '';
    if (!archivo) return;
    this.procesando.set(true); this.error.set('');
    try {
      await this.emitirArchivo(archivo);
    } catch (error: unknown) {
      this.error.set(error instanceof FotoInvalidaError ? error.message : 'No se pudo leer la fotografía.');
    } finally { this.procesando.set(false); }
  }

  private async emitirArchivo(archivo: File): Promise<void> {
    validarTamano(archivo.size);
    // Sólo necesitamos la cabecera para validar la firma, no una copia de toda la foto.
    const bytes = new Uint8Array(await archivo.slice(0, 8).arrayBuffer());
    validarFoto(archivo, bytes);
    if (!this.destroyRef.destroyed) {
      this.fotoTomada.emit({ archivo, vistaPrevia: URL.createObjectURL(archivo) });
    }
  }
}

export function validarFoto(archivo: File, bytes: Uint8Array): void {
  if (archivo.type !== 'image/jpeg' && archivo.type !== 'image/png') throw new FotoInvalidaError('La fotografía debe ser un archivo JPEG o PNG.');
  validarTamano(archivo.size);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if ((archivo.type === 'image/jpeg' && !jpeg) || (archivo.type === 'image/png' && !png)) throw new FotoInvalidaError('El contenido de la fotografía no coincide con un JPEG o PNG válido.');
}

function validarTamano(bytes: number): void {
  if (bytes === 0) throw new FotoInvalidaError('La fotografía está vacía. Elegí otro archivo.');
  if (bytes > MAXIMO_FOTO_BYTES) throw new FotoInvalidaError('La fotografía no puede superar los 5 MB.');
}
