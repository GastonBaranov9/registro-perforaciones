import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { T05ConflictoNumeracion, T05DatosIncorrectos } from '../models/errors.ts';
import { exigirAdministracionNumeracion, validarNumeroPerforacion } from './numeracion-perforacion-service.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { listarFotosPozo, rutaContenida } from './foto-archivo-service.ts';

type Db = Pick<PoolClient, 'query'>;
export type OperacionEliminacion = 'eliminar' | 'eliminar_prueba' | 'liberar_reserva';
export interface ConfirmacionEliminacion {
  token: string; confirmacion: string; motivo: string;
  prueba_confirmada?: boolean; sin_referencias_externas?: boolean;
}
// No se persiste nada al abrir/cancelar una confirmación. Reiniciar la API invalida los desafíos.
const claveConfirmacion = randomBytes(32);
const hijos = ['intervalo_litologico','intervalo_diametro_perforacion','nivel_aporte','documento','informe','intervalo_filtro','sello_sanitario_pozo'] as const;
const conflicto = () => new T05ConflictoNumeracion('La situación cambió o hay referencias que impiden esta operación. Consultá nuevamente; no se realizó ningún cambio.');
const huella = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function estado(id: number | null, numero: number | null, db: Db) {
  const { rows } = await db.query(`SELECT
    (SELECT to_jsonb(p) FROM pozo p WHERE ($1::bigint IS NOT NULL AND p.id_pozo=$1) OR ($1 IS NULL AND p.numero_perforacion=$2)) AS pozo,
    (SELECT to_jsonb(r) FROM numero_perforacion_reservado r WHERE ($1::bigint IS NOT NULL AND r.id_pozo_original=$1) OR ($1 IS NULL AND r.numero_perforacion=$2)) AS reserva,
    (SELECT to_jsonb(n) FROM numeracion_perforacion n WHERE singleton) AS contador`,[id,numero]);
  const s = rows[0];
  const original = s.pozo?.id_pozo ?? s.reserva?.id_pozo_original;
  const num = s.pozo?.numero_perforacion ?? s.reserva?.numero_perforacion;
  const referencias: string[] = [];
  let eliminacionComprobada=false;
  if (original != null) {
    const r = await db.query(`SELECT
      EXISTS(SELECT 1 FROM creacion_historica WHERE resultado->>'id_pozo'=$1 OR resultado->>'numero_perforacion'=$2) AS historica,
      EXISTS(SELECT 1 FROM creacion_offline WHERE resultado->>'id_pozo'=$1 OR resultado#>>'{pozo,id_pozo}'=$1 OR resultado->>'numero_perforacion'=$2 OR resultado#>>'{pozo,numero_perforacion}'=$2) AS offline,
      EXISTS(SELECT 1 FROM documento WHERE id_pozo=$3) AS documentos,
      EXISTS(SELECT 1 FROM informe WHERE id_pozo=$3) AS informes,
      EXISTS(SELECT 1 FROM administracion_eliminacion WHERE id_pozo_original=$3
        AND (jsonb_array_length(COALESCE(anterior#>'{detalles,documento}','[]'::jsonb))>0
          OR jsonb_array_length(COALESCE(anterior#>'{detalles,informe}','[]'::jsonb))>0)) AS documentos_archivados,
      EXISTS(SELECT 1 FROM administracion_eliminacion WHERE id_pozo_original=$3 AND operacion='eliminar') AS auditoria_eliminacion,
      EXISTS(SELECT 1 FROM pozo WHERE (id_pozo=$3 OR numero_perforacion=$4) AND id_pozo<>$3) AS conflicto`,[String(original),num == null ? null : String(num),original,num]);
    eliminacionComprobada=r.rows[0].auditoria_eliminacion;
    for (const [key,value] of Object.entries(r.rows[0])) if (value && key!=='auditoria_eliminacion') referencias.push(key);
  }
  const detalles:Record<string,unknown>={};
  if(original!=null) for(const tabla of hijos)
    detalles[tabla]=(await db.query(`SELECT to_jsonb(t) AS dato FROM ${tabla} t WHERE id_pozo=$1 ORDER BY to_jsonb(t)::text`,[original])).rows.map(r=>r.dato);
  const origen=num==null?'desconocido':(await db.query('SELECT origen_reserva_numero($1) origen',[num])).rows[0].origen;
  const protegido=num==null?false:(await db.query('SELECT numero_protegido($1) protegido',[num])).rows[0].protegido;
  return {...s, origen, protegido, referencias, detalles, eliminacionComprobada};
}

function impedimentos(s: Awaited<ReturnType<typeof estado>>, op: OperacionEliminacion): string[] {
  if (op==='eliminar') return s.pozo ? [] : ['La perforación ya no existe.'];
  const mensajes:Record<string,string>={
    historica:'La creación histórica conserva una referencia a esta perforación.',
    offline:'Existe un resultado guardado de sincronización de esta perforación.',
    documentos:'Hay documentos asociados a esta perforación.',
    informes:'Hay informes asociados a esta perforación.',
    documentos_archivados:'La auditoría conserva documentos o informes asociados.',
    conflicto:'Otro registro utiliza esta identidad o número.',
  };
  const motivos = s.referencias.map(r => (mensajes[r]??'Existe una referencia que debe revisarse.')+' No se puede liberar.');
  if (!s.reserva) motivos.push('No existe una reserva comprobable.');
  if (op==='liberar_reserva' && s.pozo) motivos.push('La perforación todavía existe.');
  if (op==='liberar_reserva' && !s.pozo && s.reserva && !s.eliminacionComprobada)
    motivos.push('Falta una auditoría de la eliminación original. Es necesario revisar el respaldo y sus referencias antes de liberar.');
  if (op==='eliminar_prueba' && !s.pozo) motivos.push('La perforación ya no existe.');
  const n = s.reserva?.numero_perforacion;
  if (s.origen==='desconocido')motivos.push('No se puede comprobar el origen de la reserva. Requiere revisión de antecedentes.');
  if (s.origen==='normal' && s.protegido)motivos.push('El número pertenece a un rango histórico protegido.');
  if (s.origen==='normal' && (Number(s.contador.proximo)!==n+1 || s.contador.mayor_asignado!==n))
    motivos.push('Sólo se puede recuperar el último número automático asignado, individualmente.');
  if (s.pozo && (s.pozo.id_pozo!==s.reserva?.id_pozo_original || s.pozo.numero_perforacion!==n))
    motivos.push('La identidad de la reserva no coincide.');
  return motivos;
}

export async function consultarEliminacion(actor: number, op: OperacionEliminacion, valor: number, db: Db = myPool) {
  validarNumeroPerforacion(valor);
  await exigirAdministracionNumeracion(actor,db);
  const s = await estado(op==='liberar_reserva'?null:valor,op==='liberar_reserva'?valor:null,db);
  const bloqueos = impedimentos(s,op);
  const carga = { actor, op, valor, huella:huella(s), exp:Date.now()+5*60_000, nonce:randomUUID() };
  const payload = Buffer.from(JSON.stringify(carga)).toString('base64url');
  const token = bloqueos.length ? null : payload+'.'+createHmac('sha256',claveConfirmacion).update(payload).digest('base64url');
  return { numero:s.pozo?.numero_perforacion ?? s.reserva?.numero_perforacion ?? (op==='liberar_reserva'?valor:null),
    id_original:s.pozo?.id_pozo ?? s.reserva?.id_pozo_original ?? null, asignado_en:s.reserva?.asignado_en ?? null,
    origen:s.origen,existe:!!s.pozo, reservada:!!s.reserva, proximo:Number(s.contador.proximo),
    bloqueos, elegible:bloqueos.length===0, token };
}

function validarToken(token: string, actor: number, op: OperacionEliminacion, valor: number) {
  if (typeof token!=='string' || token.length>4096) throw new T05DatosIncorrectos('Se requiere una confirmación nueva. Actualizá la aplicación.');
  const [payload,firma,...extra]=token.split('.');
  const esperada=createHmac('sha256',claveConfirmacion).update(payload??'').digest();
  const recibida=Buffer.from(firma??'','base64url');
  if(extra.length || recibida.length!==esperada.length || !timingSafeEqual(recibida,esperada)) throw conflicto();
  let c;
  try { c=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw conflicto(); }
  if(c.actor!==actor || c.op!==op || c.valor!==valor || c.exp<=Date.now()) throw conflicto();
  return c as { huella:string; nonce:string; exp:number };
}

export async function ejecutarEliminacion(actor:number,op:OperacionEliminacion,valor:number,solicitud:ConfirmacionEliminacion,directorio:string,pool:Pick<Pool,'connect'>=myPool) {
  validarNumeroPerforacion(valor);
  const c=validarToken(solicitud?.token,actor,op,valor);
  const palabra=op==='liberar_reserva'?'LIBERAR':'ELIMINAR';
  if(solicitud.confirmacion!==palabra || typeof solicitud.motivo!=='string' || solicitud.motivo.trim().length<10 || solicitud.motivo.trim().length>1000
      || (op!=='eliminar' && solicitud.sin_referencias_externas!==true) || (op==='eliminar_prueba' && solicitud.prueba_confirmada!==true))
    throw new T05DatosIncorrectos('Se requieren confirmación escrita, motivo y las declaraciones correspondientes.');
  const client=await pool.connect();
  let descartar=false;
  try {
    // Exclusión compartida por las escrituras de la API; orden anterior al contador y a la fotografía.
    await iniciarEscrituraSesion(client,true);
    await exigirAdministracionNumeracion(actor,client);
    await client.query('SELECT singleton FROM numeracion_perforacion WHERE singleton FOR UPDATE');
    const inicial=await estado(op==='liberar_reserva'?null:valor,op==='liberar_reserva'?valor:null,client);
    const id=Number(inicial.pozo?.id_pozo ?? inicial.reserva?.id_pozo_original);
    if(!Number.isSafeInteger(id) || id<1) throw conflicto();
    await client.query('SELECT pg_advisory_xact_lock($1::integer,606)',[id]);
    await client.query('SELECT id_pozo FROM pozo WHERE id_pozo=$1 FOR UPDATE',[id]);
    const s=await estado(op==='liberar_reserva'?null:valor,op==='liberar_reserva'?valor:null,client);
    if(c.exp<=Date.now() || huella(s)!==c.huella || impedimentos(s,op).length
        || (await client.query('SELECT 1 FROM administracion_eliminacion WHERE nonce=$1',[c.nonce])).rowCount) throw conflicto();
    // No borrar archivos durante una transacción SQL: la eliminación lógica y el archivo de
    // evidencia se confirman juntos. Los originales quedan privados, asociados al ID nunca reutilizado.
    const fotos=[];
    if(s.pozo) {
      for(const nombre of await listarFotosPozo(id,directorio)) {
        const bytes=await fs.readFile(rutaContenida(directorio,nombre));
        fotos.push({nombre,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      }
      if(s.pozo.foto_url && !fotos.length) throw new T05ConflictoNumeracion('Falta una fotografía esperada. No se eliminó la perforación.');
    }
    const posterior={...s.contador};
    if(op!=='eliminar' && s.origen==='normal') {
      const n=s.reserva.numero_perforacion;
      const mayor=Number((await client.query(`SELECT GREATEST(0,COALESCE((SELECT max(numero_perforacion) FROM numero_perforacion_reservado WHERE numero_perforacion<>$1),0),COALESCE((SELECT max(numero_perforacion) FROM pozo WHERE id_pozo<>$2),0)) AS mayor`,[n,id])).rows[0].mayor);
      if(mayor>=n) throw conflicto();
      posterior.proximo=n;posterior.mayor_asignado=mayor;
    }
    const audit=await client.query(`INSERT INTO administracion_eliminacion(nonce,actor,operacion,id_pozo_original,numero_perforacion,motivo,prueba_confirmada,sin_referencias_externas,anterior,posterior)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING id`,[c.nonce,actor,op,id,s.reserva?.numero_perforacion??s.pozo.numero_perforacion,solicitud.motivo.trim(),solicitud.prueba_confirmada===true,solicitud.sin_referencias_externas===true,JSON.stringify({...s,fotos}),JSON.stringify(posterior)]);
    if(op!=='liberar_reserva' && (await client.query('DELETE FROM pozo WHERE id_pozo=$1',[id])).rowCount!==1) throw conflicto();
    if(op!=='eliminar') {
      if((await client.query('DELETE FROM numero_perforacion_reservado WHERE numero_perforacion=$1 AND id_pozo_original=$2',[s.reserva.numero_perforacion,id])).rowCount!==1) throw conflicto();
      if(s.origen==='normal') {
        await client.query('UPDATE numeracion_perforacion SET proximo=$1,mayor_asignado=$2 WHERE singleton',[posterior.proximo,posterior.mayor_asignado]);
        await client.query('INSERT INTO numeracion_perforacion_configuracion(anterior,proximo,cambiado_por,motivo) VALUES($1,$2,$3,$4)',[s.contador.proximo,posterior.proximo,actor,solicitud.motivo.trim()]);
      }
    }
    await client.query('COMMIT');
    return {auditoria_id:String(audit.rows[0].id),proximo:Number(posterior.proximo)};
  } catch(error) {
    try { await client.query('ROLLBACK'); }
    catch(secundario) { descartar=true; throw new AggregateError([error,secundario],'No se pudo confirmar el resultado de la operación. Consultá el estado antes de reintentar.'); }
    throw error;
  } finally {client.release(descartar);}
}
