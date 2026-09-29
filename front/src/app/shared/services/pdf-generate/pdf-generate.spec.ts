import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Directory, FilesystemPlugin } from '@capacitor/filesystem';
import { SharePlugin } from '@capacitor/share';
import { CAPACITOR_FILESYSTEM, CAPACITOR_RUNTIME, CAPACITOR_SHARE } from '../../../core/native/native-plugin.tokens';
import { environment } from '../../../../environments/environment';
import { PdfGenerate } from './pdf-generate';

for (const platform of ['web', 'android', 'ios'] as const) {
  describe(`PdfGenerate ${platform}`, () => {
    let service: PdfGenerate;
    let http: HttpTestingController;
    let filesystem: jasmine.SpyObj<Pick<FilesystemPlugin, 'writeFile' | 'readdir' | 'deleteFile'>>;
    let share: jasmine.SpyObj<Pick<SharePlugin, 'share'>>;
    const pdf = () => new Blob(['%PDF-1.7\ncontenido'], { type: 'application/pdf' });

    beforeEach(() => {
      filesystem = jasmine.createSpyObj('Filesystem', ['writeFile', 'readdir', 'deleteFile']);
      filesystem.writeFile.and.resolveTo({ uri: 'file:///cache/informes-pdf/informe_pozo_8.pdf' });
      filesystem.readdir.and.resolveTo({ files: [] });
      filesystem.deleteFile.and.resolveTo();
      share = jasmine.createSpyObj('Share', ['share']);
      share.share.and.resolveTo({});
      TestBed.configureTestingModule({ providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => platform, isNativePlatform: () => platform !== 'web' } },
        { provide: CAPACITOR_FILESYSTEM, useValue: filesystem },
        { provide: CAPACITOR_SHARE, useValue: share },
      ] });
      service = TestBed.inject(PdfGenerate);
      http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => http.verify());

    function responder(blob = pdf()): void {
      const request = http.expectOne(environment.apiURL + 'usuarios/7/pozos/8/informe-pdf');
      expect(request.request.responseType).toBe('blob');
      request.flush(blob);
    }

    if (platform === 'web') {
      it('descarga web con nombre correcto y libera ObjectURL', async () => {
        spyOn(URL, 'createObjectURL').and.returnValue('blob:informe');
        spyOn(URL, 'revokeObjectURL');
        let nombre = '';
        spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
          nombre = this.download;
          expect(this.href).toBe('blob:informe');
        });
        const resultado = service.exportarInformePozo(7, 8);
        responder();
        await resultado;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(nombre).toBe('informe_pozo_8.pdf');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:informe');
        expect(document.querySelector('a[download="informe_pozo_8.pdf"]')).toBeNull();
        expect(filesystem.writeFile).not.toHaveBeenCalled();
        expect(share.share).not.toHaveBeenCalled();
      });
    } else {
      it('guarda en cache privada y comparte URI nativa sin usar a.download', async () => {
        spyOn(HTMLAnchorElement.prototype, 'click');
        spyOn(URL, 'createObjectURL');
        const resultado = service.exportarInformePozo(7, 8);
        responder();
        await resultado;
        expect(filesystem.writeFile).toHaveBeenCalledOnceWith({
          path: 'informes-pdf/informe_pozo_8.pdf', directory: Directory.Cache,
          data: btoa('%PDF-1.7\ncontenido'), recursive: true,
        });
        expect(share.share).toHaveBeenCalledOnceWith({
          files: ['file:///cache/informes-pdf/informe_pozo_8.pdf'],
          title: 'informe_pozo_8.pdf', dialogTitle: 'Abrir o compartir informe PDF',
        });
        expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(filesystem.deleteFile).not.toHaveBeenCalled();
      });

      it('limita caché a diez informes y purga antiguos sin borrar el compartido', async () => {
        const files = Array.from({ length: 12 }, (_, index) => ({
          name: `informe_pozo_${index + 20}.pdf`, type: 'file' as const, size: 20,
          mtime: Date.now() - index * 1000, uri: `file:///cache/${index}`,
        }));
        files[0].mtime = Date.now() - 25 * 60 * 60 * 1000;
        filesystem.readdir.and.resolveTo({ files });
        const resultado = service.exportarInformePozo(7, 8);
        responder();
        await resultado;
        expect(filesystem.deleteFile).toHaveBeenCalledTimes(3);
        expect(filesystem.deleteFile).toHaveBeenCalledWith({ path: 'informes-pdf/informe_pozo_20.pdf', directory: Directory.Cache });
        expect(filesystem.deleteFile).not.toHaveBeenCalledWith({ path: 'informes-pdf/informe_pozo_8.pdf', directory: Directory.Cache });
      });

      it('cancelar compartir no falla; fallo de escritura se propaga', async () => {
        share.share.and.rejectWith(new Error('Share canceled'));
        const cancelado = service.exportarInformePozo(7, 8);
        responder();
        await expectAsync(cancelado).toBeResolved();
        filesystem.writeFile.and.rejectWith(new Error('Sin espacio'));
        const fallido = service.exportarInformePozo(7, 8);
        responder();
        await expectAsync(fallido).toBeRejected();
        expect(share.share).toHaveBeenCalledTimes(1);
      });

      it('un fallo al listar caché no impide compartir el PDF recién escrito', async () => {
        filesystem.readdir.and.rejectWith(new Error('No se pudo listar la caché'));
        const resultado = service.exportarInformePozo(7, 8);
        responder();
        await expectAsync(resultado).toBeResolved();
        expect(share.share).toHaveBeenCalledOnceWith(jasmine.objectContaining({
          files: ['file:///cache/informes-pdf/informe_pozo_8.pdf'],
        }));
      });

      it('un archivo antiguo no eliminable no bloquea Share ni la limpieza de los demás', async () => {
        filesystem.readdir.and.resolveTo({ files: [20, 21].map((id) => ({
          name: `informe_pozo_${id}.pdf`, type: 'file' as const, size: 20,
          mtime: Date.now() - 25 * 60 * 60 * 1000, uri: `file:///cache/informes-pdf/informe_pozo_${id}.pdf`,
        })) });
        filesystem.deleteFile.and.callFake(async ({ path }) => {
          if (path.endsWith('20.pdf')) throw new Error('Archivo no disponible');
        });
        const resultado = service.exportarInformePozo(7, 8);
        responder();
        await expectAsync(resultado).toBeResolved();
        expect(filesystem.deleteFile).toHaveBeenCalledWith({
          path: 'informes-pdf/informe_pozo_21.pdf', directory: Directory.Cache,
        });
        expect(share.share).toHaveBeenCalledTimes(1);
      });
    }

    it('rechaza PDF vacío, MIME incorrecto y contenido falso', async () => {
      for (const blob of [new Blob([], { type: 'application/pdf' }), new Blob(['%PDF-falso'], { type: 'text/html' }), new Blob(['error'], { type: 'application/pdf' })]) {
        const resultado = service.exportarInformePozo(7, 8);
        responder(blob);
        await expectAsync(resultado).toBeRejectedWithError('El informe recibido no es un PDF válido.');
      }
      expect(filesystem.writeFile).not.toHaveBeenCalled();
      expect(share.share).not.toHaveBeenCalled();
    });

    it('propaga error HTTP sin abrir ni compartir un archivo inválido', async () => {
      const resultado = service.exportarInformePozo(7, 8);
      http.expectOne(environment.apiURL + 'usuarios/7/pozos/8/informe-pdf')
        .flush(new Blob(), { status: 500, statusText: 'Server error' });
      await expectAsync(resultado).toBeRejected();
      expect(share.share).not.toHaveBeenCalled();
    });
  });
}
