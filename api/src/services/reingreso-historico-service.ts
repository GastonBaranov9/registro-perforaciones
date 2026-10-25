import type { PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { exigirAdministracionNumeracion, validarNumeroPerforacion } from './numeracion-perforacion-service.ts';
import { emitirConfirmacion, verificarConfirmacion, exigirMotivo } from './confirmacion-numeracion.ts';
import { T05ConflictoNumeracion, T05DatosIncorrectos } from '../models/errors.ts';
type Db=Pick<PoolClient,'query'>;
export interface AutorizacionReingreso {token:string;motivo:string;confirmacion:string;sin_referencias_externas:boolean;nueva_carga_administrativa:boolean}
function validar(numero:number){validarNumeroPerforacion(numero);if(numero>3281)throw new T05DatosIncorrectos('El reingreso sólo admite números históricos hasta 3281.');}
async function estado(numero:number,db:Db){
  const r=(await db.query(`SELECT to_jsonb(r) AS reserva FROM numero_perforacion_reservado r WHERE numero_perforacion=$1`,[numero])).rows[0]?.reserva??null;
  const id=r?.id_pozo_original??null;
  const referencias=(await db.query(`SELECT actor,clave,epoca,huella,resultado,creado_en FROM creacion_historica
    WHERE resultado->>'id_pozo'=$1 OR resultado->>'numero_perforacion'=$2 ORDER BY actor,clave`,[String(id),String(numero)])).rows;
  const activos=(await db.query('SELECT id_pozo FROM pozo WHERE numero_perforacion=$1 OR id_pozo=$2 ORDER BY id_pozo',[numero,id])).rows;
  const conflictos=(await db.query(`SELECT
    EXISTS(SELECT 1 FROM creacion_offline WHERE resultado->>'id_pozo'=$1 OR resultado#>>'{pozo,id_pozo}'=$1 OR resultado->>'numero_perforacion'=$2 OR resultado#>>'{pozo,numero_perforacion}'=$2) AS offline,
    EXISTS(SELECT 1 FROM documento WHERE id_pozo=$3) AS documentos,
    EXISTS(SELECT 1 FROM informe WHERE id_pozo=$3) AS informes,
    EXISTS(SELECT 1 FROM administracion_eliminacion WHERE id_pozo_original=$3 AND
      (jsonb_array_length(COALESCE(anterior#>'{detalles,documento}','[]'::jsonb))>0 OR jsonb_array_length(COALESCE(anterior#>'{detalles,informe}','[]'::jsonb))>0)) AS documentos_archivados`,[String(id),String(numero),id])).rows[0];
  const antecedentes=(await db.query('SELECT id,id_original,id_nuevo,numero_perforacion FROM reingreso_historico WHERE numero_perforacion=$1 ORDER BY id',[numero])).rows;
  const epoca=(await db.query('SELECT epoca FROM epoca_datos')).rows[0]?.epoca;
  return {reserva:r,referencias,activos,conflictos,antecedentes,epoca};
}
type Estado=Awaited<ReturnType<typeof estado>>;
function bloqueos(s:Estado,numero:number){
  const b:string[]=[];
  if(!s.reserva)b.push('No existe una reserva comprobable.');
  if(s.activos.length)b.push('Existe una perforación activa con ese número o identidad.');
  for(const [k,v] of Object.entries(s.conflictos))if(v)b.push('Referencia incompatible: '+k+'.');
  // Sólo son informativas las creaciones históricas de esta identidad o de su cadena auditada.
  const ids=new Set([s.reserva?.id_pozo_original,...s.antecedentes.flatMap(a=>[a.id_original,a.id_nuevo])].map(String));
  if(s.referencias.some(r=>String(r.resultado?.numero_perforacion)!==String(numero)||!ids.has(String(r.resultado?.id_pozo))||r.resultado?.origen!=='historico'))
    b.push('Hay una referencia histórica de identidad ambigua o incompatible.');
  return b;
}
export async function consultarReingreso(actor:number,numero:number,db:Db=myPool){
  validar(numero);await exigirAdministracionNumeracion(actor,db);
  const s=await estado(numero,db),b=bloqueos(s,numero);
  return {numero,id_original:s.reserva?.id_pozo_original??null,asignado_en:s.reserva?.asignado_en??null,
    existe:s.activos.length>0,bloqueos:b,referencias_historicas:s.referencias.length,antecedentes:s.antecedentes,
    elegible:b.length===0,token:b.length?null:emitirConfirmacion(actor,'reingreso_historico',numero,s)};
}
// Se llama únicamente dentro de crearHistorico, con sesión y contador bloqueados.
export async function prepararReingreso(actor:number,numero:number,a:AutorizacionReingreso,db:Db){
  validar(numero);await exigirAdministracionNumeracion(actor,db);exigirMotivo(a.motivo);
  if(a.confirmacion!==`REINGRESAR ${numero}`||a.sin_referencias_externas!==true||a.nueva_carga_administrativa!==true)
    throw new T05DatosIncorrectos('Confirmá el reingreso y la ausencia de referencias externas incompatibles y sincronizaciones pendientes.');
  const s=await estado(numero,db);
  const c=verificarConfirmacion(a.token,actor,'reingreso_historico',numero,s);
  if(bloqueos(s,numero).length||(await db.query('SELECT 1 FROM reingreso_historico WHERE nonce=$1',[c.nonce])).rowCount)
    throw new T05ConflictoNumeracion('No se puede reingresar esta reserva.');
  if((await db.query('DELETE FROM numero_perforacion_reservado WHERE numero_perforacion=$1 AND id_pozo_original=$2',[numero,s.reserva.id_pozo_original])).rowCount!==1)
    throw new T05ConflictoNumeracion('La reserva cambió.');
  return {estado:s,nonce:c.nonce,autorizacion:a};
}
export async function auditarReingreso(actor:number,numero:number,idNuevo:number,clave:string,p:Awaited<ReturnType<typeof prepararReingreso>>,db:Db){
  if(Number(p.estado.reserva.id_pozo_original)===idNuevo)throw new T05ConflictoNumeracion('No se puede reutilizar la identidad original.');
  const nueva=(await db.query('SELECT to_jsonb(r) AS reserva FROM numero_perforacion_reservado r WHERE numero_perforacion=$1 AND id_pozo_original=$2',[numero,idNuevo])).rows[0]?.reserva;
  if(!nueva)throw new T05ConflictoNumeracion('Falta la asociación nueva.');
  await db.query(`INSERT INTO reingreso_historico(nonce,actor,clave,numero_perforacion,id_original,id_nuevo,motivo,confirmacion,sin_referencias_externas,nueva_carga_administrativa,anterior,reserva_nueva)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,TRUE,$9,$10)`,[p.nonce,actor,clave,numero,p.estado.reserva.id_pozo_original,idNuevo,p.autorizacion.motivo.trim(),p.autorizacion.confirmacion,JSON.stringify(p.estado),JSON.stringify(nueva)]);
}
