import createError from "@fastify/error";

import { Type } from "@sinclair/typebox";

export const ErrorSchema = Type.Object({
  statusCode: Type.Integer(),
  error: Type.String(),
  message: Type.String(),
  code: Type.Optional(Type.String()),
});

export const T05ErrorDesconocido = createError(
  "ERR1_T05",
  "Error desconocido",
  500,
  Error
);
export const T05ErrorConexion = createError(
  "ERR2_T05",
  "Error de conexión a la base de datos",
  503,
  Error
);

export const T05UsuarioNoEncontrado = createError(
  "ERR3_T05",
  "Elemento no encontrado",
  404,
  Error
);
export const T05NoAutorizado = createError(
  "ERR4_T05",
  "Se requiere autenticación para realizar esta acción",
  401,
  Error
);
export const T05SinPermiso = createError(
  "ERR5_T05",
  "No tiene permisos suficientes para realizar esta acción",
  403,
  Error
);

export const T05DatosIncorrectos = createError(
  "ERR6_T05",
  "Los datos enviados no son correctos",
  400,
  Error
);

export const T05RegistroNoEncontrado = createError(
  "ERR8_T05",
  "No se encontró el registro DINAGUA solicitado",
  404
);

export const T05RegistroDuplicado = createError(
  "ERR9_T05",
  "Ya existe un registro DINAGUA para este pozo",
  409
);

export const T05PozoNoEncontrado = createError(
  "ERR10_T05",
  "No se encontró el pozo solicitado",
  404
);

export const T05SinImplementar = createError(
  "ERR11_T05",
  "Función no implementada",
  501,
  Error
);

export const T05TransicionInvalida = createError(
  "ERR12_T05",
  "No se puede realizar está transición",
  400,
  Error
);

export const T05SitioNoEncontrado = createError(
  "ERR13_T05",
  "No se encontró el sitio solicitado",
  404
);

export const T05EmpresaNoEncontrada = createError(
  "ERR14_T05",
  "No se encontró la empresa solicitada",
  404
);

export const T05InformeNoEncontrado = createError(
  "ERR15_T05",
  "No se encontró el informe solicitado",
  404
);

export const T05RolNoEncontrado = createError(
  "ERR16_T05",
  "No se encontró el rol solicitado",
  404
);

