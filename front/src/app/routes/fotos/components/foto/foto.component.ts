import { Component, ElementRef, ViewChild, output, signal } from '@angular/core';
import { IonButton, IonText } from '@ionic/angular/standalone';

export interface FotoSeleccionada { archivo: File; vistaPrevia: string; }
const MAXIMO_FOTO_BYTES = 5_000_000;

@Component({ selector: 'app-foto', templateUrl: './foto.component.html', styleUrls: ['./foto.component.css'], imports: [IonButton, IonText] })
export class FotoComponent {
  @ViewChild('selectorFoto') private selectorFoto?: ElementRef<HTMLInputElement>;
  public fotoTomada = output<FotoSeleccionada>();
  public error = signal('');
  public procesando = signal(false);

  abrirSelector(): void { this.error.set(''); this.selectorFoto?.nativeElement.click(); }

  async archivoCambiado(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.item(0) ?? null;
    input.value = '';
    if (!archivo) return;
    this.procesando.set(true); this.error.set('');
    try {
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      validarFoto(archivo, bytes);
      this.fotoTomada.emit({ archivo, vistaPrevia: await leerComoDataUrl(archivo) });
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo leer la fotografía.');
    } finally { this.procesando.set(false); }
  }
}

export function validarFoto(archivo: File, bytes: Uint8Array): void {
  if (archivo.type !== 'image/jpeg' && archivo.type !== 'image/png') throw new Error('La fotografía debe ser un archivo JPEG o PNG.');
  if (bytes.length === 0 || bytes.length > MAXIMO_FOTO_BYTES) throw new Error('La fotografía no puede superar los 5 MB.');
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if ((archivo.type === 'image/jpeg' && !jpeg) || (archivo.type === 'image/png' && !png)) throw new Error('El contenido de la fotografía no coincide con un JPEG o PNG válido.');
}

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => typeof lector.result === 'string' ? resolve(lector.result) : reject(new Error('No se pudo crear la vista previa.'));
    lector.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
    lector.readAsDataURL(archivo);
  });
}
