import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { UsuarioPublico } from '../types/schemas';
import { UsuariosListService } from './usuarios-list.service';

describe('UsuariosListService', () => {
  let service: UsuariosListService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsuariosListService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lista usuarios mediante GET', async () => {
    const usuarios: UsuarioPublico[] = [
      {
        id_usuario: 2,
        email: 'lista@example.com',
        nombre: 'Lista',
        activo: true,
        fecha_registro: '2026-01-01',
        roles: [],
      },
    ];
    const resultado = service.getListaUsuarios();
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios`);

    expect(request.request.method).toBe('GET');
    request.flush(usuarios);
    await expectAsync(resultado).toBeResolvedTo(usuarios);
  });

  it('elimina el usuario identificado mediante DELETE', async () => {
    const resultado = service.deleteUsuario(12);
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios/12`);

    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await expectAsync(resultado).toBeResolved();
  });
});
