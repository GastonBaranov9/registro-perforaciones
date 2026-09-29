import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { CameraPlugin, CameraResultType, CameraSource } from '@capacitor/camera';
import { CAPACITOR_CAMERA, CAPACITOR_RUNTIME } from '../../../../core/native/native-plugin.tokens';
import { FotoComponent, validarFoto } from './foto.component';

for (const platform of ['web', 'android', 'ios'] as const) {
describe(`FotoComponent ${platform}`, () => {
  let component: FotoComponent;
  let fixture: ComponentFixture<FotoComponent>;
  let camera: jasmine.SpyObj<Pick<CameraPlugin, 'getPhoto'>>;
  let fetchSpy: jasmine.Spy<typeof fetch>;

  beforeEach(async () => {
    camera = jasmine.createSpyObj('Camera', ['getPhoto']);
    camera.getPhoto.and.resolveTo({ webPath: 'https://localhost/_capacitor_file_/foto.jpg', format: 'jpeg', saved: false });
    fetchSpy = spyOn(window, 'fetch').and.callFake(async () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:foto-prueba');
    await TestBed.configureTestingModule({
      imports: [FotoComponent, IonicModule.forRoot()],
      providers: [
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => platform, isNativePlatform: () => platform !== 'web' } },
        { provide: CAPACITOR_CAMERA, useValue: camera },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FotoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  if (platform === 'web') {
  it('web conserva input JPEG/PNG y no invoca plugins', async () => {
    const input = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    spyOn(input, 'click');
    await component.abrirSelector();
    expect(input.click).toHaveBeenCalledTimes(1);
    expect(input.accept).toBe('image/jpeg,image/png');
    expect(camera.getPhoto).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Tomar foto');
  });
  } else {
    it('Tomar foto usa CameraSource.Camera, URI y emite File con vista previa', async () => {
      const emitir = spyOn(component.fotoTomada, 'emit');
      await component.tomarFoto();
      expect(camera.getPhoto).toHaveBeenCalledWith(jasmine.objectContaining({ source: CameraSource.Camera, resultType: CameraResultType.Uri, saveToGallery: false }));
      const foto = emitir.calls.mostRecent().args[0];
      expect(foto.archivo instanceof File).toBeTrue();
      expect(foto.archivo.type).toBe('image/jpeg');
      expect(foto.vistaPrevia).toBe('blob:foto-prueba');
      expect(component.procesando()).toBeFalse();
      expect(fixture.nativeElement.textContent).toContain('Tomar foto');
      expect(fixture.nativeElement.textContent).toContain('Elegir de galería');
    });

    it('Elegir de galería usa exclusivamente CameraSource.Photos', async () => {
      await component.abrirSelector();
      expect(camera.getPhoto).toHaveBeenCalledOnceWith(jasmine.objectContaining({ source: CameraSource.Photos }));
    });

    it('cancelación no emite ni muestra un falso error', async () => {
      camera.getPhoto.and.rejectWith(new Error('User cancelled photos app'));
      const emitir = spyOn(component.fotoTomada, 'emit');
      await component.tomarFoto();
      expect(emitir).not.toHaveBeenCalled();
      expect(component.error()).toBe('');
      expect(component.procesando()).toBeFalse();
    });

    it('permisos y errores de lectura son comprensibles y permiten reintentar', async () => {
      camera.getPhoto.and.rejectWith(new Error('User denied access to camera'));
      await component.tomarFoto();
      expect(component.error()).toContain('permisos');
      expect(component.procesando()).toBeFalse();
      camera.getPhoto.and.resolveTo({ webPath: 'https://localhost/foto', format: 'jpeg', saved: false });
      fetchSpy.and.rejectWith(new Error('detalle interno'));
      await component.tomarFoto();
      expect(component.error()).toBe('No se pudo obtener la fotografía. Intentá nuevamente.');
    });

    it('valida firma y límite 5 MB también en resultados nativos', async () => {
      const emitir = spyOn(component.fotoTomada, 'emit');
      fetchSpy.and.callFake(async () => new Response(new Blob(['falso'])));
      await component.tomarFoto();
      expect(component.error()).toContain('contenido');
      fetchSpy.and.callFake(async () => new Response(new Blob([new Uint8Array(5_000_001)])));
      await component.abrirSelector();
      expect(component.error()).toContain('5 MB');
      expect(emitir).not.toHaveBeenCalled();
    });
  }

  it('cancelar no emite, no procesa y no crea overlays', async () => {
    const emitir = spyOn(component.fotoTomada, 'emit');
    await component.archivoCambiado({ target: { files: null, value: '' } } as unknown as Event);
    expect(emitir).not.toHaveBeenCalled();
    expect(component.procesando()).toBeFalse();
    expect(document.querySelector('ion-loading')).toBeNull();
  });

  it('JPEG válido genera una vista previa local', async () => {
    const archivo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'pozo.jpg', { type: 'image/jpeg' });
    const emitir = spyOn(component.fotoTomada, 'emit');
    await seleccionar(component, archivo);
    expect(emitir).toHaveBeenCalledWith({ archivo, vistaPrevia: 'blob:foto-prueba' });
  });

  it('PNG válido genera una vista previa local', async () => {
    const archivo = new File([pngValido()], 'pozo.png', { type: 'image/png' });
    const emitir = spyOn(component.fotoTomada, 'emit');
    await seleccionar(component, archivo);
    expect(emitir).toHaveBeenCalledWith({ archivo, vistaPrevia: 'blob:foto-prueba' });
  });

  it('rechaza tipo, tamaño y firma inválidos sin dejar procesamiento activo', async () => {
    expect(() => validarFoto(new File(['x'], 'x.txt', { type: 'text/plain' }), new Uint8Array([1]))).toThrowError(/JPEG o PNG/);
    expect(() => validarFoto(new File([new Uint8Array(5_000_001)], 'x.jpg', { type: 'image/jpeg' }), new Uint8Array(5_000_001))).toThrowError(/5 MB/);
    await seleccionar(component, new File(['contenido falso'], 'x.png', { type: 'image/png' }));
    expect(component.error()).toContain('contenido');
    expect(component.procesando()).toBeFalse();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toBe(component.error());
    await seleccionar(component, new File([], 'x.jpg', { type: 'image/jpeg' }));
    expect(component.error()).toContain('vacía');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
}

function seleccionar(component: FotoComponent, archivo: File): Promise<void> {
  return component.archivoCambiado({ target: { files: { item: () => archivo }, value: 'C:\\fakepath\\foto' } } as unknown as Event);
}

function pngValido(): ArrayBuffer { return Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).buffer; }
