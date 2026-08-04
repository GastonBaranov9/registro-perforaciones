import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { UsuarioCrearBody, UsuarioPublico } from '../types/schemas';
import { UsuariosCreateService } from './usuarios-create.service';

describe('UsuariosCreateService', () => {
  let service: UsuariosCreateService;
  let httpTesting: HttpTestingController;

  const body: UsuarioCrearBody = {
    email: 'nuevo@example.com',
    nombre: 'Nuevo',
    password: ' password literal ',
    activo: true,
    roles: [{ id_rol: 4, nombre: 'operador', descr: 'Operador' }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsuariosCreateService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('crea un usuario mediante POST con el body recibido', async () => {
    const respuesta: UsuarioPublico = {
      id_usuario: 8,
      email: body.email,
      nombre: body.nombre,
      activo: true,
      fecha_registro: '2026-01-01',
      roles: body.roles,
    };
    const resultado = service.createUsuario(body);
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(body);
    request.flush(respuesta);
    await expectAsync(resultado).toBeResolvedTo(respuesta);
  });

  it('expone un mensaje claro ante un error de la API', async () => {
    const resultado = service.createUsuario(body);
    const request = httpTesting.expectOne(`${environment.apiURL}usuarios`);
    request.flush({ message: 'Email ya registrado' }, { status: 409, statusText: 'Conflict' });

    await expectAsync(resultado).toBeRejectedWithError('Email ya registrado');
  });
});
