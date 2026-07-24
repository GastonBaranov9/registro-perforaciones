import { Type, type Static } from "@sinclair/typebox";

export const RevestimientoValores = {
  PVC_6: "PVC: 6",
  PVC_8: "PVC: 8",
  PVC_10: "PVC: 10",
  PVC_12: "PVC: 12",
  HIERRO_6: "Hierro: 6",
  HIERRO_8: "Hierro: 8",
  HIERRO_10: "Hierro: 10",
  HIERRO_12: "Hierro: 12",
} as const;

export const RevestimientoSchema = Type.Enum(RevestimientoValores);

export const Rol = Type.Object({
  id_rol: Type.Integer(),
  nombre: Type.String(),
  descr: Type.String(),
});

export type Rol = Static<typeof Rol>;

export const Usuario = Type.Object({
  id_usuario: Type.Integer(),
  email: Type.String({ format: "email" }),
  nombre: Type.String(),
  password: Type.String(),
  activo: Type.Boolean(),
  fecha_registro: Type.String({ format: "date-time" }),
  roles: Type.Optional(Type.Array(Rol)),
});

export type Usuario = Static<typeof Usuario>;

export const UsuarioRegister = Type.Omit(Usuario, [
  "id_usuario",
  "activo",
  "fecha_registro",
]);
export type UsuarioRegister = Static<typeof UsuarioRegister>;

export const UsuarioLogin = Type.Pick(Usuario, ["email", "password"]);
export type UsuarioLogin = Static<typeof UsuarioLogin>;

export const RolBody = Type.Omit(Rol, ["id_rol"]);

export type RolBody = Static<typeof RolBody>;

export const Usuario_Rol = Type.Object({
  id_usuario: Type.Integer(),
  id_rol: Type.Integer(),
});

export type Usuario_Rol = Static<typeof Usuario_Rol>;

export const Permiso = Type.Object({
  id_permiso: Type.Integer(),
  clave: Type.String(),
  descr: Type.String(),
});

export type Permiso = Static<typeof Permiso>;

export const Rol_Permiso = Type.Object({
  id_rol: Type.Integer(),
  id_permiso: Type.Integer(),
});

export type Rol_Permiso = Static<typeof Rol_Permiso>;

export const Sitio = Type.Object({
  id_sitio: Type.Integer(),
  departamento: Type.String(),
  localidad: Type.Optional(Type.String()),
  latitud: Type.Optional(Type.String()),
  longitud: Type.Optional(Type.String()),
});

export type Sitio = Static<typeof Sitio>;

export const Pozo = Type.Object({
  id_pozo: Type.Integer(),
  id_propietario: Type.Integer(),
  id_sitio: Type.Integer(),
  empresa: Type.Optional(Type.String()),
  id_perforador: Type.Integer(),
  fecha_inicio: Type.Optional(Type.String({ format: "date" })),
  fecha_fin: Type.Optional(Type.String({ format: "date" })),
  profundidad_final_m: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  sello_sanitario: Type.Optional(Type.Boolean()),
  pre_filtro: Type.Optional(Type.String()),
  nivel_estatico_m: Type.Optional(Type.Number()),
  nivel_dinamico_m: Type.Optional(Type.Number()),
  caudal_estimado_lh: Type.Optional(Type.Integer()),
  metodo_sedimentario: Type.Optional(Type.String()),
  metodo_rocoso: Type.Optional(Type.String()),
  cementacion: Type.Optional(Type.String()), //Es lo mismo siempre
  desarrollo: Type.Optional(Type.String()), //Es lo mismo siempre
  revestimiento: Type.Optional(Type.String()),
  creado_por: Type.Optional(Type.Integer()),
  fecha_creado: Type.String({ format: "date-time" }),
  foto_url: Type.Optional(Type.String()),
});
export type Pozo = Static<typeof Pozo>;

export const IntervaloLitologico = Type.Object({
  id_intervalo_litologico: Type.Integer(),
  id_pozo: Type.Integer(),
  desde_m: Type.Number(),
  hasta_m: Type.Number(),
  material: Type.String(),
});

export type IntervaloLitologico = Static<typeof IntervaloLitologico>;

export const IntervaloDiametroPerforacion = Type.Object({
  id_intervalo_diametro_perforacion: Type.Integer(),
  id_pozo: Type.Integer(),
  desde_m: Type.Number(),
  hasta_m: Type.Number(),
  diametro_pulg: Type.Number(),
});

export type IntervaloDiametroPerforacion = Static<
  typeof IntervaloDiametroPerforacion
>;

export const NivelAporte = Type.Object({
  id_nivel_aporte: Type.Integer(),
  id_pozo: Type.Integer(),
  profundidad_m: Type.Number({minimum: 0}),
});

export type NivelAporte = Static<typeof NivelAporte>;

export const Estado = Type.Object({
  id_estado: Type.Integer(),
  clave: Type.String(),
  nombre: Type.String(),
  orden: Type.Number(),
});

export type Estado = Static<typeof Estado>;

export const Transicion = Type.Object({
  id_transicion: Type.Integer(),
  estado_desde: Type.Number(),
  estado_hasta: Type.Number(),
});

export type Transicion = Static<typeof Transicion>;

export const ReglaTransicion = Type.Object({
  id_transicion: Type.Integer(),
  id_rol: Type.Integer(),
});

export type ReglaTransicion = Static<typeof ReglaTransicion>;

export const Documento = Type.Object({
  id_documento: Type.Integer(),
  id_pozo: Type.Integer(),
  tipo: Type.String(),
  nombre_archivo: Type.String(),
  ruta: Type.String(),
  generado_por: Type.Number(),
  generado_en: Type.String({ format: "date-time" }),
});

export type Documento = Static<typeof Documento>;

export const InformeAntes = Type.Object({
  id_informe: Type.Integer(),
  id_pozo: Type.Integer(),
  titulo: Type.String(),
  descripcion: Type.Optional(Type.String()),
  generado_por: Type.Integer(),
  generado_en: Type.String({ format: "date-time" }),
});

export type InformeAntes = Static<typeof Informe>;

export const InformeBody = Type.Omit(InformeAntes, ["id_informe", "id_pozo"]);
export type InformeBody = Static<typeof InformeBody>;

export const bodyIntervaloLitologico = Type.Omit(IntervaloLitologico, [
  "id_intervalo_litologico",
  "id_pozo",
]);

export type bodyIntervaloLitologico = Static<typeof bodyIntervaloLitologico>;

export const UsuarioBody = Type.Omit(Usuario, ["id_usuario", "fecha_registro"]);
export type UsuarioBody = Static<typeof UsuarioBody>;

export const IntervaloDiametroPerforacionBody = Type.Omit(
  IntervaloDiametroPerforacion,
  ["id_pozo", "id_intervalo_diametro_perforacion"]
);

export type IntervaloDiametroPerforacionBody = Static<
  typeof IntervaloDiametroPerforacionBody
>;

export const NivelAporteBody = Type.Pick(NivelAporte, ["profundidad_m"]);
export type NivelAporteBody = Static<typeof NivelAporteBody>;

export const SitioBody = Type.Omit(Sitio, ["id_sitio"]);
export type SitioBody = Static<typeof SitioBody>;

export const NuevoPozo = Type.Omit(Pozo, ["id_pozo", "fecha_creado"]);

export type NuevoPozo = Static<typeof NuevoPozo>;

export const PozoUpdate = Type.Omit(Pozo, [
  "id_pozo",
  "creado_por",
  "fecha_creado",
]);

export type PozoUpdate = Static<typeof PozoUpdate>;

export const Informe = Type.Object({
  id_perforacion: Type.Integer(),
  propietario_email: Type.String({ format: "email" }),
  propietario_nombre: Type.String(),
  ubicacion: Type.String(),
  empresa: Type.Optional(Type.String()),
  perforador: Type.String(),
  fecha_inicio: Type.Optional(Type.String({ format: "date" })),
  fecha_fin: Type.Optional(Type.String({ format: "date" })),
  profundidad_final_m: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  sello_sanitario: Type.Optional(Type.Boolean()),
  pre_filtro: Type.Optional(Type.String()),
  nivel_estatico_m: Type.Optional(Type.Number()),
  nivel_dinamico_m: Type.Optional(Type.Number()),
  caudal_estimado_lh: Type.Optional(Type.Integer()),
  metodo_sedimentario: Type.Optional(Type.String()),
  metodo_rocoso: Type.Optional(Type.String()),
  cementacion: Type.Optional(Type.String()),
  desarrollo: Type.Optional(Type.String()),
  diametro_perforacion: Type.Optional(Type.Number()),
  nivel_aporte_m: Type.Optional(Type.Number()),
  filtros: Type.Optional(Type.String()),
  diametro_tuberia: Type.Optional(Type.Number()),
  fecha_creado: Type.String({ format: "date-time" }),
});

export type Informe = Static<typeof Informe>;

export const CaracteristicasConstructivas = Type.Object({
  id_pozo: Type.Integer(),
  metodo_sedimentario: Type.String(),
  metodo_rocoso: Type.String(),
  cementacion: Type.String(),
  desarrollo: Type.String(),
  revestimiento: Type.Array(
    Type.Object({
      material: Type.String(),
      diametro_pulg: Type.Number(),
    })
  ),
  diametro_desde: Type.Number(),
  diametro_hasta: Type.Number(),
  diametro_tuberia: Type.Number(),
});

export type CaracteristicasConstructivas = Static<
  typeof CaracteristicasConstructivas
>;
