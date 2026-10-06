import { myPool } from '../db/pool.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { validarPersonaPozo } from './candidatos-pozo-service.ts';
import { T05DatosIncorrectos, T05EpocaRetirada } from '../models/errors.ts';
import { exigirEpoca } from './epoca-datos-service.ts';

export async function cerrarOperacionOffline(actor: number, clave: string, epoca?: unknown) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clave))
    throw new T05DatosIncorrectos('Identificador de operación inválido.');
  clave = clave.toLowerCase();
  const client = await myPool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await validarPersonaPozo(actor, 'perforador', client);
    const generacion = await exigirEpoca(client, epoca);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 714))', [`${actor}:${clave}`]);
    const receipt = await client.query('SELECT epoca,resultado FROM creacion_offline WHERE actor=$1 AND clave=$2', [actor, clave]);
    if (receipt.rows[0]) {
      if (receipt.rows[0].epoca !== generacion) throw new T05EpocaRetirada();
      await client.query('COMMIT');
      return { estado: 'confirmado' as const, clave, resultado: receipt.rows[0].resultado };
    }
    const closed = await client.query('SELECT epoca FROM clave_offline_cerrada WHERE actor=$1 AND clave=$2', [actor, clave]);
    if (closed.rows[0] && closed.rows[0].epoca !== generacion) throw new T05EpocaRetirada();
    await client.query('INSERT INTO clave_offline_cerrada(actor,clave,epoca) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [actor, clave, generacion]);
    await client.query('COMMIT');
    return { estado: 'cerrado_sin_creacion' as const, clave };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
