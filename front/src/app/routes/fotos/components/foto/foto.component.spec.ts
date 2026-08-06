import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { FotoComponent, validarFoto } from './foto.component';

describe('FotoComponent', () => {
  let component: FotoComponent;
  let fixture: ComponentFixture<FotoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FotoComponent, IonicModule.forRoot()] }).compileComponents();
    fixture = TestBed.createComponent(FotoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('abre el selector nativo al pulsar Subir foto', () => {
    const input = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    spyOn(input, 'click');
    component.abrirSelector();
    expect(input.click).toHaveBeenCalledTimes(1);
  });

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
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ archivo, vistaPrevia: jasmine.stringMatching(/^data:image\/jpeg;base64,/) }));
  });

  it('PNG válido genera una vista previa local', async () => {
    const archivo = new File([pngValido()], 'pozo.png', { type: 'image/png' });
    const emitir = spyOn(component.fotoTomada, 'emit');
    await seleccionar(component, archivo);
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ archivo, vistaPrevia: jasmine.stringMatching(/^data:image\/png;base64,/) }));
  });

  it('rechaza tipo, tamaño y firma inválidos sin dejar procesamiento activo', async () => {
    expect(() => validarFoto(new File(['x'], 'x.txt', { type: 'text/plain' }), new Uint8Array([1]))).toThrowError(/JPEG o PNG/);
    expect(() => validarFoto(new File([new Uint8Array(5_000_001)], 'x.jpg', { type: 'image/jpeg' }), new Uint8Array(5_000_001))).toThrowError(/5 MB/);
    await seleccionar(component, new File(['contenido falso'], 'x.png', { type: 'image/png' }));
    expect(component.error()).toContain('contenido');
    expect(component.procesando()).toBeFalse();
  });
});

function seleccionar(component: FotoComponent, archivo: File): Promise<void> {
  return component.archivoCambiado({ target: { files: { item: () => archivo }, value: 'C:\\fakepath\\foto' } } as unknown as Event);
}

function pngValido(): ArrayBuffer { return Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).buffer; }
