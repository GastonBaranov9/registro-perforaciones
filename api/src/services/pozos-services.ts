import { conEscrituraSesion, contextoEscritura, iniciarEscrituraSesion } from "./escritura-sesion.ts";
import { obtenerSelloSanitario, validarSelloSanitario } from './sello-sanitario-service.ts';
import { myPool } from "../db/pool.ts";
import type { Pozo, PozoDetalle, PozoListado, Estado, NuevoPozo } from "../models/schemas.ts";
import { datosTecnicosParaCreacion } from "../constants/datos-tecnicos-estandar.ts";
import * as err from "../models/errors.ts";

type PozoUpdate = Partial<
  Omit<Pozo, "id_pozo" | "creado_por" | "fecha_creado">
>;

// Crear pozo
export async function createPozo(
  id_usuario: number,
  data: NuevoPozo
): Promise<Pozo> {
  return conEscrituraSesion(async (dbEscritura) => {
    if (data.numero_perforacion != null) throw new err.T05DatosIncorrectos('Use Carga histórica para asignar un número explícito.');
    let estandar: ReturnType<typeof datosTecnicosParaCreacion>;
    try { estandar = datosTecnicosParaCreacion(data); }
    catch (error) { throw new err.T05DatosIncorrectos(error instanceof Error ? error.message : "Los datos técnicos no son válidos."); }
    const sql = `
      INSERT INTO public.pozo (
        id_propietario, id_sitio, empresa, id_perforador, creado_por,
        fecha_inicio, fecha_fin, profundidad_final_m, sello_sanitario,
        pre_filtro, nivel_estatico_m, nivel_dinamico_m, caudal_estimado_lh,
        metodo_sedimentario, metodo_rocoso, cementacion, desarrollo
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING id_pozo, origen, numero_perforacion, propietario_provisional, id_propietario, id_sitio, empresa, id_perforador, creado_por,
        fecha_inicio, fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro,
        nivel_estatico_m, nivel_dinamico_m, caudal_estimado_lh, metodo_sedimentario,
        metodo_rocoso, cementacion, desarrollo, revestimiento, foto_url, fecha_creado;
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
      estandar.metodo_sedimentario,
      estandar.metodo_rocoso,
      estandar.cementacion,
      estandar.desarrollo,
    ];

    const { rows } = await dbEscritura.query(sql, vals);
    return sinDatosSupuestos({ ...rows[0], id_propietario: rows[0].id_propietario == null ? null : Number(rows[0].id_propietario) } as Pozo);
  }, myPool, false);
}

// Editar pozo
export async function updatePozo(
  id_pozo: number,
  data: PozoUpdate,
  db: Pick<typeof myPool, "query"> = myPool,
): Promise<Pozo | void> {
  if (db === myPool && !contextoEscritura.getStore()) {
    const client = await myPool.connect();
    let descartar = false;
    try {
      await iniciarEscrituraSesion(client, false);
      const resultado = await updatePozo(id_pozo, data, client);
      await client.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { descartar = true; }
      throw error;
    } finally { client.release(descartar); }
  }
  return conEscrituraSesion(async (dbEscritura) => {
    await dbEscritura.query('SELECT pg_advisory_xact_lock($1::integer,606)', [id_pozo]);
    await dbEscritura.query('SELECT id_pozo FROM pozo WHERE id_pozo=$1 FOR UPDATE', [id_pozo]);
    if (data.profundidad_final_m != null)
      validarSelloSanitario(await obtenerSelloSanitario(dbEscritura, id_pozo), data.profundidad_final_m);
    if (Object.hasOwn(data, "numero_perforacion")) {
      const actual = await dbEscritura.query("SELECT numero_perforacion FROM public.pozo WHERE id_pozo=$1", [id_pozo]);
      if (actual.rows[0] && data.numero_perforacion !== actual.rows[0].numero_perforacion)
        throw new err.T05DatosIncorrectos("La numeración no se puede modificar desde la edición habitual.");
    }
    const sql = `    UPDATE public.pozo
    SET
      id_propietario      = COALESCE($2::integer,  id_propietario),
      id_sitio            = id_sitio,
      empresa             = COALESCE($3::text,     empresa),
      id_perforador       = COALESCE($4::integer,  id_perforador),
      fecha_inicio        = COALESCE($5::date,     fecha_inicio),
      fecha_fin           = COALESCE($6::date,     fecha_fin),
      profundidad_final_m = COALESCE($7::numeric,  profundidad_final_m),
      sello_sanitario     = COALESCE($8::boolean,  sello_sanitario),
      pre_filtro          = COALESCE($9::text,    pre_filtro),
      nivel_estatico_m    = COALESCE($10::numeric, nivel_estatico_m),
      nivel_dinamico_m    = COALESCE($11::numeric, nivel_dinamico_m),
      caudal_estimado_lh  = COALESCE($12::numeric, caudal_estimado_lh),
      metodo_sedimentario = COALESCE($13::text,    metodo_sedimentario),
      metodo_rocoso       = COALESCE($14::text,    metodo_rocoso),
      cementacion         = COALESCE($15::text,    cementacion),
      desarrollo          = COALESCE($16::text,    desarrollo),
      revestimiento       = COALESCE($17::text,    revestimiento)
    WHERE id_pozo = $1 AND id_propietario IS NOT DISTINCT FROM $2::bigint
    RETURNING id_pozo, origen, numero_perforacion, propietario_provisional, id_propietario, id_sitio, empresa, id_perforador, creado_por,
      fecha_inicio, fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro,
      nivel_estatico_m, nivel_dinamico_m, caudal_estimado_lh, metodo_sedimentario,
      metodo_rocoso, cementacion, desarrollo, revestimiento, foto_url, fecha_creado;
    `;

    const vals = [
      id_pozo,
      data.id_propietario ?? null,
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
      data.revestimiento ?? null,
    ];

    const { rows } = await dbEscritura.query(sql, vals);
    return rows[0] ? sinDatosSupuestos({ ...rows[0], id_propietario: rows[0].id_propietario == null ? null : Number(rows[0].id_propietario) } as Pozo) : undefined;
  }, db, false);
}

// Obtener un pozo específico
export async function getPozoById(id_pozo: number): Promise<PozoDetalle | null> {
  const { rows } = await myPool.query<PozoDetalle>(
    `SELECT p.id_pozo, p.origen, p.numero_perforacion, p.propietario_provisional, p.perforador_provisional, p.id_propietario, p.id_sitio, p.empresa, p.id_perforador, p.creado_por,
      (SELECT json_build_object('desde_m',ss.desde_m,'hasta_m',ss.hasta_m)
       FROM public.sello_sanitario_pozo ss WHERE ss.id_pozo=p.id_pozo) AS sello_sanitario_constructivo,
      p.fecha_inicio, p.fecha_fin, p.profundidad_final_m, p.sello_sanitario, p.pre_filtro,
      p.nivel_estatico_m, p.nivel_dinamico_m, p.caudal_estimado_lh, p.metodo_sedimentario,
      p.metodo_rocoso, p.cementacion, p.desarrollo, p.revestimiento,
      CASE WHEN p.foto_url IS NULL THEN NULL ELSE '/usuarios/' || COALESCE(p.id_propietario, p.id_perforador, p.creado_por) || '/pozos/' || p.id_pozo || '/foto' END AS foto_url,
      p.fecha_creado, COALESCE(prop.nombre, p.propietario_provisional) AS propietario_nombre, prop.propietario_email AS propietario_email,
      prop.documento_rut AS propietario_documento_rut, prop.telefono AS propietario_telefono,
      prop.direccion AS propietario_direccion, prop.localidad AS propietario_localidad,
      prop.departamento AS propietario_departamento, prop.observaciones AS propietario_observaciones,
      COALESCE(perf.nombre,p.perforador_provisional) AS perforador_nombre, perf.email AS perforador_email,
      json_build_object('id_sitio',s.id_sitio,'departamento',s.departamento,'localidad',s.localidad,
        'latitud',s.latitud,'longitud',s.longitud,'padron',s.padron) AS sitio
     FROM public.pozo p
     LEFT JOIN public.usuario prop ON prop.id_usuario=p.id_propietario
     LEFT JOIN public.usuario perf ON perf.id_usuario=p.id_perforador
     LEFT JOIN public.sitio s ON s.id_sitio=p.id_sitio
     WHERE p.id_pozo = $1`,
    [id_pozo]
  );
  const fila = rows[0];
  return fila ? sinDatosSupuestos({
    ...fila,
    id_pozo: Number(fila.id_pozo), id_propietario: fila.id_propietario == null ? null : Number(fila.id_propietario),
    id_sitio: fila.id_sitio == null ? null : Number(fila.id_sitio), id_perforador: fila.id_perforador == null ? null : Number(fila.id_perforador),
    sitio: fila.id_sitio == null ? undefined : { ...fila.sitio, id_sitio: Number(fila.sitio.id_sitio) },
    creado_por: fila.creado_por == null ? undefined : Number(fila.creado_por),
    profundidad_final_m: numeroOpcional(fila.profundidad_final_m),
    nivel_estatico_m: numeroOpcional(fila.nivel_estatico_m),
    nivel_dinamico_m: numeroOpcional(fila.nivel_dinamico_m),
    caudal_estimado_lh: numeroOpcional(fila.caudal_estimado_lh),
  }) : null;
}

function numeroOpcional(valor:unknown):number|undefined{return valor==null?undefined:Number(valor);}

// Los serializers numéricos pueden convertir NULL a 0. Para históricos se
// omiten hechos opcionales desconocidos; las FK nullable conservan NULL.
function sinDatosSupuestos<T extends Pozo>(fila: T): T {
  const copia = { ...fila,
    id_pozo: Number(fila.id_pozo),
    id_sitio: fila.id_sitio == null ? null : Number(fila.id_sitio),
    id_perforador: fila.id_perforador == null ? null : Number(fila.id_perforador),
  };
  if (fila.origen !== 'historico') return copia;
  for (const campo of ['empresa','fecha_inicio','fecha_fin','profundidad_final_m','sello_sanitario','pre_filtro','nivel_estatico_m','nivel_dinamico_m','caudal_estimado_lh','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento','foto_url'] as const)
    if (copia[campo] == null) delete copia[campo];
  return copia;
}

export async function deletePozo(id_pozo: number): Promise<boolean> {
  return conEscrituraSesion(async (dbEscritura) => {
    const result = await dbEscritura.query(
      "DELETE FROM public.pozo WHERE id_pozo = $1",
      [id_pozo]
    );

    return (result.rowCount ?? 0) > 0;
  }, myPool, false);
}

export async function updatePozoFoto(
  id_pozo: number,
  fotoUrl: string,
  db: Pick<typeof myPool,"query"> = myPool,
): Promise<Pozo | null> {
  return conEscrituraSesion(async (dbEscritura) => {
    const sql = `
      UPDATE public.pozo
      SET foto_url = $2
      WHERE id_pozo = $1
      RETURNING id_pozo, origen, numero_perforacion, propietario_provisional, id_propietario, id_sitio, empresa, id_perforador, creado_por,
        fecha_inicio, fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro,
        nivel_estatico_m, nivel_dinamico_m, caudal_estimado_lh, metodo_sedimentario,
        metodo_rocoso, cementacion, desarrollo, revestimiento, foto_url, fecha_creado;
    `;

    const vals = [id_pozo, fotoUrl];

    const { rows } = await dbEscritura.query(sql, vals);
    return rows[0] ? sinDatosSupuestos({ ...rows[0], id_propietario: rows[0].id_propietario == null ? null : Number(rows[0].id_propietario) } as Pozo) : null;
  }, db, false);
}
// Identificación de la lista en una sola consulta, conservando su alcance por rol.
const POZOS_LISTADO_SELECT = `SELECT p.id_pozo, p.origen, p.numero_perforacion, p.propietario_provisional, p.perforador_provisional, p.id_propietario, p.id_sitio, p.empresa, p.id_perforador, p.creado_por,
    p.fecha_inicio, p.fecha_fin, p.profundidad_final_m, p.sello_sanitario, p.pre_filtro,
    p.nivel_estatico_m, p.nivel_dinamico_m, p.caudal_estimado_lh, p.metodo_sedimentario,
    p.metodo_rocoso, p.cementacion, p.desarrollo, p.revestimiento,
    CASE WHEN p.foto_url IS NULL THEN NULL ELSE '/usuarios/' || COALESCE(p.id_propietario, p.id_perforador, p.creado_por) || '/pozos/' || p.id_pozo || '/foto' END AS foto_url,
    p.fecha_creado, COALESCE(prop.nombre, p.propietario_provisional, '') AS propietario_nombre,
    concat_ws(', ', COALESCE(NULLIF(trim(s.localidad), ''), 'Padrón ' || NULLIF(trim(s.padron), '')), s.departamento) AS sitio_nombre
    FROM public.pozo p
    LEFT JOIN public.usuario prop ON prop.id_usuario = p.id_propietario
    LEFT JOIN public.sitio s ON s.id_sitio = p.id_sitio`;

export async function getAllPozo(
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean
) {
  let query = `${POZOS_LISTADO_SELECT} WHERE 1=1 `;
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
  return rows.map(fila => sinDatosSupuestos({ ...fila, id_propietario: fila.id_propietario == null ? null : Number(fila.id_propietario) })) as PozoListado[];
}

export async function getPozosByPropietario(
  id_propietario: number,
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean
): Promise<PozoListado[]> {
  let query = `${POZOS_LISTADO_SELECT} WHERE id_propietario = $1 `;

  const params: Array<number | boolean> = [id_propietario];

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
  return rows.map(fila => sinDatosSupuestos({ ...fila, id_propietario: fila.id_propietario == null ? null : Number(fila.id_propietario) })) as PozoListado[];
}

export async function getPozosByPerforador(
  id_perforador: number,
  caudal_min: number,
  caudal_max: number,
  profundidad_max: number,
  profundidad_min: number,
  sello_sanitario: boolean,
  incluirPropiosComoPropietario = false
): Promise<PozoListado[]> {
  let query = `${POZOS_LISTADO_SELECT} WHERE (id_perforador = $1 ${incluirPropiosComoPropietario ? 'OR id_propietario = $1' : ''} OR (p.origen='historico' AND EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r USING(id_rol) WHERE ur.id_usuario=$1 AND lower(r.nombre)='operador_administrativo'))) `;

  const params: Array<number | boolean> = [id_perforador];
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
  return rows.map(fila => sinDatosSupuestos({ ...fila, id_propietario: fila.id_propietario == null ? null : Number(fila.id_propietario) })) as PozoListado[];
}
