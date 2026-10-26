import { DatosTecnicosBorrador, NuevoPozo, SitioBody } from '../types/schemas';
import { prefiltroParaEnvio, validarDatosTecnicos, selloSanitarioParaEnvio } from './datos-tecnicos-borrador';

export const tecnicosVacios=():DatosTecnicosBorrador=>({intervalosLitologicos:[],intervalosDiametro:[],intervalosFiltro:[],nivelesAporte:[]});
export function cuerpoHistorico(pozo:NuevoPozo,sitio:SitioBody,tecnicos:DatosTecnicosBorrador,edicion:boolean,originales?:DatosTecnicosBorrador):Record<string,unknown>{
  const errors=validarDatosTecnicos(tecnicos,pozo.profundidad_final_m);
  if(errors.length)throw Error(errors.join(' '));
  const body:Record<string,unknown>={};
  const prefiltro = prefiltroParaEnvio(tecnicos, originales);
  if (prefiltro !== undefined) body['prefiltro_constructivo'] = prefiltro;
  const sello = selloSanitarioParaEnvio(tecnicos, edicion ? originales : undefined);
  if (sello !== undefined && (edicion || sello !== null)) body['sello_sanitario_constructivo'] = sello;
  for(const key of ['empresa','fecha_inicio','fecha_fin','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento','propietario_provisional','perforador_provisional'] as const){
    const value=pozo[key]?.trim();if(value)body[key]=value;else if(edicion)body[key]=null;
  }
  for(const key of ['id_propietario','id_perforador','profundidad_final_m','caudal_estimado_lh','nivel_estatico_m','nivel_dinamico_m'] as const){
    const value=pozo[key];if(value!=null && (key.startsWith('id_')?value>0:true))body[key]=value;else if(edicion)body[key]=null;
  }
  if(body['id_propietario']){if(edicion)body['propietario_provisional']=null;else delete body['propietario_provisional'];}
  if(body['id_perforador']){if(edicion)body['perforador_provisional']=null;else delete body['perforador_provisional'];}
  const site=Object.fromEntries(['departamento','localidad','padron','latitud','longitud'].map(k=>[k,String(sitio[k as keyof SitioBody]??'').trim()]).filter(([,v])=>v));
  if(edicion&&pozo.id_sitio>0&&!site['departamento'])throw Error('El sitio existente requiere departamento. Puede dejar vacíos localidad, padrón y coordenadas.');
  if(Object.keys(site).length){if(!site['departamento'])throw Error('Indique el departamento del sitio o deje todos sus datos vacíos.');body['sitio']=site;}
  const children={intervalos_litologicos:tecnicos.intervalosLitologicos.map(x=>({...x.dato})),intervalos_diametro:tecnicos.intervalosDiametro.map(x=>({...x.dato})),intervalos_filtro:tecnicos.intervalosFiltro.map(x=>({...x.dato})),niveles_aporte:tecnicos.nivelesAporte.map(x=>({...x.dato}))};
  for(const [key,values] of Object.entries(children))if(edicion||values.length)body[key]=values;
  return body;
}
