import { Rol } from '../types/schemas';
import {
  reconciliarRolesActuales,
  validarRolesSeleccionados,
} from './roles-seleccion';

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

describe('reconciliarRolesActuales', () => {
  it('devuelve catálogo y selección vacíos cuando el catálogo está vacío', () => {
    expect(reconciliarRolesActuales([], [])).toEqual({ catalogo: [], seleccion: [] });
  });

  it('deduplica y selecciona los objetos del catálogo por id_rol', () => {
    const canonico: Rol = { id_rol: 8, nombre: 'canonico', descr: 'Canónico' };
    const obsoleto: Rol = { id_rol: 8, nombre: 'obsoleto', descr: 'Obsoleto' };

    const resultado = reconciliarRolesActuales([obsoleto, { ...obsoleto }], [canonico]);

    expect(resultado.seleccion).toEqual([canonico]);
    expect(resultado.seleccion[0]).toBe(canonico);
  });

  it('rechaza un rol actual ausente del catálogo', () => {
    const rolActual: Rol = { id_rol: 8, nombre: 'ausente', descr: 'Ausente' };

    expect(() => reconciliarRolesActuales([rolActual], [])).toThrowError(
      'La cuenta posee roles que ya no están disponibles en el catálogo.'
    );
  });
});
