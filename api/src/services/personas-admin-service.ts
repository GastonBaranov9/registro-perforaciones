import { myPool } from '../db/pool.ts';

export type PersonaAdministrada = {
  id_usuario: number; nombre: string; documento_rut: string | null;
  email: string | null; cuenta_acceso: boolean; activo: boolean; roles: string[];
};

// La tabla usuario contiene tanto cuentas como identidades sin acceso.
const filtro = `($1::text IS NULL OR
  translate(lower(u.nombre), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') LIKE '%' ||
    translate(lower($1), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') || '%'
  OR translate(lower(COALESCE(u.documento_rut, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') LIKE '%' ||
    translate(lower($1), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun') || '%'
  OR u.id_usuario = CASE WHEN $1 ~ '^[0-9]{1,18}$' THEN $1::bigint ELSE NULL END)`;

export async function buscarPersonasAdministradas(busqueda = '', limite = 30, offset = 0) {
  const termino = busqueda.trim() || null;
  const params = [termino, limite, offset];
  const [listado, conteo] = await Promise.all([
    myPool.query<PersonaAdministrada>(`
      SELECT u.id_usuario, u.nombre, u.documento_rut,
        COALESCE(u.email::text, u.propietario_email) AS email,
        u.cuenta_acceso, u.activo,
        COALESCE(array_agg(DISTINCT r.nombre) FILTER (WHERE r.nombre IS NOT NULL), ARRAY[]::text[]) AS roles
      FROM usuario u LEFT JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario
      LEFT JOIN rol r ON r.id_rol=ur.id_rol
      WHERE ${filtro}
      GROUP BY u.id_usuario
      ORDER BY u.id_usuario DESC LIMIT $2 OFFSET $3`, params),
    myPool.query<{ total: string }>(`SELECT count(*)::text AS total FROM usuario u WHERE ${filtro}`, [termino]),
  ]);
  return { personas: listado.rows.map(p => ({ ...p, id_usuario: Number(p.id_usuario) })), total: Number(conteo.rows[0]?.total ?? 0) };
}

export async function perforacionesDePropietario(id: number, limite = 30, offset = 0) {
  const [listado, conteo] = await Promise.all([
    myPool.query(`SELECT p.id_pozo, p.numero_perforacion, p.fecha_creado,
      concat_ws(', ', NULLIF(trim(s.localidad), ''), s.departamento) AS ubicacion
      FROM pozo p LEFT JOIN sitio s ON s.id_sitio=p.id_sitio
      WHERE p.id_propietario=$1 ORDER BY p.fecha_creado DESC, p.id_pozo DESC LIMIT $2 OFFSET $3`, [id, limite, offset]),
    myPool.query<{ total: string }>('SELECT count(*)::text AS total FROM pozo WHERE id_propietario=$1', [id]),
  ]);
  return { perforaciones: listado.rows.map(p => ({ ...p, id_pozo: Number(p.id_pozo) })), total: Number(conteo.rows[0]?.total ?? 0) };
}
