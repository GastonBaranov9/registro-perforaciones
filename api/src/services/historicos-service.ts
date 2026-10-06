import type { Pool } from 'pg';
import { myPool } from '../db/pool.ts';
import { validarHistorico, type HistoricoBody } from '../models/historicos.ts';
import { T05DatosIncorrectos, T05ConflictoNumeracion, T05HistoricoNumeroOcupado } from '../models/errors.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { exigirAdministracionNumeracion, traducirErrorNumeracion } from './numeracion-perforacion-service.ts';
import { exigirEpoca, validarClaveOperacion } from './epoca-datos-service.ts';
import { validarPersonaPozo } from './candidatos-pozo-service.ts';
import { huellaOffline, insertarHijos, validarDatosTecnicosPozo } from './pozo-completo-service.ts';
import { normalizarCoordenadasTexto } from '../utils/coordenadas.ts';

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
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirAdministracionNumeracion(actor, client);
    const generacion = await exigirEpoca(client, epoca);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 717))', [`${actor}:${clave}`]);
    const previo = await client.query('SELECT epoca,huella,resultado FROM creacion_historica WHERE actor=$1 AND clave=$2', [actor, clave]);
    if (previo.rows[0]) {
      if (previo.rows[0].epoca !== generacion || previo.rows[0].huella !== huella) throw new T05ConflictoNumeracion('La clave histórica ya pertenece a otra operación.');
      await client.query('COMMIT'); return previo.rows[0].resultado;
    }
    // No permitir históricos antes de habilitar el corte ni elevar un contador
    // que todavía esté debajo del límite histórico. Comparte el lock del trigger.
    const estado = await client.query('SELECT proximo FROM numeracion_perforacion WHERE singleton=TRUE FOR UPDATE');
    if (!estado.rows[0]?.proximo || Number(estado.rows[0].proximo) < 3282)
      throw new T05ConflictoNumeracion('Habilite primero la numeración desde 3282.');
    if (data.id_propietario) await validarPersonaPozo(data.id_propietario, 'propietario', client);
    if (data.id_perforador) await validarPersonaPozo(data.id_perforador, 'perforador', client);
    let sitio: Record<string, unknown> | null = null;
    if (data.sitio) {
      const s = data.sitio;
      sitio = (await client.query(`INSERT INTO sitio(departamento,localidad,padron,latitud,longitud)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [s.departamento.trim(), s.localidad ?? null, s.padron ?? null, coordenadas?.latitud ?? null, coordenadas?.longitud ?? null])).rows[0];
    }
    const fields = ['empresa','fecha_inicio','fecha_fin','profundidad_final_m','caudal_estimado_lh','nivel_estatico_m','nivel_dinamico_m','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento'] as const;
    const values = [data.numero_perforacion, actor, data.id_propietario ?? null, data.propietario_provisional?.trim() ?? null, data.id_perforador ?? null, sitio?.id_sitio ?? null, ...fields.map(f => data[f] ?? null)];
    const pozo = (await client.query(`INSERT INTO pozo(origen,numero_perforacion,creado_por,id_propietario,propietario_provisional,id_perforador,id_sitio,${fields.join(',')})
      VALUES('historico',${values.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, values)).rows[0];
    const hijos = await insertarHijos(client, Number(pozo.id_pozo), tecnicos);
    const resultado = { id_pozo: Number(pozo.id_pozo), numero_perforacion: pozo.numero_perforacion, origen: 'historico', creado_por: actor, ...hijos };
    await client.query('INSERT INTO creacion_historica(actor,clave,epoca,huella,resultado) VALUES($1,$2,$3,$4,$5)', [actor, clave, generacion, huella, JSON.stringify(resultado)]);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23505' && ['pozo_numero_perforacion_uq','numero_perforacion_reservado_pkey'].includes(pg.constraint ?? ''))
      throw new T05HistoricoNumeroOcupado();
    throw traducirErrorNumeracion(error);
  }
  finally { client.release(); }
}
