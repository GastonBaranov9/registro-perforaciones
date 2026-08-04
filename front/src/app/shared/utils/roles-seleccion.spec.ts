import { Rol } from '../types/schemas';
import { validarRolesSeleccionados } from './roles-seleccion';

describe('validarRolesSeleccionados', () => {
  const catalogo: Rol[] = [
    { id_rol: 10, nombre: 'rol-a', descr: 'Rol A' },
    { id_rol: 20, nombre: 'rol-b', descr: 'Rol B' },
  ];

  it('rechaza una selección vacía', () => {
    expect(() => validarRolesSeleccionados([], catalogo)).toThrowError(
      'Debe seleccionar al menos un rol.'
    );
  });

  it('acepta un rol válido y usa el objeto del catálogo', () => {
    const seleccionado = { ...catalogo[0] };

    const resultado = validarRolesSeleccionados([seleccionado], catalogo);

    expect(resultado).toEqual([catalogo[0]]);
    expect(resultado[0]).toBe(catalogo[0]);
  });

  it('acepta múltiples roles válidos', () => {
    expect(validarRolesSeleccionados([catalogo[0], catalogo[1]], catalogo)).toEqual(
      catalogo
    );
  });

  it('elimina roles seleccionados duplicados por id_rol', () => {
    const duplicado = { ...catalogo[0], nombre: 'nombre-obsoleto' };

    expect(validarRolesSeleccionados([catalogo[0], duplicado], catalogo)).toEqual([
      catalogo[0],
    ]);
  });

  it('rechaza un id ajeno al catálogo', () => {
    const ajeno: Rol = { id_rol: 99, nombre: 'ajeno', descr: 'Ajeno' };

    expect(() => validarRolesSeleccionados([ajeno], catalogo)).toThrowError(
      'La selección contiene roles que no están disponibles.'
    );
  });

  it('conserva los roles de edición sin cambios usando objetos del catálogo', () => {
    const rolesDelUsuario = catalogo.map((rol) => ({ ...rol }));

    const resultado = validarRolesSeleccionados(rolesDelUsuario, catalogo);

    expect(resultado.map((rol) => rol.id_rol)).toEqual([10, 20]);
    expect(resultado[0]).toBe(catalogo[0]);
    expect(resultado[1]).toBe(catalogo[1]);
  });
});
