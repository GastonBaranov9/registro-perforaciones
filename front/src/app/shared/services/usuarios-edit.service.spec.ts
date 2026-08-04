import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { UsuarioActualizarBody, UsuarioPublico } from '../types/schemas';
import { UsuariosEditService } from './usuarios-edit.service';

describe('UsuariosEditService', () => {
  let service: UsuariosEditService;
  let httpTesting: HttpTestingController;

  const usuario: UsuarioPublico = {
    id_usuario: 5,
    email: 'actual@example.com',
    nombre: 'Actual',
    activo: true,
    fecha_registro: '2026-01-01',
    roles: [{ id_rol: 3, nombre: 'propietario', descr: 'Propietario' }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsuariosEditService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('obtiene el usuario mediante GET al endpoint identificado', async () => {
    const resultado = service.getUsuarioById(usuario.id_usuario);
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios/5`);

    expect(request.request.method).toBe('GET');
    request.flush(usuario);
    await expectAsync(resultado).toBeResolvedTo(usuario);
  });

  it('actualiza mediante PUT y conserva literalmente el body', async () => {
    const body: UsuarioActualizarBody = {
      email: usuario.email,
      nombre: usuario.nombre,
      password: ' nueva password ',
      activo: usuario.activo,
      roles: usuario.roles ?? [],
    };
    const resultado = service.editUsuario(usuario.id_usuario, body);
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios/5`);

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(body);
    request.flush(usuario);
    await expectAsync(resultado).toBeResolvedTo(usuario);
  });
});
