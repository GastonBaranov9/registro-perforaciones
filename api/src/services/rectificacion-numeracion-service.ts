import type { Pool, PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { T05ConflictoNumeracion, T05DatosIncorrectos } from '../models/errors.ts';
import { exigirAdministracionNumeracion, validarNumeroPerforacion } from './numeracion-perforacion-service.ts';
import { iniciarEscrituraSesion } from './escritura-sesion.ts';

type Db = Pick<PoolClient, 'query'>;
type Connections = Pick<Pool, 'connect'>;
export interface ReservaRectificable { numero_perforacion: number; id_pozo_original: string; asignado_en: string; bloqueada: boolean }
export interface VistaRectificacion { proximo: number | null; mayor_asignado: number; reservas: ReservaRectificable[] }
export interface SolicitudRectificacion {
  desde: number; esperado: number; mayor_esperado: number;
  reservas: { numero_perforacion: number; id_pozo_original: string; asignado_en: string }[];
  motivo: string; sin_referencias_externas: boolean;
}

function validarDesde(desde: number) {
  validarNumeroPerforacion(desde);
  if (desde < 3282) throw new T05DatosIncorrectos('La rectificación no puede afectar el rango histórico hasta 3281.');
}

// Una sola sentencia obtiene contador y reservas con la misma fotografía de lectura.
async function vista(desde: number, db: Db): Promise<VistaRectificacion> {
  const { rows } = await db.query(`SELECT proximo, mayor_asignado,
    COALESCE((SELECT json_agg(r ORDER BY r.numero_perforacion) FROM (
      SELECT n.numero_perforacion, n.id_pozo_original::text, n.asignado_en::text,
        (EXISTS(SELECT 1 FROM pozo p WHERE p.id_pozo=n.id_pozo_original OR p.numero_perforacion=n.numero_perforacion)
         OR EXISTS(SELECT 1 FROM creacion_offline c WHERE c.resultado->>'id_pozo'=n.id_pozo_original::text OR c.resultado#>>'{pozo,id_pozo}'=n.id_pozo_original::text
           OR c.resultado->>'numero_perforacion'=n.numero_perforacion::text OR c.resultado#>>'{pozo,numero_perforacion}'=n.numero_perforacion::text)
         OR EXISTS(SELECT 1 FROM creacion_historica c WHERE c.resultado->>'id_pozo'=n.id_pozo_original::text OR c.resultado->>'numero_perforacion'=n.numero_perforacion::text)) AS bloqueada
      FROM numero_perforacion_reservado n WHERE n.numero_perforacion >= $1
      ORDER BY n.numero_perforacion LIMIT 101
    ) r), '[]'::json) AS reservas FROM numeracion_perforacion WHERE singleton=TRUE`, [desde]);
  const n = rows[0];
  return { proximo: n.proximo == null ? null : Number(n.proximo), mayor_asignado: n.mayor_asignado, reservas: n.reservas };
}

export async function previsualizarRectificacion(actor: number, desde: number, db: Db = myPool) {
  validarDesde(desde);
  await exigirAdministracionNumeracion(actor, db);
  return vista(desde, db);
}

export async function rectificarNumeracion(actor: number, solicitud: SolicitudRectificacion, pool: Connections = myPool) {
  validarDesde(solicitud.desde);
  if (typeof solicitud.motivo !== 'string' || solicitud.motivo.trim().length < 10 || solicitud.motivo.trim().length > 1000
      || solicitud.sin_referencias_externas !== true || !Array.isArray(solicitud.reservas)
      || !solicitud.reservas.length || solicitud.reservas.length > 100)
    throw new T05DatosIncorrectos('Se requiere motivo (10–1000 caracteres), reservas explícitas y declaración de ausencia de referencias y sincronizaciones pendientes.');
  const client = await pool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirAdministracionNumeracion(actor, client);
    // Mismo bloqueo que asignación automática, histórica y configuración.
    await client.query('SELECT singleton FROM numeracion_perforacion WHERE singleton=TRUE FOR UPDATE');
    const actual = await vista(solicitud.desde, client);
    const conflicto = () => new T05ConflictoNumeracion('La numeración cambió, contiene referencias o no corresponde a reservas finales de pruebas eliminadas. Actualice la vista previa.');
    if (actual.proximo !== solicitud.esperado || actual.mayor_asignado !== solicitud.mayor_esperado
        || actual.proximo !== actual.mayor_asignado + 1 || solicitud.desde >= actual.proximo
        || !actual.reservas.length || actual.reservas.length > 100
        || actual.reservas[0].numero_perforacion !== solicitud.desde
        || actual.reservas.length !== solicitud.reservas.length) throw conflicto();
    for (let i = 0; i < actual.reservas.length; i++) {
      const a = actual.reservas[i], b = solicitud.reservas[i];
      if (a.bloqueada || a.numero_perforacion !== b.numero_perforacion || a.id_pozo_original !== b.id_pozo_original
          || a.asignado_en !== b.asignado_en) throw conflicto();
    }
    const { rows: restantes } = await client.query(`SELECT GREATEST(3281,
      COALESCE((SELECT max(numero_perforacion) FROM numero_perforacion_reservado WHERE numero_perforacion<$1),0),
      COALESCE((SELECT max(numero_perforacion) FROM pozo),0)) AS mayor`, [solicitud.desde]);
    const mayorNuevo = restantes[0].mayor;
    if (mayorNuevo >= solicitud.desde) throw conflicto();
    // Archivar la identidad original ANTES de liberar exclusividad. Todo o nada.
    const { rows: auditoria } = await client.query(`INSERT INTO numeracion_rectificacion
      (actor,motivo,sin_referencias_externas,proximo_anterior,mayor_anterior,proximo_nuevo,mayor_nuevo,reservas_anuladas)
      VALUES ($1,$2,TRUE,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
      [actor, solicitud.motivo.trim(), actual.proximo, actual.mayor_asignado, solicitud.desde, mayorNuevo, JSON.stringify(actual.reservas)]);
    const borrado = await client.query('DELETE FROM numero_perforacion_reservado WHERE numero_perforacion >= $1', [solicitud.desde]);
    if (borrado.rowCount !== actual.reservas.length) throw conflicto();
    await client.query('UPDATE numeracion_perforacion SET proximo=$1,mayor_asignado=$2 WHERE singleton=TRUE', [solicitud.desde, mayorNuevo]);
    await client.query('INSERT INTO numeracion_perforacion_configuracion(anterior,proximo,cambiado_por) VALUES ($1,$2,$3)', [actual.proximo, solicitud.desde, actor]);
    await client.query('COMMIT');
    return { proximo: solicitud.desde, minimo: solicitud.desde, agotado: false, rectificacion_id: String(auditoria[0].id) };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
