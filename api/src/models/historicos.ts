import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { T05DatosIncorrectos } from './errors.ts';
import { bodyIntervaloLitologico, IntervaloDiametroPerforacionBody, IntervaloFiltroCreateBody, IntervaloFiltroBody, NivelAporteBody, FotoNuevaPozo, SelloSanitarioOpcional, PrefiltroOpcional } from './schemas.ts';

const texto = () => Type.String({ minLength: 1, maxLength: 2000, pattern: '\\S' });
const id = () => Type.Integer({ minimum: 1 });
const fecha = () => Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
export const HistoricoBody = Type.Object({
  numero_perforacion: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483647 }),Type.Null()]),
  reingreso: Type.Optional(Type.Object({
    token: Type.String({minLength:1,maxLength:4096}), motivo: Type.String({minLength:10,maxLength:1000}),
    confirmacion: Type.String({maxLength:40}), sin_referencias_externas: Type.Literal(true),
    nueva_carga_administrativa: Type.Literal(true),
  },{additionalProperties:false})),
  sello_sanitario_constructivo: SelloSanitarioOpcional,
  prefiltro_constructivo: PrefiltroOpcional,
  id_propietario: Type.Optional(id()),
  propietario_provisional: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' })),
  id_perforador: Type.Optional(id()),
  perforador_provisional: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' })),
  empresa: Type.Optional(texto()),
  fecha_inicio: Type.Optional(fecha()), fecha_fin: Type.Optional(fecha()),
  profundidad_final_m: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  caudal_estimado_lh: Type.Optional(Type.Integer({ minimum: 0 })),
  nivel_estatico_m: Type.Optional(Type.Number()), nivel_dinamico_m: Type.Optional(Type.Number()),
  metodo_sedimentario: Type.Optional(texto()), metodo_rocoso: Type.Optional(texto()),
  cementacion: Type.Optional(texto()), desarrollo: Type.Optional(texto()), revestimiento: Type.Optional(texto()),
  sitio: Type.Optional(Type.Object({
    departamento: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }),
    localidad: Type.Optional(Type.String({ maxLength: 160 })), padron: Type.Optional(Type.String({ maxLength: 80 })),
    latitud: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })), longitud: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  }, { additionalProperties: false })),
  intervalos_litologicos: Type.Optional(Type.Array(Type.Omit(bodyIntervaloLitologico, ['id_intervalo_litologico']))),
  intervalos_diametro: Type.Optional(Type.Array(IntervaloDiametroPerforacionBody)),
  intervalos_filtro: Type.Optional(Type.Array(IntervaloFiltroCreateBody)),
  niveles_aporte: Type.Optional(Type.Array(NivelAporteBody)),
  foto: Type.Optional(FotoNuevaPozo),
}, { additionalProperties: false });
export type HistoricoBody = Static<typeof HistoricoBody>;
export const CAMPOS_HISTORICOS = ['id_propietario','propietario_provisional','id_perforador','perforador_provisional','empresa','fecha_inicio','fecha_fin','profundidad_final_m','caudal_estimado_lh','nivel_estatico_m','nivel_dinamico_m','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento'] as const;
const editables = Type.Pick(HistoricoBody, [...CAMPOS_HISTORICOS]);
export const HistoricoUpdateBody = Type.Object({
  sello_sanitario_constructivo: SelloSanitarioOpcional,
  prefiltro_constructivo: PrefiltroOpcional,
  ...Object.fromEntries(Object.entries(editables.properties).map(([k,v]) => [k, Type.Optional(Type.Union([v, Type.Null()]))])),
  sitio: HistoricoBody.properties.sitio,
  intervalos_litologicos: Type.Optional(Type.Array(bodyIntervaloLitologico)),
  intervalos_diametro: HistoricoBody.properties.intervalos_diametro,
  intervalos_filtro: Type.Optional(Type.Array(IntervaloFiltroBody)),
  niveles_aporte: HistoricoBody.properties.niveles_aporte,
  foto_accion: Type.Optional(Type.Union([Type.Literal('conservar'),Type.Literal('eliminar'),Type.Literal('reemplazar')])),
  foto: Type.Optional(FotoNuevaPozo),
}, { additionalProperties:false, minProperties:1 });
export type HistoricoUpdateBody = Partial<{ [K in typeof CAMPOS_HISTORICOS[number]]: HistoricoBody[K] | null }> & {
  sello_sanitario_constructivo?: HistoricoBody['sello_sanitario_constructivo'];
  prefiltro_constructivo?: HistoricoBody['prefiltro_constructivo'];
  sitio?: HistoricoBody['sitio']; intervalos_litologicos?: Static<typeof bodyIntervaloLitologico>[];
  intervalos_diametro?: HistoricoBody['intervalos_diametro']; intervalos_filtro?: Static<typeof IntervaloFiltroBody>[];
  niveles_aporte?: HistoricoBody['niveles_aporte']; foto_accion?: 'conservar'|'eliminar'|'reemplazar'; foto?: HistoricoBody['foto'];
};
export function validarEdicionHistorica(data: unknown): asserts data is HistoricoUpdateBody {
  if (!Value.Check(HistoricoUpdateBody,data)) throw new T05DatosIncorrectos('Edición histórica inválida. Número, origen e identidad no son editables.');
  const d=data as HistoricoUpdateBody;
  if ((d.foto_accion==='reemplazar') !== !!d.foto) throw new T05DatosIncorrectos('Adjunte foto únicamente para reemplazar.');
}
// Se ejecuta antes de AJV: no convertir strings/booleanos a números ni descartar
// propiedades desconocidas. También protege llamadas internas al servicio.
export function validarHistorico(data: unknown): asserts data is HistoricoBody {
  if (!Value.Check(HistoricoBody, data)) throw new T05DatosIncorrectos('Histórico inválido: número entero positivo o desconocido y sólo datos conocidos.');
  if(data.reingreso && data.numero_perforacion===null)throw new T05DatosIncorrectos('El reingreso requiere el número original.');
  if (data.id_propietario && data.propietario_provisional) throw new T05DatosIncorrectos('Seleccione propietario o nombre provisional, no ambos.');
  if (data.id_perforador && data.perforador_provisional) throw new T05DatosIncorrectos('Seleccione perforador o nombre provisional, no ambos.');
  validarFechasHistoricas(data);
}
export function validarFechasHistoricas(data: {fecha_inicio?:string|null;fecha_fin?:string|null}) {
  for (const value of [data.fecha_inicio, data.fecha_fin]) {
    if (value && (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new T05DatosIncorrectos('Fecha histórica inválida.');
  }
  if (data.fecha_inicio && data.fecha_fin && data.fecha_fin < data.fecha_inicio) throw new T05DatosIncorrectos('La fecha final precede al inicio.');
}
