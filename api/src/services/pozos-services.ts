import { myPool } from "../db/pool.ts";
import type { Pozo, Estado, NuevoPozo } from "../models/schemas.ts";

type PozoUpdate = Partial<
  Omit<Pozo, "id_pozo" | "creado_por" | "fecha_creado">
>;

// Crear pozo
export async function createPozo(
  id_usuario: number,
  data: NuevoPozo
): Promise<Pozo> {
  const sql = `
    INSERT INTO public.pozo (
      id_propietario, id_sitio, empresa, id_perforador, creado_por,
      fecha_inicio, fecha_fin, profundidad_final_m, sello_sanitario,
      pre_filtro, nivel_estatico_m, nivel_dinamico_m, caudal_estimado_lh,
      metodo_sedimentario, metodo_rocoso
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
    )
    RETURNING *;
  `;

  const vals = [
    data.id_propietario,
    data.id_sitio,
    data.empresa,
    data.id_perforador,
    id_usuario,
    data.fecha_inicio ?? null,
    data.fecha_fin ?? null,
    data.profundidad_final_m ?? null,
    data.sello_sanitario ?? null,
    data.pre_filtro ?? null,
    data.nivel_estatico_m ?? null,
    data.nivel_dinamico_m ?? null,
    data.caudal_estimado_lh ?? null,
    data.metodo_sedimentario ?? null,
    data.metodo_rocoso ?? null,
  ];

  const { rows } = await myPool.query(sql, vals);
  return rows[0] as Pozo;
}

// Editar pozo
export async function updatePozo(
  id_pozo: number,
  data: PozoUpdate
): Promise<Pozo | void> {
  const sql = `    UPDATE public.pozo
  SET
    id_propietario      = COALESCE($2::integer,  id_propietario),
    id_sitio            = COALESCE($3::integer,  id_sitio),
    empresa             = COALESCE($4::text,     empresa),
    id_perforador       = COALESCE($5::integer,  id_perforador),
    fecha_inicio        = COALESCE($6::date,     fecha_inicio),
    fecha_fin           = COALESCE($7::date,     fecha_fin),
    profundidad_final_m = COALESCE($8::numeric,  profundidad_final_m),
    sello_sanitario     = COALESCE($9::boolean,  sello_sanitario),
    pre_filtro          = COALESCE($10::text,    pre_filtro),
    nivel_estatico_m    = COALESCE($11::numeric, nivel_estatico_m),
    nivel_dinamico_m    = COALESCE($12::numeric, nivel_dinamico_m),
    caudal_estimado_lh  = COALESCE($13::numeric, caudal_estimado_lh),
    metodo_sedimentario = COALESCE($14::text,    metodo_sedimentario),
    metodo_rocoso       = COALESCE($15::text,    metodo_rocoso),
    cementacion         = COALESCE($16::text,    cementacion),
    desarrollo          = COALESCE($17::text,    desarrollo),
    revestimiento       = COALESCE($18::text,    revestimiento) -- 👈 string, no array
  WHERE id_pozo = $1
  RETURNING *;
  `;

  const vals = [
    id_pozo,
    data.id_propietario ?? null,
    data.id_sitio ?? null,
    data.empresa ?? null,
    data.id_perforador ?? null,
    data.fecha_inicio ?? null,
    data.fecha_fin ?? null,
    data.profundidad_final_m ?? null,
    data.sello_sanitario ?? null,
    data.pre_filtro ?? null,
    data.nivel_estatico_m ?? null,
    data.nivel_dinamico_m ?? null,
    data.caudal_estimado_lh ?? null,
    data.metodo_sedimentario ?? null,
    data.metodo_rocoso ?? null,
    data.cementacion ?? null,
    data.desarrollo ?? null,
    (data as any).revestimiento ?? null,
  ];

  const { rows } = await myPool.query(sql, vals);
  return rows[0] as Pozo | undefined;
}

// Obtener un pozo específico
export async function getPozoById(id_pozo: number): Promise<Pozo | null> {
  const { rows } = await myPool.query(
    "SELECT * FROM public.pozo WHERE id_pozo = $1",
    [id_pozo]
  );
  return rows[0] ?? null;
}

export async function deletePozo(id_pozo: number): Promise<boolean> {
  const result = await myPool.query(
    "DELETE FROM public.pozo WHERE id_pozo = $1",
    [id_pozo]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updatePozoFoto(
  id_pozo: number,
  fotoUrl: string
): Promise<Pozo | null> {
  const sql = `
    UPDATE public.pozo
    SET foto_url = $2
    WHERE id_pozo = $1
    RETURNING *;
  `;

  const vals = [id_pozo, fotoUrl];

  const { rows } = await myPool.query(sql, vals);
  return (rows[0] as Pozo) ?? null;
}
export async function getAllPozo(
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean
) {
  let query = "SELECT * FROM public.pozo WHERE 1=1 ";
  const params = [];
  if (caudal_min !== undefined) {
    params.push(caudal_min);
    query += ` AND caudal_estimado_lh >= $${params.length} `;
  }

  if (caudal_max !== undefined) {
    params.push(caudal_max);
    query += ` AND caudal_estimado_lh <= $${params.length} `;
  }

  if (profundidad_max !== undefined) {
    params.push(profundidad_max);
    query += ` AND profundidad_final_m <= $${params.length} `;
  }

  if (profundidad_min !== undefined) {
    params.push(profundidad_min);
    query += ` AND profundidad_final_m >= $${params.length} `;
  }

  if (sello_sanitario !== undefined) {
    params.push(sello_sanitario);
    query += ` AND sello_sanitario = $${params.length} `;
  }

  query += " ORDER BY id_pozo";

  const { rows } = await myPool.query(query, params);
  return rows as Pozo[];
}

export async function getPozosByPropietario(
  id_propietario: number,
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean
): Promise<Pozo[]> {
  let query = "SELECT * FROM public.pozo WHERE id_propietario = $1 ";

  const params: any[] = [id_propietario];

  if (caudal_min !== undefined) {
    params.push(caudal_min);
    query += ` AND caudal_estimado_lh >= $${params.length} `;
  }

  if (caudal_max !== undefined) {
    params.push(caudal_max);
    query += ` AND caudal_estimado_lh <= $${params.length} `;
  }

  if (profundidad_max !== undefined) {
    params.push(profundidad_max);
    query += ` AND profundidad_final_m <= $${params.length} `;
  }

  if (profundidad_min !== undefined) {
    params.push(profundidad_min);
    query += ` AND profundidad_final_m >= $${params.length} `;
  }

  if (sello_sanitario !== undefined) {
    params.push(sello_sanitario);
    query += ` AND sello_sanitario = $${params.length} `;
  }

  query += " ORDER BY id_pozo ";

  const { rows } = await myPool.query(query, params);
  return rows as Pozo[];
}

export async function getPozosByPerforador(
  id_perforador: number,
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean
): Promise<Pozo[]> {
  let query = " SELECT * FROM public.pozo WHERE id_perforador = $1 ";

  const params: any[] = [id_perforador];
  if (caudal_min !== undefined) {
    params.push(caudal_min);
    query += ` AND caudal_estimado_lh >= $${params.length} `;
  }

  if (caudal_max !== undefined) {
    params.push(caudal_max);
    query += ` AND caudal_estimado_lh <= $${params.length} `;
  }

  if (profundidad_max !== undefined) {
    params.push(profundidad_max);
    query += ` AND profundidad_final_m <= $${params.length} `;
  }

  if (profundidad_min !== undefined) {
    params.push(profundidad_min);
    query += ` AND profundidad_final_m >= $${params.length} `;
  }

  if (sello_sanitario !== undefined) {
    params.push(sello_sanitario);
    query += ` AND sello_sanitario = $${params.length} `;
  }

  query += " ORDER BY id_pozo";
  const { rows } = await myPool.query(query, params);
  return rows as Pozo[];
}
