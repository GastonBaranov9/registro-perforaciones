import {
  Rol,
  UsuarioActualizarBody,
  UsuarioFormulario,
} from '../types/schemas';

export function construirUsuarioActualizarBody(
  usuario: UsuarioFormulario,
  roles: Rol[]
): UsuarioActualizarBody {
  return {
    email: usuario.email.trim(),
    nombre: usuario.nombre.trim(),
    activo: usuario.activo,
    roles,
    ...(usuario.password.length > 0 ? { password: usuario.password } : {}),
  };
}
