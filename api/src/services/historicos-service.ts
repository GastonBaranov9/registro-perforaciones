import { exigirCapacidad } from './capacidades.ts';
import { exigirVinculacionDesdePendientes } from './litologia-provisional.ts';
import type { Pool } from 'pg';
import { myPool } from '../db/pool.ts';
import { validarHistorico, validarEdicionHistorica, validarFechasHistoricas, CAMPOS_HISTORICOS, type HistoricoBody, type HistoricoUpdateBody } from '../models/historicos.ts';
import { T05DatosIncorrectos, T05PozoNoEncontrado, T05ConflictoNumeracion, T05HistoricoNumeroOcupado } from '../models/errors.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { traducirErrorNumeracion } from './numeracion-perforacion-service.ts';
import { exigirEpoca, validarClaveOperacion } from './epoca-datos-service.ts';
import { validarPersonaPozo } from './candidatos-pozo-service.ts';
import { huellaOffline, insertarHijos, validarDatosTecnicosPozo, reemplazarHijosPozo } from './pozo-completo-service.ts';
import { normalizarCoordenadasTexto } from '../utils/coordenadas.ts';
import { FotoHistoricoTransaccion } from './foto-historico-transaccion.ts';
import { compensarFalloTransaccionalFotos } from './foto-archivo-service.ts';
import { cargarConfiguracionRuntime } from '../config/runtime.ts';

export async function crearHistorico(actor: number, data: HistoricoBody, clave: unknown, epoca: unknown, pool: Pick<Pool, 'connect'> = myPool) {
  validarHistorico(data); validarClaveOperacion(clave);
  clave = clave.toLowerCase();
  const tecnicos = {
    intervalos_litologicos: data.intervalos_litologicos ?? [], intervalos_diametro: data.intervalos_diametro ?? [],
    intervalos_filtro: data.intervalos_filtro ?? [], niveles_aporte: data.niveles_aporte ?? [],
  };
  const errores = validarDatosTecnicosPozo({ ...tecnicos, profundidad_final_m: data.profundidad_final_m });
  if (errores.length) throw new T05DatosIncorrectos(errores.join(' '));
  const coordenadas = normalizarCoordenadasTexto(data.sitio?.latitud, data.sitio?.longitud);
  if ((data.sitio?.latitud !== undefined || data.sitio?.longitud !== undefined) && !coordenadas)
    throw new T05DatosIncorrectos('Indique ambas coordenadas válidas o deje ambas sin registrar.');
  const huella = huellaOffline(data);
  const client = await pool.connect();
  const fotoTx=new FotoHistoricoTransaccion(cargarConfiguracionRuntime().fotosDir);
  let descartar=false;
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirCapacidad(actor, 'gestionarHistoricos', client);
    const generacion = await exigirEpoca(client, epoca);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 717))', [`${actor}:${clave}`]);
    const previo = await client.query('SELECT epoca,huella,resultado FROM creacion_historica WHERE actor=$1 AND clave=$2', [actor, clave]);
    if (previo.rows[0]) {
      if (previo.rows[0].epoca !== generacion || previo.rows[0].huella !== huella) throw new T05ConflictoNumeracion('La clave histórica ya pertenece a otra operación.');
      await client.query('COMMIT'); return previo.rows[0].resultado;
    }
    // El trigger conserva proximo=NULL al reservar un histórico. Sólo impedir
    // elevar un contador configurado debajo del corte; compartir su bloqueo.
    const estado = await client.query('SELECT proximo FROM numeracion_perforacion WHERE singleton=TRUE FOR UPDATE');
    if (!estado.rows[0] || (estado.rows[0].proximo != null && Number(estado.rows[0].proximo) < 3282))
      throw new T05ConflictoNumeracion('Habilite primero la numeración desde 3282.');
    if (data.id_propietario) await validarPersonaPozo(data.id_propietario, 'propietario', client);
    if (data.id_perforador) await validarPersonaPozo(data.id_perforador, 'perforador', client);
    let sitio: Record<string, unknown> | null = null;
    if (data.sitio) {
      const s = data.sitio;
      sitio = (await client.query(`INSERT INTO sitio(departamento,localidad,padron,latitud,longitud)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [s.departamento.trim(), s.localidad ?? null, s.padron ?? null, coordenadas?.latitud ?? null, coordenadas?.longitud ?? null])).rows[0];
    }
    const fields = ['perforador_provisional','empresa','fecha_inicio','fecha_fin','profundidad_final_m','caudal_estimado_lh','nivel_estatico_m','nivel_dinamico_m','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento'] as const;
    const values = [data.numero_perforacion, actor, data.id_propietario ?? null, data.propietario_provisional?.trim() ?? null, data.id_perforador ?? null, sitio?.id_sitio ?? null, ...fields.map(f => f === 'perforador_provisional' ? data[f]?.trim() ?? null : data[f] ?? null)];
    const pozo = (await client.query(`INSERT INTO pozo(origen,numero_perforacion,creado_por,id_propietario,propietario_provisional,id_perforador,id_sitio,${fields.join(',')})
      VALUES('historico',${values.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, values)).rows[0];
    const hijos = await insertarHijos(client, Number(pozo.id_pozo), tecnicos);
    if(data.foto){
      await fotoTx.cambiar(Number(pozo.id_pozo),data.foto);
      await client.query('UPDATE pozo SET foto_url=$2 WHERE id_pozo=$1',[pozo.id_pozo,`/usuarios/${actor}/pozos/${pozo.id_pozo}/foto`]);
    }
    const resultado = { id_pozo: Number(pozo.id_pozo), numero_perforacion: pozo.numero_perforacion, origen: 'historico', creado_por: actor, ...hijos };
    await client.query('INSERT INTO creacion_historica(actor,clave,epoca,huella,resultado) VALUES($1,$2,$3,$4,$5)', [actor, clave, generacion, huella, JSON.stringify(resultado)]);
    fotoTx.commitIntentado=true;
    await client.query('COMMIT');
    await fotoTx.confirmar(Number(pozo.id_pozo));
    return resultado;
  } catch (error) {
    const compensation=await compensarFalloTransaccionalFotos({idPozo:0,operacion:'crear_historico',rollback:async()=>{await client.query('ROLLBACK');},restaurar:()=>fotoTx.restaurar()});
    descartar=!!compensation.errorRollback;
    if(compensation.errorFilesystem)throw new Error('No se pudo compensar la fotografía histórica.',{cause:error});
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23505' && ['pozo_numero_perforacion_uq','numero_perforacion_reservado_pkey'].includes(pg.constraint ?? ''))
      throw new T05HistoricoNumeroOcupado();
    throw traducirErrorNumeracion(error);
  }
  finally { client.release(descartar); }
}

/** PATCH: los campos omitidos se conservan; null borra un dato opcional conocido. */
export async function editarHistorico(actor:number,idPozo:number,data:HistoricoUpdateBody,pool:Pick<Pool,'connect'>=myPool){
  validarEdicionHistorica(data);
  const client=await pool.connect();
  const fotoTx=new FotoHistoricoTransaccion(cargarConfiguracionRuntime().fotosDir);
  let descartar=false;
  try{
    await iniciarEscrituraSesion(client,false);
    await exigirCapacidad(actor, 'gestionarHistoricos', client);
    await client.query('SELECT pg_advisory_xact_lock($1::integer,606)',[idPozo]);
    const original=(await client.query('SELECT * FROM pozo WHERE id_pozo=$1 FOR UPDATE',[idPozo])).rows[0];
    if(!original)throw new T05PozoNoEncontrado();
    if(original.origen!=='historico')throw new T05DatosIncorrectos('Esta ruta sólo edita perforaciones históricas.');
    const p={...original,...data};
    exigirVinculacionDesdePendientes(original.perforador_provisional,p.id_perforador);
    exigirVinculacionDesdePendientes(original.propietario_provisional,p.id_propietario);
    // pg devuelve Date para algunos entornos; validar siempre fechas calendario.
    validarFechasHistoricas({fecha_inicio:p.fecha_inicio instanceof Date?p.fecha_inicio.toISOString().slice(0,10):p.fecha_inicio,fecha_fin:p.fecha_fin instanceof Date?p.fecha_fin.toISOString().slice(0,10):p.fecha_fin});
    if(p.id_perforador&&p.perforador_provisional)throw new T05DatosIncorrectos('Seleccione perforador o nombre provisional, no ambos.');
    if(p.id_propietario&&p.propietario_provisional)throw new T05DatosIncorrectos('Seleccione propietario o nombre provisional, no ambos.');
    if(data.id_propietario)await validarPersonaPozo(data.id_propietario,'propietario',client);
    if(data.id_perforador)await validarPersonaPozo(data.id_perforador,'perforador',client);
    let sitioId=original.id_sitio;
    if(data.sitio){
      const s=data.sitio;
      const coords=normalizarCoordenadasTexto(s.latitud,s.longitud);
      if((s.latitud!==undefined||s.longitud!==undefined)&&!coords)throw new T05DatosIncorrectos('Indique ambas coordenadas válidas o ninguna.');
      const values=[s.departamento.trim(),s.localidad??null,s.padron??null,coords?.latitud??null,coords?.longitud??null];
      if(sitioId){
        await client.query('SELECT id_sitio FROM sitio WHERE id_sitio=$1 FOR UPDATE',[sitioId]);
        // No alterar silenciosamente otras perforaciones que compartan sitio.
        if((await client.query('SELECT 1 FROM pozo WHERE id_sitio=$1 AND id_pozo<>$2',[sitioId,idPozo])).rowCount)throw new T05DatosIncorrectos('El sitio es compartido; edítelo desde Sitios.');
        await client.query('UPDATE sitio SET departamento=$1,localidad=$2,padron=$3,latitud=$4,longitud=$5 WHERE id_sitio=$6',[...values,sitioId]);
      }else sitioId=(await client.query('INSERT INTO sitio(departamento,localidad,padron,latitud,longitud) VALUES($1,$2,$3,$4,$5) RETURNING id_sitio',values)).rows[0].id_sitio;
    }
    const children={
      intervalos_litologicos:data.intervalos_litologicos??(await client.query('SELECT id_intervalo_litologico,desde_m::float8,hasta_m::float8,material,id_litologia,litologia_provisional FROM intervalo_litologico WHERE id_pozo=$1 ORDER BY desde_m',[idPozo])).rows.map(r=>({...r,id_intervalo_litologico:Number(r.id_intervalo_litologico),id_litologia:r.id_litologia==null?undefined:Number(r.id_litologia)})),
      intervalos_diametro:data.intervalos_diametro??(await client.query('SELECT desde_m::float8,hasta_m::float8,diametro_pulg::float8,material_tuberia FROM intervalo_diametro_perforacion WHERE id_pozo=$1 ORDER BY desde_m',[idPozo])).rows,
      intervalos_filtro:data.intervalos_filtro??(await client.query('SELECT id_intervalo_filtro,desde_m::float8,hasta_m::float8,diametro_pulg::float8,material_tuberia,ranura_mm::float8 FROM intervalo_filtro WHERE id_pozo=$1 ORDER BY desde_m',[idPozo])).rows.map(r=>({...r,id_intervalo_filtro:Number(r.id_intervalo_filtro)})),
      niveles_aporte:data.niveles_aporte??(await client.query('SELECT profundidad_m::float8 FROM nivel_aporte WHERE id_pozo=$1 ORDER BY profundidad_m',[idPozo])).rows,
    };
    const errors=validarDatosTecnicosPozo({...children,profundidad_final_m:p.profundidad_final_m==null?undefined:Number(p.profundidad_final_m)});
    if(errors.length)throw new T05DatosIncorrectos(errors.join(' '));
    const fields=CAMPOS_HISTORICOS.filter(f=>Object.hasOwn(data,f));
    if(fields.length)await client.query(`UPDATE pozo SET ${fields.map((f,i)=>`${f}=$${i+2}`).join(',')} WHERE id_pozo=$1`,[idPozo,...fields.map(f=>f.endsWith('_provisional') ? (data[f] as string|null)?.trim()??null : data[f]??null)]);
    if(data.sitio)await client.query('UPDATE pozo SET id_sitio=$2 WHERE id_pozo=$1',[idPozo,sitioId]);
    // Si no se envían estructuras, ni siquiera se reemplazan sus IDs.
    if(['intervalos_litologicos','intervalos_diametro','intervalos_filtro','niveles_aporte'].some(k=>Object.hasOwn(data,k)))await reemplazarHijosPozo(client,idPozo,children);
    if(data.foto_accion&&data.foto_accion!=='conservar'){
      await fotoTx.cambiar(idPozo,data.foto);
      await client.query('UPDATE pozo SET foto_url=$2 WHERE id_pozo=$1',[idPozo,data.foto?`/usuarios/${actor}/pozos/${idPozo}/foto`:null]);
    }
    fotoTx.commitIntentado=true; await client.query('COMMIT');
    await fotoTx.confirmar(idPozo);
    return {id_pozo:idPozo,numero_perforacion:original.numero_perforacion,origen:'historico'};
  }catch(error){
    const compensation=await compensarFalloTransaccionalFotos({idPozo,operacion:'editar_historico',rollback:async()=>{await client.query('ROLLBACK');},restaurar:()=>fotoTx.restaurar()});
    descartar=!!compensation.errorRollback;
    if(compensation.errorFilesystem)throw new Error('No se pudo restaurar la fotografía histórica.',{cause:error});
    throw error;
  }finally{client.release(descartar);}
}
