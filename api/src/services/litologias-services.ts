import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import type { LitologiaActualizarBody, LitologiaCrearBody, LitologiaCatalogo, LitologiaPublica } from "../models/schemas.ts";

const columnasPublicas = "id_litologia,codigo,nombre,familia,color,patron,activo,orden";
const columnasAdmin = `${columnasPublicas},es_inicial,creado_en,actualizado_en`;

export async function listarLitologias(incluirInactivas = false): Promise<LitologiaPublica[]> {
  const { rows } = await myPool.query<LitologiaPublica>(`SELECT ${columnasPublicas} FROM catalogo_litologia WHERE activo OR $1::boolean ORDER BY orden,nombre`, [incluirInactivas]);
  return rows;
}

export async function obtenerLitologia(id: number): Promise<LitologiaPublica | null> {
  const { rows } = await myPool.query<LitologiaPublica>(`SELECT ${columnasPublicas} FROM catalogo_litologia WHERE id_litologia=$1`, [id]);
  return rows[0] ?? null;
}

export async function crearLitologia(data: LitologiaCrearBody): Promise<LitologiaCatalogo> {
  try {
    const { rows } = await myPool.query<LitologiaCatalogo>(`INSERT INTO catalogo_litologia (codigo,nombre,familia,color,patron,orden,es_inicial) VALUES ($1,btrim($2),$3,$4,$5,$6,FALSE) RETURNING ${columnasAdmin}`,[data.codigo,data.nombre,data.familia,data.color,data.patron,data.orden]);
    return rows[0];
  } catch (error: unknown) { throw traducirErrorCatalogo(error); }
}

export async function actualizarLitologia(id: number, data: LitologiaActualizarBody): Promise<LitologiaCatalogo | null> {
  try {
    const { rows } = await myPool.query<LitologiaCatalogo>(`UPDATE catalogo_litologia SET nombre=btrim($2),familia=$3,color=$4,patron=$5,orden=$6,actualizado_en=now() WHERE id_litologia=$1 RETURNING ${columnasAdmin}`,[id,data.nombre,data.familia,data.color,data.patron,data.orden]);
    return rows[0] ?? null;
  } catch (error: unknown) { throw traducirErrorCatalogo(error); }
}

export async function cambiarEstadoLitologia(id: number, activo: boolean): Promise<LitologiaCatalogo | null> {
  const { rows } = await myPool.query<LitologiaCatalogo>(`UPDATE catalogo_litologia SET activo=$2,actualizado_en=now() WHERE id_litologia=$1 RETURNING ${columnasAdmin}`,[id,activo]);
  return rows[0] ?? null;
}

export function traducirErrorCatalogo(error: unknown): unknown {
  const codigo = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (codigo === "23505") return new err.T05RegistroDuplicado("Ya existe una litología con ese nombre o código.");
  if (codigo === "23514" || codigo === "22001") return new err.T05DatosIncorrectos("Los datos de la litología no son válidos.");
  return error;
}
