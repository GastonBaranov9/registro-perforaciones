import { myPool } from '../db/pool.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';
import { hashPassword } from './password-service.ts';
import { cerrarConexionesUsuario } from '../plugins/websocket.ts';
import * as err from '../models/errors.ts';
import type { PoolClient } from 'pg';

// Inspect every direct FK, including future business tables. Only role mappings
// and native sessions are disposable account records.
async function tieneHistorial(client: PoolClient, id: number): Promise<boolean> {
  const refs = await client.query(`SELECT ns.nspname AS esquema,cl.relname AS tabla,a.attname AS columna
    FROM pg_constraint fk JOIN pg_class cl ON cl.oid=fk.conrelid
    JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=ANY(fk.conkey)
    WHERE fk.contype='f' AND fk.confrelid='public.usuario'::regclass`);
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  for (const ref of refs.rows) {
    if (ref.esquema === 'public' && ['usuario_rol', 'sesion_nativa'].includes(ref.tabla)) continue;
    const result = await client.query(`SELECT 1 FROM ${quote(ref.esquema)}.${quote(ref.tabla)} WHERE ${quote(ref.columna)}=$1 LIMIT 1`, [id]);
    if (result.rows.length) return true;
  }
  return false;
}

export async function eliminarIdentidadSinHistorial(id: number) {
  const client = await myPool.connect();
  try {
    await iniciarEscrituraSesion(client, true);
    const actual = await client.query('SELECT cuenta_acceso FROM usuario WHERE id_usuario=$1 FOR UPDATE', [id]);
    if (!actual.rows[0]) throw new err.T05UsuarioNoEncontrado();
    if (actual.rows[0].cuenta_acceso) throw new err.T05DatosIncorrectos('Primero elimine el acceso y revoque sus sesiones.');
    if (await tieneHistorial(client, id)) throw new err.T05DatosIncorrectos('Esta identidad tiene historial empresarial. Se conserva para proteger perforaciones, fotografías y auditoría.');
    await client.query('DELETE FROM usuario WHERE id_usuario=$1', [id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function crearAccesoPropietario(id: number, email: string, password: string, confirmar: string) {
  if (password !== confirmar)
    throw new err.T05DatosIncorrectos('Las contraseñas deben coincidir.');
  const hash = await hashPassword(password);
  const client = await myPool.connect();
  try {
    await iniciarEscrituraSesion(client, true);
    const actual = await client.query('SELECT cuenta_acceso FROM usuario WHERE id_usuario=$1 FOR UPDATE', [id]);
    if (!actual.rows[0]) throw new err.T05UsuarioNoEncontrado();
    if (actual.rows[0].cuenta_acceso) throw new err.T05DatosIncorrectos('La persona ya tiene acceso. Use Administrar acceso para cambiar su contraseña.');
    await client.query("INSERT INTO usuario_rol(id_usuario,id_rol) SELECT $1,id_rol FROM rol WHERE nombre='propietario' ON CONFLICT DO NOTHING", [id]);
    await client.query('UPDATE usuario SET email=$2,password=$3,cuenta_acceso=TRUE,activo=TRUE,version_sesion=version_sesion+1 WHERE id_usuario=$1', [id, email, hash]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw new err.T05DatosIncorrectos('Ese email de acceso ya está utilizado por otra cuenta.');
    throw error;
  } finally { client.release(); }
  cerrarConexionesUsuario(id);
}
