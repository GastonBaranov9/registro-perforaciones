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

export type UsuarioSesion = Omit<Usuario, 'password' | 'email' | 'activo' | 'fecha_registro'> &
  Partial<Pick<Usuario, 'email' | 'activo' | 'fecha_registro'>>;

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
  propietario_nombre?: string;
  propietario_email?: string | null;
  propietario_documento_rut?: string | null;
  propietario_telefono?: string | null;
  propietario_direccion?: string | null;
  propietario_localidad?: string | null;
  propietario_departamento?: string | null;
  propietario_observaciones?: string | null;
  perforador_nombre?: string;
  perforador_email?: string;
  sitio?: Sitio;
};

export type NuevoPozo = {
  id_propietario: number;
  id_sitio: number;
  empresa?: string;
  id_perforador: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  profundidad_final_m?: number;
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
  localidad?: string | null;
  latitud?: string | null;
  longitud?: string | null;
  padron?: string | null;
};

export type SitioBody = {
  departamento: string;
  localidad?: string | null;
  latitud?: string | null;
  longitud?: string | null;
  padron?: string | null;
};

export type IntervaloLitologico = {
  id_intervalo_litologico: number;
  id_pozo: number;
  desde_m: number;
  hasta_m: number;
  material: string;
  id_litologia: number | null;
  litologia_nombre?: string | null;
  litologia_color?: string | null;
  litologia_patron?: PatronCatalogoLitologia | null;
  litologia_activa?: boolean | null;
};

export type NuevoPozoCrear = Omit<NuevoPozo, 'id_sitio'>;

export type IntervaloLitologicoBody = {
  id_intervalo_litologico?: number;
  desde_m: number;
  hasta_m: number;
  material: string;
  id_litologia?: number;
};

export const familiasLitologia = ['basalto','suelo','arenisca','arcilla_arena','tosca','gravilla','granito','otro'] as const;
export const patronesLitologia = ['basalt','basalt_fractured','organic','sandstone_fine','sandstone_medium','sandstone_coarse','clay','sandy_clay','tosca','gravel_fine','gravel_coarse','granite'] as const;
export type FamiliaLitologia = (typeof familiasLitologia)[number];
export type PatronCatalogoLitologia = (typeof patronesLitologia)[number];
export type LitologiaPublica = { id_litologia:number;codigo:string;nombre:string;familia:FamiliaLitologia;color:string;patron:PatronCatalogoLitologia;activo:boolean;orden:number };
export type LitologiaCrearBody = Omit<LitologiaPublica,'id_litologia'|'activo'>;
export type LitologiaActualizarBody = Pick<LitologiaPublica,'nombre'|'familia'|'color'|'patron'|'orden'>;

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

export type RanuraFiltro = 0.5 | 0.75 | 1;
export type IntervaloFiltroBody = { id_intervalo_filtro?: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: MaterialTuberia | ''; ranura_mm?: RanuraFiltro | null };
export type IntervaloFiltro = Omit<IntervaloFiltroBody, 'material_tuberia' | 'ranura_mm'> & { id_intervalo_filtro: number; id_pozo: number; material_tuberia: MaterialTuberia; ranura_mm: RanuraFiltro | null };

export type NivelAporte = {
  id_nivel_aporte: number;
  id_pozo: number;
  profundidad_m: number;
};

export type NivelAporteBody = {
  profundidad_m: number;
};

export type ElementoBorrador<T> = { idLocal: string; dato: T; ranuraOriginal?: RanuraFiltro | null };

export type DatosTecnicosBorrador = {
  intervalosLitologicos: Array<ElementoBorrador<IntervaloLitologicoBody>>;
  intervalosDiametro: Array<ElementoBorrador<IntervaloDiametroPerforacionBody>>;
  intervalosFiltro: Array<ElementoBorrador<IntervaloFiltroBody>>;
  nivelesAporte: Array<ElementoBorrador<NivelAporteBody>>;
};

export type PozoCompletoBody = {
  pozo: NuevoPozoCrear;
  sitio_nuevo: SitioBody;
  intervalos_litologicos: IntervaloLitologicoBody[];
  intervalos_diametro: IntervaloDiametroPerforacionBody[];
  intervalos_filtro: IntervaloFiltroBody[];
  niveles_aporte: NivelAporteBody[];
  foto?: { mime_type: 'image/jpeg' | 'image/png'; base64: string };
};

export type PerfilLitologicoVistaPreviaBody = Omit<PozoCompletoBody, 'pozo' | 'foto' | 'sitio_nuevo'> & {
  profundidad_final_m: number;
};

export type CandidatoPozo = {
  id_usuario: number; nombre: string; documento_rut?: string | null; telefono?: string | null; email?: string | null;
  direccion?: string | null; localidad?: string | null; departamento?: import('../constants/departamentos-uruguay').DepartamentoUruguay | null;
  observaciones?: string | null; roles: string[];
};
export type CatalogosPersonasPozo = { propietarios: CandidatoPozo[]; perforadores: CandidatoPozo[] };
export type AccionFotoEdicion = 'conservar' | 'eliminar' | 'reemplazar';
export type PozoCompletoUpdateBody = Omit<PozoCompletoBody, 'foto' | 'pozo' | 'sitio_nuevo'> & {
  pozo: NuevoPozo;
  foto_accion: AccionFotoEdicion;
  foto?: PozoCompletoBody['foto'];
};

export type PozoCompletoResultado = {
  pozo: Pozo;
  sitio: Sitio;
  intervalos_litologicos: IntervaloLitologico[];
  intervalos_diametro: IntervaloDiametroPerforacion[];
  intervalos_filtro: IntervaloFiltro[];
  niveles_aporte: NivelAporte[];
};

export type PropietarioOperativoCrearBody = {
  nombre: string; documento_rut?: string | null; telefono?: string | null; email?: string | null;
  direccion?: string | null; localidad?: string | null;
  departamento?: import('../constants/departamentos-uruguay').DepartamentoUruguay | '' | null;
  observaciones?: string | null;
};
export type PropietarioOperativoActualizarBody = Partial<PropietarioOperativoCrearBody>;
export type PropietarioOperativo = {
  id_usuario: number; nombre: string; documento_rut: string | null; telefono: string | null; email: string | null;
  direccion: string | null; localidad: string | null;
  departamento: import('../constants/departamentos-uruguay').DepartamentoUruguay | null;
  observaciones: string | null;
};

import type { PatronCatalogo } from '../canonical/litologia-patrones';

export type PatronLitologico = PatronCatalogo
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
    litologia?: {id_litologia:number;nombre:string;color:string;patron:PatronCatalogoLitologia;activa:boolean}|null;
  }>;
  aportes: Array<{ profundidad_m: number; tipo: 'puntual'; desde_m: number; hasta_m: number; geometria: { x_inicio: 0.03; x_fin: 0.97; espesor_min_px: 12; patron: 'ondas' } }>;
  tuberias: Array<{tipo:'tuberia';desde_m:number;hasta_m:number;diametro_pulg:number;material_tuberia:MaterialTuberia|null;material_texto:string;carril_etiqueta:number;geometria:{x_inicio:number;x_fin:number;patron:'liso'|'metal'|'ranuras'}}>;
  filtros: Array<{tipo:'filtro';desde_m:number;hasta_m:number;diametro_pulg:number;material_tuberia:MaterialTuberia|null;material_texto:string;carril_etiqueta:number;geometria:{x_inicio:number;x_fin:number;patron:'liso'|'metal'|'ranuras'}}>;
  etiquetas: Array<{clave:string;tipo:'litologia'|'tuberia'|'filtro'|'aporte';texto:string;profundidad_anclaje_m:number;rango_desde_m:number;posicion_y_normalizada:number;carril:0|1|2|3;x_anclaje_normalizado:number;x_texto_normalizado:number;conector:{puntos:Array<{x_normalizada:number;y_normalizada:number}>};caja_texto:{x_normalizada:number;y_normalizada:number;ancho_normalizado:number;alto_normalizado:number}}>;
  seccion_pozo: { tuberia_exterior_inicio: 0.36; tuberia_exterior_fin: 0.64; tuberia_interior_inicio: 0.43; tuberia_interior_fin: 0.57 };
  geometria: { ancho_logico:760;alto_logico:820;columna:{x:90;y:70;ancho:180;alto:700};x_texto_escala:12;carriles_etiqueta_x:readonly [310,390,470,550];separacion_vertical_normalizada:number;conector:{salida:12;llegada:8};alto_texto:16 };
  rangos: Array<{ desde_m: number; hasta_m: number }>;
  advertencias: string[];
  tiene_litologia: boolean;
};
