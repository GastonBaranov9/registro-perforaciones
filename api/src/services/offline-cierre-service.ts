import { myPool } from '../db/pool.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { validarPersonaPozo } from './candidatos-pozo-service.ts';
import { T05DatosIncorrectos } from '../models/errors.ts';

export async function cerrarOperacionOffline(actor: number, clave: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clave))
    throw new T05DatosIncorrectos('Identificador de operación inválido.');
  clave = clave.toLowerCase();
  const client = await myPool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await validarPersonaPozo(actor, 'perforador', client);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 714))', [`${actor}:${clave}`]);
    const receipt = await client.query('SELECT resultado FROM creacion_offline WHERE actor=$1 AND clave=$2', [actor, clave]);
    if (receipt.rows[0]) {
      await client.query('COMMIT');
      return { estado: 'confirmado' as const, clave, resultado: receipt.rows[0].resultado };
    }
    await client.query('INSERT INTO clave_offline_cerrada(actor,clave) VALUES($1,$2) ON CONFLICT DO NOTHING', [actor, clave]);
    await client.query('COMMIT');
    return { estado: 'cerrado_sin_creacion' as const, clave };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
