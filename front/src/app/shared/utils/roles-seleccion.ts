import { Rol } from '../types/schemas';

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
