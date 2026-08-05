export type Usuario = {
  id_usuario: number;
  email: string;
  nombre: string;
  password: string;
  activo: boolean;
  fecha_registro: string;
  roles?: Rol[];
};


export type UsuarioPublico = Omit<Usuario, 'password'>;

export type UsuarioCrearBody = {
  email: string;
  nombre: string;
  password: string;
  activo: boolean;
  roles: Rol[];
};

export type UsuarioActualizarBody = {
  email: string;
  nombre: string;
  password?: string;
  activo: boolean;
  roles: Rol[];
};

export type UsuarioFormulario = {
  email: string;
  nombre: string;
  password: string;
  activo: boolean;
  roles: Rol[];
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
  foto_url?: string;
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
  material_tuberia: MaterialTuberia | null;
};

export type MaterialTuberia = 'PVC' | 'Acero';

export type IntervaloDiametroPerforacionBody = {
  desde_m: number;
  hasta_m: number;
  diametro_pulg: number;
  material_tuberia: MaterialTuberia | '';
};

export type IntervaloFiltroBody = { desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: MaterialTuberia | '' };
export type IntervaloFiltro = Omit<IntervaloFiltroBody, 'material_tuberia'> & { id_intervalo_filtro: number; id_pozo: number; material_tuberia: MaterialTuberia };

export type NivelAporte = {
  id_nivel_aporte: number;
  id_pozo: number;
  profundidad_m: number;
};

export type NivelAporteBody = {
  profundidad_m: number;
};

export type ElementoBorrador<T> = { idLocal: string; dato: T };

export type DatosTecnicosBorrador = {
  intervalosLitologicos: Array<ElementoBorrador<IntervaloLitologicoBody>>;
  intervalosDiametro: Array<ElementoBorrador<IntervaloDiametroPerforacionBody>>;
  intervalosFiltro: Array<ElementoBorrador<IntervaloFiltroBody>>;
  nivelesAporte: Array<ElementoBorrador<NivelAporteBody>>;
};

export type PozoCompletoBody = {
  pozo: NuevoPozo;
  intervalos_litologicos: IntervaloLitologicoBody[];
  intervalos_diametro: IntervaloDiametroPerforacionBody[];
  intervalos_filtro: IntervaloFiltroBody[];
  niveles_aporte: NivelAporteBody[];
  foto?: { mime_type: 'image/jpeg' | 'image/png'; base64: string };
};

export type CandidatoPozo = { id_usuario: number; nombre: string; email: string; roles: string[] };
export type CatalogosPersonasPozo = { propietarios: CandidatoPozo[]; perforadores: CandidatoPozo[] };
export type AccionFotoEdicion = 'conservar' | 'eliminar' | 'reemplazar';
export type PozoCompletoUpdateBody = Omit<PozoCompletoBody, 'foto'> & {
  foto_accion: AccionFotoEdicion;
  foto?: PozoCompletoBody['foto'];
};

export type PozoCompletoResultado = {
  pozo: Pozo;
  intervalos_litologicos: IntervaloLitologico[];
  intervalos_diametro: IntervaloDiametroPerforacion[];
  intervalos_filtro: IntervaloFiltro[];
  niveles_aporte: NivelAporte[];
};

export type PatronLitologico =
  | 'diagonal'
  | 'diagonal-inversa'
  | 'cruz'
  | 'puntos'
  | 'horizontal'
  | 'vertical';

export type PerfilLitologico = {
  titulo: 'Perfil litológico del pozo';
  profundidad_m: number;
  paso_escala_m: number;
  tramos: Array<{
    clase: 'litologia' | 'hueco';
    desde_m: number;
    hasta_m: number;
    material: string;
    descripcion: string | null;
    estilo: { color: string; gris: number; patron: PatronLitologico };
    carril_etiqueta: number;
  }>;
  aportes: Array<{ profundidad_m: number; tipo: 'puntual'; desde_m: number; hasta_m: number; geometria: { x_inicio: 0.03; x_fin: 0.97; espesor_min_px: 12; patron: 'ondas' } }>;
  tuberias: Array<{tipo:'tuberia';desde_m:number;hasta_m:number;diametro_pulg:number;material_tuberia:MaterialTuberia|null;material_texto:string;carril_etiqueta:number;geometria:{x_inicio:number;x_fin:number;patron:'liso'|'metal'|'ranuras'}}>;
  filtros: Array<{tipo:'filtro';desde_m:number;hasta_m:number;diametro_pulg:number;material_tuberia:MaterialTuberia|null;material_texto:string;carril_etiqueta:number;geometria:{x_inicio:number;x_fin:number;patron:'liso'|'metal'|'ranuras'}}>;
  seccion_pozo: { tuberia_exterior_inicio: 0.36; tuberia_exterior_fin: 0.64; tuberia_interior_inicio: 0.43; tuberia_interior_fin: 0.57 };
  rangos: Array<{ desde_m: number; hasta_m: number }>;
  advertencias: string[];
  tiene_litologia: boolean;
};
