import type { Pool, PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { exigirCapacidad } from './capacidades.ts';
import { validarPersonaPozo } from './candidatos-pozo-service.ts';
import { T05DatosIncorrectos } from '../models/errors.ts';

export type TipoPendiente = 'propietario' | 'perforador' | 'litologia';
export type OcurrenciaPendiente = { id: number; id_pozo: number; numero_perforacion: number | null;
  texto: string; version: string; version_pozo: string; desde_m?: number; hasta_m?: number };
export type VinculacionPendiente = { tipo: TipoPendiente; destino: number; ocurrencias: OcurrenciaPendiente[] };
type Db = Pick<PoolClient, 'query'>;

// Una consulta por lista, incluidos los propietarios provisionales anteriores a 019.
export async function listarPendientes(actor: number, litologias = false, db: Db = myPool) {
  await exigirCapacidad(actor, 'administrarUsuarios', db);
  const sql = litologias ? `SELECT 'litologia' AS tipo,i.litologia_provisional AS texto,
    i.id_intervalo_litologico AS id,p.id_pozo,p.numero_perforacion,i.xmin::text AS version,
    p.xmin::text AS version_pozo,i.desde_m::float8,i.hasta_m::float8
    FROM intervalo_litologico i JOIN pozo p USING(id_pozo) WHERE i.litologia_provisional IS NOT NULL`
    : `SELECT 'propietario' AS tipo,propietario_provisional AS texto,id_pozo AS id,id_pozo,
       numero_perforacion,xmin::text AS version,xmin::text AS version_pozo FROM pozo WHERE propietario_provisional IS NOT NULL
       UNION ALL SELECT 'perforador',perforador_provisional,id_pozo,id_pozo,numero_perforacion,
       xmin::text,xmin::text FROM pozo WHERE perforador_provisional IS NOT NULL`;
  const { rows } = await db.query(sql);
  const grupos = new Map<string, { tipo: TipoPendiente; texto: string; ocurrencias: OcurrenciaPendiente[] }>();
  for (const row of rows) {
    const key = JSON.stringify([row.tipo, row.texto]);
    if (!grupos.has(key)) grupos.set(key, { tipo: row.tipo, texto: row.texto, ocurrencias: [] });
    grupos.get(key)!.ocurrencias.push({ ...row, id: Number(row.id), id_pozo: Number(row.id_pozo),
      numero_perforacion: row.numero_perforacion == null ? null : Number(row.numero_perforacion) });
  }
  return [...grupos.values()].sort((a,b) => a.texto.localeCompare(b.texto, 'es'));
}

function conflicto(): never {
  throw Object.assign(new Error('Una ocurrencia cambió. Recargue los pendientes y vuelva a seleccionar; no se vinculó ninguna.'),
    { statusCode: 409, code: 'PENDIENTE_MODIFICADO' });
}

export async function vincularPendientes(actor: number, data: VinculacionPendiente, pool: Pick<Pool,'connect'> = myPool) {
  const { tipo, destino, ocurrencias } = data;
  if (!['propietario','perforador','litologia'].includes(tipo) || !Number.isSafeInteger(destino) || destino < 1
      || !ocurrencias.length || ocurrencias.length > 1000 || new Set(ocurrencias.map(x => x.id)).size !== ocurrencias.length)
    throw new T05DatosIncorrectos('Seleccione de 1 a 1000 ocurrencias distintas y un destino válido.');
  const client = await pool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirCapacidad(actor, 'administrarUsuarios', client);
    const pozos = [...new Set(ocurrencias.map(x => x.id_pozo))].sort((a,b) => a-b);
    // Mismo orden de bloqueo que la edición completa y la vinculación individual.
    await client.query('SELECT pg_advisory_xact_lock(id,606) FROM unnest($1::int[]) AS t(id) ORDER BY id', [pozos]);
    const bloqueados = await client.query('SELECT id_pozo,xmin::text AS version FROM pozo WHERE id_pozo=ANY($1::bigint[]) ORDER BY id_pozo FOR UPDATE', [pozos]);
    const versiones = new Map(bloqueados.rows.map(r => [Number(r.id_pozo),r.version]));
    if (ocurrencias.some(x => versiones.get(x.id_pozo) !== x.version_pozo)) conflicto();
    const ids = ocurrencias.map(x => x.id);
    const campo = tipo === 'litologia' ? 'litologia' : tipo;
    const tabla = tipo === 'litologia' ? 'intervalo_litologico' : 'pozo';
    const pk = tipo === 'litologia' ? 'id_intervalo_litologico' : 'id_pozo';
    const actuales = await client.query(`SELECT ${pk} AS id,id_pozo,${campo}_provisional AS texto,
      id_${campo} AS vinculado,xmin::text AS version FROM ${tabla} WHERE ${pk}=ANY($1::bigint[]) ORDER BY ${pk} FOR UPDATE`, [ids]);
    const porId = new Map(actuales.rows.map(r => [Number(r.id),r]));
    for (const x of ocurrencias) {
      const r = porId.get(x.id);
      if (!r || Number(r.id_pozo) !== x.id_pozo || r.version !== x.version || r.texto !== x.texto || r.vinculado != null) conflicto();
    }
    if (tipo === 'litologia') {
      const { rows } = await client.query('SELECT nombre FROM catalogo_litologia WHERE id_litologia=$1 AND activo FOR SHARE', [destino]);
      if (!rows[0]) throw new T05DatosIncorrectos('Seleccione una litología activa.');
      await client.query('UPDATE intervalo_litologico SET id_litologia=$1,litologia_provisional=NULL,material=$3 WHERE id_intervalo_litologico=ANY($2::bigint[])', [destino,ids,rows[0].nombre]);
    } else {
      await validarPersonaPozo(destino,tipo,client);
      // Igual que vincularPropietarioPozo: referencia operativa y limpieza, sin crear cuentas.
      await client.query(`UPDATE pozo SET id_${campo}=$1,${campo}_provisional=NULL WHERE id_pozo=ANY($2::bigint[])`, [destino,ids]);
    }
    await client.query('COMMIT');
    return { vinculadas: ids.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
