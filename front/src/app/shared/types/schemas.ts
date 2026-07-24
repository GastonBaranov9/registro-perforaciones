export type Usuario = {
  id_usuario: number;
  email: string;
  nombre: string;
  password: string;
  activo: boolean;
  fecha_registro: string;
  roles?: Rol[];
};

export type UsuarioBody = {
  email: string;
  nombre: string;
  password: string;
  activo: boolean;
  roles?: Rol[];
};

export type Pozo = {
  id_pozo: number;
  id_propietario: number;
  id_sitio: number;
  empresa?: string;
  id_perforador: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  profundidad_final_m?: number;
  sello_sanitario?: boolean;
  pre_filtro?: string;
  nivel_estatico_m?: number;
  nivel_dinamico_m?: number;
  caudal_estimado_lh?: number;
  metodo_sedimentario?: string;
  metodo_rocoso?: string;
  cementacion?: string; //Es lo mismo siempre
  desarrollo?: string; //Es lo mismo siempre
  revestimiento?: Revestimiento | null;
  creado_por?: number;
  fecha_creado: string;
  foto_url: string;
};

export type NuevoPozo = {
  id_propietario: number;
  id_sitio: number;
  empresa?: string;
  id_perforador: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  profundidad_final_m?: number;
  sello_sanitario?: boolean;
  pre_filtro?: string;
  nivel_estatico_m?: number;
  nivel_dinamico_m?: number;
  caudal_estimado_lh?: number;
  metodo_sedimentario?: string;
  metodo_rocoso?: string;
  cementacion?: string; //Es lo mismo siempre
  desarrollo?: string; //Es lo mismo siempre
  revestimiento?: Revestimiento | null;
  creado_por?: number;
  foto_url?: string;
};

export const RevestimientoValores = {
  PVC_6: 'PVC: 6',
  PVC_8: 'PVC: 8',
  PVC_10: 'PVC: 10',
  PVC_12: 'PVC: 12',
  HIERRO_6: 'Hierro: 6',
  HIERRO_8: 'Hierro: 8',
  HIERRO_10: 'Hierro: 10',
  HIERRO_12: 'Hierro: 12',
} as const;

export type Revestimiento = (typeof RevestimientoValores)[keyof typeof RevestimientoValores];

export type Rol = {
  id_rol: number;
  nombre: string;
  descr: string;
};

export type Credenciales = {
  email: string;
  password: string;
};

export type Sitio = {
  id_sitio: number;
  departamento: string;
  localidad?: string;
  latitud?: string;
  longitud?: string;
};

export type SitioBody = {
  departamento: string;
  localidad?: string;
  latitud?: string;
  longitud?: string;
};

export type IntervaloLitologico = {
  id_intervalo_litologico: number;
  id_pozo: number;
  desde_m: number;
  hasta_m: number;
  material: string;
};

export type IntervaloLitologicoBody = {
  desde_m: number;
  hasta_m: number;
  material: string;
};

export type IntervaloDiametroPerforacion = {
  id_intervalo_diametro_perforacion: number;
  id_pozo: number;
  desde_m: number;
  hasta_m: number;
  diametro_pulg: number;
};

export type IntervaloDiametroPerforacionBody = {
  desde_m: number;
  hasta_m: number;
  diametro_pulg: number;
};

export type NivelAporte = {
  id_nivel_aporte: number;
  id_pozo: number;
  profundidad_m: number;
};

export type NivelAporteBody = {
  profundidad_m: number;
};
