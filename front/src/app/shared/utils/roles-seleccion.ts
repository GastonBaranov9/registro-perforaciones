import { Rol } from '../types/schemas';

export type RolesReconciliados = {
  catalogo: Rol[];
  seleccion: Rol[];
};

export function reconciliarRolesActuales(
  rolesActuales: readonly Rol[],
  catalogo: readonly Rol[]
): RolesReconciliados {
  const catalogoPorId = new Map<number, Rol>();
  for (const rol of catalogo) {
    catalogoPorId.set(rol.id_rol, rol);
  }

  const idsActuales = new Set(rolesActuales.map((rol) => rol.id_rol));
  const contieneRolInexistente = Array.from(idsActuales).some(
    (idRol) => !catalogoPorId.has(idRol)
  );

  if (contieneRolInexistente) {
    throw new Error(
      'La cuenta posee roles que ya no están disponibles en el catálogo.'
    );
  }

  return {
    catalogo: Array.from(catalogoPorId.values()),
    seleccion: Array.from(idsActuales).map((idRol) => catalogoPorId.get(idRol)!),
  };
}

export function validarRolesSeleccionados(
  rolesSeleccionados: readonly Rol[],
  catalogo: readonly Rol[]
): Rol[] {
  const catalogoPorId = new Map<number, Rol>();
  for (const rol of catalogo) {
    catalogoPorId.set(rol.id_rol, rol);
  }

  const idsSeleccionados = new Set(rolesSeleccionados.map((rol) => rol.id_rol));

  if (idsSeleccionados.size === 0) {
    throw new Error('Debe seleccionar al menos un rol.');
  }

  const contieneRolInexistente = Array.from(idsSeleccionados).some(
    (idRol) => !catalogoPorId.has(idRol)
  );

  if (contieneRolInexistente) {
    throw new Error('La selección contiene roles que no están disponibles.');
  }

  return Array.from(idsSeleccionados).map((idRol) => catalogoPorId.get(idRol)!);
}
