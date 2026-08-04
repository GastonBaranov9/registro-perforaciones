import { Rol, UsuarioFormulario } from '../types/schemas';
import { construirUsuarioActualizarBody } from './usuario-actualizacion';

describe('construirUsuarioActualizarBody', () => {
  const roles: Rol[] = [{ id_rol: 7, nombre: 'rol', descr: 'Rol' }];

  const usuario = (password: string): UsuarioFormulario => ({
    email: ' usuario@example.com ',
    nombre: ' Usuario ',
    password,
    activo: true,
    roles,
  });

  it('omite password cuando está vacío para conservar la contraseña actual', () => {
    const body = construirUsuarioActualizarBody(usuario(''), roles);

    expect(body.password).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, 'password')).toBeFalse();
  });

  it('incluye password literalmente cuando está presente', () => {
    const body = construirUsuarioActualizarBody(usuario(' nueva-clave '), roles);

    expect(body.password).toBe(' nueva-clave ');
  });
});
