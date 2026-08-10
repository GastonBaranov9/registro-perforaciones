import { myPool } from "../db/pool.ts";
import { Sitio, SitioBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
export async function createSitio(data: SitioBody): Promise<Sitio> {
  validarSitio(data);
  const sql = `
            INSERT INTO sitio
              (departamento, localidad, latitud, longitud)
            VALUES ($1, $2, $3, $4)
            RETURNING id_sitio, departamento, localidad, latitud, longitud;
          `;
  const { rows } = await myPool.query(sql, [
    data.departamento,
    data.localidad,
    data.latitud,
    data.longitud,
  ]);
  return rows[0] as Sitio;
}

export async function updateSitio(
  id_sitio: number,
  data: SitioBody
): Promise<Sitio | null> {
  validarSitio(data);
  const exists = await myPool.query(`SELECT 1 FROM sitio WHERE id_sitio = $1`, [
    id_sitio,
  ]);
  if (!exists.rows[0]) return null;

  const sql = `
    UPDATE sitio
    SET
      departamento = $2,
      localidad = $3,
      latitud = $4,
      longitud = $5
    WHERE id_sitio = $1
    RETURNING id_sitio, departamento, localidad, latitud, longitud;
  `;
  const { rows } = await myPool.query(sql, [
    id_sitio,
    data.departamento,
    data.localidad,
    data.latitud,
    data.longitud,
  ]);
  return rows[0] ?? null;
}

function validarSitio(data: SitioBody): void {
  if (!data.departamento.trim()) throw new err.T05DatosIncorrectos("El departamento es obligatorio.");
  const tieneLatitud=Boolean(data.latitud?.trim()),tieneLongitud=Boolean(data.longitud?.trim());
  if(tieneLatitud!==tieneLongitud)throw new err.T05DatosIncorrectos("Latitud y longitud deben registrarse juntas.");
  if(tieneLatitud){const lat=Number(data.latitud),lon=Number(data.longitud);
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)
      throw new err.T05DatosIncorrectos("Las coordenadas no son v\u00e1lidas.");}
}

export async function deleteSitio(id_sitio: number): Promise<Boolean> {
  const { rowCount } = await myPool.query(
    `
        DELETE FROM sitio
        WHERE id_sitio = $1
        `,
    [id_sitio]
  );
  if (rowCount === 0) throw new err.T05SitioNoEncontrado();
  return (rowCount ?? 0) > 0;
}

export async function getSitioById(id_sitio: number): Promise<Sitio> {
  const { rows } = await myPool.query(
    `
    SELECT id_sitio, departamento, localidad, latitud, longitud
    FROM sitio
    WHERE id_sitio = $1
    `,
    [id_sitio]
  );
  return rows[0] ?? null;
}

export async function getAllSitios(): Promise<Sitio[]> {
  const { rows } = await myPool.query(
    `
    SELECT id_sitio, departamento, localidad, latitud, longitud
    FROM sitio
    `
  );
  return rows;
}

export async function getSitioPropioById(id_sitio: number, id_usuario: number): Promise<Sitio | null> {
  const { rows } = await myPool.query(
    `SELECT s.id_sitio, s.departamento, s.localidad, s.latitud, s.longitud
       FROM sitio s
      WHERE s.id_sitio = $1
        AND EXISTS (
          SELECT 1 FROM pozo p
           WHERE p.id_sitio = s.id_sitio AND p.id_propietario = $2
        )`,
    [id_sitio, id_usuario]
  );
  return (rows[0] as Sitio | undefined) ?? null;
}

export async function getSitiosByPropietario(id_usuario: number): Promise<Sitio[]> {
  const { rows } = await myPool.query(
    `SELECT s.id_sitio, s.departamento, s.localidad, s.latitud, s.longitud
       FROM sitio s
      WHERE EXISTS (
        SELECT 1 FROM pozo p
         WHERE p.id_sitio = s.id_sitio AND p.id_propietario = $1
      )
      ORDER BY s.id_sitio`,
    [id_usuario]
  );
  return rows as Sitio[];
}
