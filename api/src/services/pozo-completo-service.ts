import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { PerfilLitologicoVistaPreviaBody, Pozo, PozoCompletoBody, PozoCompletoUpdateBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { validarPersonaPozo } from "./candidatos-pozo-service.ts";
import { aislarFotoExistente, decodificarFotoBase64, purgarFotoConfirmada, restaurarFotoAislada, type FotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";
import { normalizarCoordenadasTexto } from "../utils/coordenadas.ts";
import { DATOS_TECNICOS_ESTANDAR, datosTecnicosParaCreacion } from "../constants/datos-tecnicos-estandar.ts";

export interface PozoCompletoResultado {
  pozo: Pozo;
  sitio: import("../models/schemas.ts").Sitio;
  intervalos_litologicos: Array<{ id_intervalo_litologico: number; id_pozo: number; desde_m: number; hasta_m: number; material: string; id_litologia:number|null }>;
  intervalos_diametro: Array<{ id_intervalo_diametro_perforacion: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero" | null }>;
  intervalos_filtro: Array<{ id_intervalo_filtro: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero"; ranura_mm: 0.5 | 0.75 | 1 | null }>;
  niveles_aporte: Array<{ id_nivel_aporte: number; id_pozo: number; profundidad_m: number }>;
}

type Intervalo = { desde_m: number; hasta_m: number };
type DatosCompletosPozo = PozoCompletoBody | PozoCompletoUpdateBody;
type IntervaloOriginal = {
  id_intervalo_litologico: number;
  desde_m: number;
  hasta_m: number;
  material: string;
  id_litologia: number | null;
};

export function validarPozoCompleto(data: DatosCompletosPozo): string[] {
  const errores = validarDatosTecnicosPozo({
    profundidad_final_m: data.pozo.profundidad_final_m,
    intervalos_litologicos: data.intervalos_litologicos,
    intervalos_diametro: data.intervalos_diametro,
    intervalos_filtro: data.intervalos_filtro,
    niveles_aporte: data.niveles_aporte,
  });
  for (const [campo, valor] of Object.entries(data.pozo).filter(([campo]) => campo in DATOS_TECNICOS_ESTANDAR)) {
    if (typeof valor === "string" && !valor.trim()) errores.push(`El campo ${campo} no puede estar vacío.`);
  }
  if ("sitio_nuevo" in data && !("foto_accion" in data)) {
    if (!normalizarCoordenadasTexto(data.sitio_nuevo.latitud, data.sitio_nuevo.longitud, true)) errores.push("Las coordenadas del sitio son invÃ¡lidas.");
    if (!data.sitio_nuevo.departamento.trim()) errores.push("El departamento del sitio es obligatorio.");
  }
  if ("foto_accion" in data) {
    const idsPersistidos = data.intervalos_litologicos.map((intervalo) => intervalo.id_intervalo_litologico).filter((id): id is number => id !== undefined);
    if (new Set(idsPersistidos).size !== idsPersistidos.length) errores.push("No se puede repetir un id_intervalo_litologico persistido.");
  }
  return errores;
}

export function validarDatosTecnicosPozo(data: PerfilLitologicoVistaPreviaBody): string[] {
  const errores: string[] = [];
  const profundidad = data.profundidad_final_m;
  validarIntervalos(data.intervalos_litologicos, "litológico", profundidad, errores);
  validarIntervalos(data.intervalos_diametro, "de diámetro", profundidad, errores);
  validarIntervalos(data.intervalos_filtro ?? [], "de filtro", profundidad, errores);
  data.intervalos_diametro.forEach((i, n) => { if (i.material_tuberia !== "PVC" && i.material_tuberia !== "Acero") errores.push(`Tubería ${n + 1}: material inválido.`); });
  (data.intervalos_filtro ?? []).forEach((i, n) => {
    if (i.material_tuberia !== "PVC" && i.material_tuberia !== "Acero") errores.push(`Filtro ${n + 1}: material inválido.`);
    if (i.ranura_mm == null && i.id_intervalo_filtro == null) errores.push(`Filtro ${n + 1}: la ranura es obligatoria.`);
    else if (i.ranura_mm != null && ![0.5, 0.75, 1].includes(i.ranura_mm)) errores.push(`Filtro ${n + 1}: ranura inválida.`);
  });
  data.niveles_aporte.forEach((aporte, indice) => {
    if (!Number.isFinite(aporte.profundidad_m) || aporte.profundidad_m < 0)
      errores.push(`Aporte ${indice + 1}: la profundidad debe ser mayor o igual a 0.`);
    if (profundidad != null && aporte.profundidad_m > profundidad)
      errores.push(`Aporte ${indice + 1}: excede la profundidad final.`);
  });
  return errores;
}

function validarIntervalos(intervalos: readonly Intervalo[], nombre: string, profundidad: number | undefined, errores: string[]) {
  const ordenados = [...intervalos].sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m);
  ordenados.forEach((intervalo, indice) => {
    if (!Number.isFinite(intervalo.desde_m) || intervalo.desde_m < 0)
      errores.push(`Intervalo ${nombre} ${indice + 1}: desde debe ser mayor o igual a 0.`);
    if (!Number.isFinite(intervalo.hasta_m) || intervalo.hasta_m <= intervalo.desde_m)
      errores.push(`Intervalo ${nombre} ${indice + 1}: hasta debe ser mayor que desde.`);
    if (profundidad != null && intervalo.hasta_m > profundidad)
      errores.push(`Intervalo ${nombre} ${indice + 1}: excede la profundidad final.`);
    if (indice > 0 && intervalo.desde_m < ordenados[indice - 1].hasta_m)
      errores.push(`Los intervalos ${nombre} ${indice} y ${indice + 1} se solapan.`);
  });
}

export async function crearPozoCompleto(
  creadoPor: number,
  data: PozoCompletoBody,
  directorioFotos: string,
  pool: Pick<Pool, "connect"> = myPool,
): Promise<PozoCompletoResultado> {
  const errores = validarPozoCompleto(data);
  if (errores.length) throw new err.T05DatosIncorrectos(errores.join(" "));

  const client = await pool.connect();
  let archivoFinal: string | null = null;
  let archivoTemporal: string | null = null;
  try {
    await client.query("BEGIN");
    await validarPersonaPozo(data.pozo.id_propietario, "propietario", client);
    await validarPersonaPozo(data.pozo.id_perforador, "perforador", client);
    const sitio = await insertarSitio(client, data.sitio_nuevo);
    const pozo = await insertarPozo(client, creadoPor, data, sitio.id_sitio);
    const idPozo = pozo.id_pozo;
    const litologia = [] as PozoCompletoResultado["intervalos_litologicos"];
    const diametros = [] as PozoCompletoResultado["intervalos_diametro"];
    const aportes = [] as PozoCompletoResultado["niveles_aporte"];
    const filtros = [] as PozoCompletoResultado["intervalos_filtro"];

    for (const intervalo of data.intervalos_litologicos) {
      litologia.push(await insertarIntervaloLitologico(client, idPozo, intervalo));
    }
    for (const intervalo of data.intervalos_diametro) {
      const { rows } = await client.query(
        `INSERT INTO intervalo_diametro_perforacion (id_pozo, desde_m, hasta_m, diametro_pulg, material_tuberia)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id_intervalo_diametro_perforacion, id_pozo, desde_m, hasta_m, diametro_pulg, material_tuberia`,
        [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.diametro_pulg, intervalo.material_tuberia],
      );
      diametros.push(numerizarDiametro(rows[0]));
    }
    for (const intervalo of data.intervalos_filtro ?? []) {
      const { rows } = await client.query(`INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm`, [idPozo,intervalo.desde_m,intervalo.hasta_m,intervalo.diametro_pulg,intervalo.material_tuberia,intervalo.ranura_mm]);
      filtros.push(numerizarFiltro(rows[0]));
    }
    for (const aporte of data.niveles_aporte) {
      const { rows } = await client.query(
        `INSERT INTO nivel_aporte (id_pozo, profundidad_m) VALUES ($1, $2)
         RETURNING id_nivel_aporte, id_pozo, profundidad_m`,
        [idPozo, aporte.profundidad_m],
      );
      aportes.push(numerizarAporte(rows[0]));
    }

    if (data.foto) {
      const foto = decodificarFoto(data.foto);
      await fs.mkdir(directorioFotos, { recursive: true });
      archivoFinal = path.join(directorioFotos, `pozo-${idPozo}.${foto.extension}`);
      archivoTemporal = path.join(directorioFotos, `.pozo-${idPozo}-${randomUUID()}.tmp`);
      await fs.writeFile(archivoTemporal, foto.buffer, { flag: "wx" });
      await fs.rename(archivoTemporal, archivoFinal);
      archivoTemporal = null;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, `/usuarios/${data.pozo.id_propietario}/pozos/${idPozo}/foto`]);
      pozo.foto_url = `/usuarios/${data.pozo.id_propietario}/pozos/${idPozo}/foto`;
    }

    await client.query("COMMIT");
    return { pozo, sitio, intervalos_litologicos: litologia, intervalos_diametro: diametros, intervalos_filtro: filtros, niveles_aporte: aportes };
  } catch (error) {
    await client.query("ROLLBACK");
    if (archivoTemporal) await fs.rm(archivoTemporal, { force: true });
    if (archivoFinal) await fs.rm(archivoFinal, { force: true });
    throw error;
  } finally {
    client.release();
  }
}

export async function actualizarPozoCompleto(
  idPozo: number,
  data: PozoCompletoUpdateBody,
  directorioFotos: string,
  pool: Pick<Pool, "connect"> = myPool,
  opciones: { logger?: LoggerPurga; eliminarPostCommit?: (ruta: string) => Promise<void> } = {},
): Promise<PozoCompletoResultado> {
  const errores = validarPozoCompleto(data);
  if (data.foto_accion === "reemplazar" && !data.foto) errores.push("Debe adjuntar la fotografía de reemplazo.");
  if (data.foto_accion !== "reemplazar" && data.foto) errores.push("La fotografía solo se admite al reemplazar.");
  if (errores.length) throw new err.T05DatosIncorrectos(errores.join(" "));

  const client = await pool.connect();
  let fotoAislada: FotoAislada | null = null;
  let nuevo: string | null = null;
  let temporalNuevo: string | null = null;
  let resultado: PozoCompletoResultado;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::integer, 606)", [idPozo]);
    const { rows: bloqueado } = await client.query<{ id_pozo:number; id_sitio:number }>(
      "SELECT id_pozo,id_sitio FROM pozo WHERE id_pozo = $1 FOR UPDATE", [idPozo]);
    if (!bloqueado[0]) throw new err.T05PozoNoEncontrado();
    await validarPersonaPozo(data.pozo.id_propietario, "propietario", client);
    await validarPersonaPozo(data.pozo.id_perforador, "perforador", client);

    const p = data.pozo;
    const { rows } = await client.query(
      `UPDATE pozo SET id_propietario=$2, id_sitio=$3, empresa=$4, id_perforador=$5,
       fecha_inicio=$6, fecha_fin=$7, profundidad_final_m=$8, sello_sanitario=$9,
       pre_filtro=$10, nivel_estatico_m=$11, nivel_dinamico_m=$12, caudal_estimado_lh=$13,
       metodo_sedimentario=COALESCE($14::text,metodo_sedimentario), metodo_rocoso=COALESCE($15::text,metodo_rocoso),
       cementacion=COALESCE($16::text,cementacion), desarrollo=COALESCE($17::text,desarrollo), revestimiento=$18
       WHERE id_pozo=$1
       RETURNING id_pozo, id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio,
        fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
        caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento,
        foto_url, fecha_creado`,
      [idPozo,p.id_propietario,Number(bloqueado[0].id_sitio),p.empresa??null,p.id_perforador,p.fecha_inicio??null,p.fecha_fin??null,
       p.profundidad_final_m??null,p.sello_sanitario??null,p.pre_filtro??null,p.nivel_estatico_m??null,
       p.nivel_dinamico_m??null,p.caudal_estimado_lh??null,p.metodo_sedimentario??null,p.metodo_rocoso??null,
       p.cementacion??null,p.desarrollo??null,p.revestimiento??null],
    );
    const pozo = numerizarPozo({ ...rows[0], id_pozo: idPozo });

    const { rows: litologiasOriginales } = await client.query<IntervaloOriginal>(
      "SELECT id_intervalo_litologico,desde_m,hasta_m,material,id_litologia FROM intervalo_litologico WHERE id_pozo = $1 FOR UPDATE", [idPozo]);
    const originales = litologiasOriginales.map((fila) => ({
      id_intervalo_litologico: Number(fila.id_intervalo_litologico),
      desde_m: Number(fila.desde_m),
      hasta_m: Number(fila.hasta_m),
      material: String(fila.material),
      id_litologia: fila.id_litologia == null ? null : Number(fila.id_litologia),
    }));
    const resoluciones = resolverLitologiasOriginales(data.intervalos_litologicos, originales);
    const idsFiltros = data.intervalos_filtro.flatMap((filtro) => filtro.id_intervalo_filtro == null ? [] : [filtro.id_intervalo_filtro]);
    if (new Set(idsFiltros).size !== idsFiltros.length) throw new err.T05DatosIncorrectos("No se puede repetir un filtro persistido.");
    if (idsFiltros.length) {
      const { rows: filtrosOriginales } = await client.query<{id_intervalo_filtro:number}>(
        "SELECT id_intervalo_filtro FROM intervalo_filtro WHERE id_pozo=$1 AND id_intervalo_filtro=ANY($2::bigint[]) FOR UPDATE",
        [idPozo, idsFiltros],
      );
      if (filtrosOriginales.length !== idsFiltros.length) throw new err.T05DatosIncorrectos("Un filtro histórico no pertenece al pozo editado.");
    }
    await client.query("DELETE FROM intervalo_litologico WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_diametro_perforacion WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_filtro WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM nivel_aporte WHERE id_pozo = $1", [idPozo]);
    const hijos = await insertarHijos(client, idPozo, data, originales, resoluciones);

    if (data.foto_accion !== "conservar") {
      await fs.mkdir(directorioFotos, { recursive: true });
      fotoAislada = await aislarFotoExistente(idPozo, directorioFotos);
      if (data.foto_accion === "reemplazar" && data.foto) {
        const foto = decodificarFoto(data.foto);
        nuevo = path.join(directorioFotos, `pozo-${idPozo}.${foto.extension}`);
        temporalNuevo = path.join(directorioFotos, `.pozo-${idPozo}-${randomUUID()}.tmp`);
        await fs.writeFile(temporalNuevo, foto.buffer, { flag: "wx" });
        await fs.rename(temporalNuevo, nuevo);
        temporalNuevo = null;
        pozo.foto_url = `/usuarios/${p.id_propietario}/pozos/${idPozo}/foto`;
      } else pozo.foto_url = undefined;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, pozo.foto_url ?? null]);
    } else if (pozo.foto_url) {
      pozo.foto_url = `/usuarios/${p.id_propietario}/pozos/${idPozo}/foto`;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, pozo.foto_url]);
    }
    const sitio = await obtenerSitioTransaccional(client, Number(bloqueado[0].id_sitio));
    await client.query("COMMIT");
    resultado = { pozo, sitio, ...hijos };
  } catch (error) {
    await client.query("ROLLBACK");
    if (temporalNuevo) await fs.rm(temporalNuevo, { force: true });
    if (nuevo) await fs.rm(nuevo, { force: true });
    if (fotoAislada) {
      try { await restaurarFotoAislada(fotoAislada); }
      catch (restauracion) { throw new err.T05ErrorDesconocido("Falló la actualización y no se pudo restaurar la fotografía anterior.", { cause: restauracion }); }
    }
    throw error;
  } finally { client.release(); }
  await purgarFotoConfirmada(fotoAislada, idPozo, "actualizar_pozo_completo", opciones.logger, opciones.eliminarPostCommit);
  return resultado;
}

async function insertarHijos(client: PoolClient, idPozo: number, data: DatosCompletosPozo, originales?: IntervaloOriginal[], resoluciones?: Map<number, number | null | undefined>) {
  const intervalos_litologicos: PozoCompletoResultado["intervalos_litologicos"] = [];
  const intervalos_diametro: PozoCompletoResultado["intervalos_diametro"] = [];
  const niveles_aporte: PozoCompletoResultado["niveles_aporte"] = [];
  const intervalos_filtro: PozoCompletoResultado["intervalos_filtro"] = [];
  for (const i of data.intervalos_litologicos) {
    const originalId = originales === undefined ? undefined : resoluciones?.get(intervalos_litologicos.length) ?? null;
    intervalos_litologicos.push(await insertarIntervaloLitologico(client, idPozo, i, originalId));
  }
  for (const i of data.intervalos_diametro) {
    const { rows } = await client.query(`INSERT INTO intervalo_diametro_perforacion (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES ($1,$2,$3,$4,$5) RETURNING id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia]);
    intervalos_diametro.push(numerizarDiametro(rows[0]));
  }
  for (const i of data.intervalos_filtro ?? []) {
    const { rows } = await client.query(`INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia,i.ranura_mm ?? null]);
    intervalos_filtro.push(numerizarFiltro(rows[0]));
  }
  for (const a of data.niveles_aporte) {
    const { rows } = await client.query(`INSERT INTO nivel_aporte (id_pozo,profundidad_m) VALUES ($1,$2) RETURNING id_nivel_aporte,id_pozo,profundidad_m`, [idPozo,a.profundidad_m]);
    niveles_aporte.push(numerizarAporte(rows[0]));
  }
  return { intervalos_litologicos, intervalos_diametro, intervalos_filtro, niveles_aporte };
}

export function resolverLitologiasOriginales(
  intervalos: readonly PozoCompletoBody["intervalos_litologicos"][number][],
  originales: readonly IntervaloOriginal[],
): Map<number, number | null | undefined> {
  const resoluciones = new Map<number, number | null | undefined>();
  const consumidos = new Set<number>();
  for (const [indice, intervalo] of intervalos.entries()) {
    if (intervalo.id_litologia != null) {
      if (intervalo.id_intervalo_litologico != null) {
        const original = originales.find((fila) => fila.id_intervalo_litologico === intervalo.id_intervalo_litologico);
        resoluciones.set(indice, original?.id_litologia ?? null);
        if (original) consumidos.add(original.id_intervalo_litologico);
      } else {
        resoluciones.set(indice, undefined);
      }
      continue;
    }
    if (intervalo.id_intervalo_litologico != null) {
      const original = originales.find((fila) => fila.id_intervalo_litologico === intervalo.id_intervalo_litologico);
      resoluciones.set(indice, original?.id_litologia ?? null);
      if (original) consumidos.add(original.id_intervalo_litologico);
      continue;
    }
    const coincidencias = originales.filter((fila) =>
      fila.desde_m === intervalo.desde_m
      && fila.hasta_m === intervalo.hasta_m
      && normalizarMaterial(fila.material) === normalizarMaterial(intervalo.material));
    if (coincidencias.length > 1) throw new err.T05DatosIncorrectos("No se puede identificar de forma inequívoca un intervalo litológico legado.");
    if (coincidencias.length === 1 && consumidos.has(coincidencias[0].id_intervalo_litologico)) {
      throw new err.T05DatosIncorrectos("Un intervalo litológico original no puede reutilizarse en el mismo update.");
    }
    const candidatos = coincidencias;
    const original = candidatos[0];
    if (original) {
      consumidos.add(original.id_intervalo_litologico);
      resoluciones.set(indice, original.id_litologia);
    } else resoluciones.set(indice, undefined);
  }
  return resoluciones;
}

function normalizarMaterial(material: string): string {
  return material.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

async function insertarIntervaloLitologico(
  client: PoolClient,
  idPozo: number,
  intervalo: PozoCompletoBody["intervalos_litologicos"][number],
  originalId?: number | null,
): Promise<PozoCompletoResultado["intervalos_litologicos"][number]> {
  const idEnviado = intervalo.id_litologia ?? (originalId == null ? null : originalId);
  const esCreacion = originalId === undefined;
  const { rows } = await client.query(
    `WITH elegida AS (SELECT id_litologia,nombre FROM catalogo_litologia c
       WHERE (($5::bigint IS NOT NULL AND c.id_litologia=$5
         AND (c.activo OR ($6::bigint IS NOT NULL AND c.id_litologia=$6)))
       OR ($5::bigint IS NULL AND $7::boolean AND c.activo AND c.nombre_normalizado=litologia_normalizar($4)))
       FOR SHARE)
     INSERT INTO intervalo_litologico (id_pozo,desde_m,hasta_m,material,id_litologia)
     SELECT $1,$2,$3,COALESCE(c.nombre,$4),c.id_litologia
     FROM (SELECT 1) base LEFT JOIN elegida c ON TRUE
     WHERE $5::bigint IS NULL OR c.id_litologia IS NOT NULL
     RETURNING id_intervalo_litologico,id_pozo,desde_m,hasta_m,material,id_litologia`,
    [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.material, idEnviado, originalId ?? null, esCreacion],
  );
  const fila = rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new err.T05DatosIncorrectos("La litología indicada no existe o no está activa.");
  return numerizarLitologia(fila);
}

async function insertarSitio(client: PoolClient, sitio: PozoCompletoBody["sitio_nuevo"]): Promise<import("../models/schemas.ts").Sitio> {
  const coordenadas = normalizarCoordenadasTexto(sitio.latitud, sitio.longitud, true);
  if (!coordenadas) throw new err.T05DatosIncorrectos("Las coordenadas del sitio son invÃ¡lidas.");
  const { rows } = await client.query(
    `INSERT INTO public.sitio (departamento,localidad,latitud,longitud)
     VALUES ($1,$2,$3,$4)
     RETURNING id_sitio,departamento,localidad,latitud,longitud`,
    [sitio.departamento.trim(), sitio.localidad?.trim() || null, coordenadas.latitud, coordenadas.longitud],
  );
  return { ...rows[0], id_sitio: Number(rows[0].id_sitio) };
}

async function obtenerSitioTransaccional(client: PoolClient, idSitio: number): Promise<import("../models/schemas.ts").Sitio> {
  const { rows } = await client.query(
    "SELECT id_sitio,departamento,localidad,latitud,longitud FROM public.sitio WHERE id_sitio=$1",
    [idSitio],
  );
  if (!rows[0]) throw new err.T05SitioNoEncontrado();
  return { ...rows[0], id_sitio: Number(rows[0].id_sitio) };
}

async function insertarPozo(client: PoolClient, creadoPor: number, data: PozoCompletoBody, idSitio: number): Promise<Pozo> {
  const p = data.pozo;
  const estandar = datosTecnicosParaCreacion(p);
  const { rows } = await client.query(
    `INSERT INTO public.pozo (
      id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio, fecha_fin,
      profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
      caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id_pozo, id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio,
      fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
      caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento,
      foto_url, fecha_creado`,
    [p.id_propietario, idSitio, p.empresa ?? null, p.id_perforador, creadoPor, p.fecha_inicio ?? null,
      p.fecha_fin ?? null, p.profundidad_final_m ?? null, p.sello_sanitario ?? null, p.pre_filtro ?? null,
      p.nivel_estatico_m ?? null, p.nivel_dinamico_m ?? null, p.caudal_estimado_lh ?? null,
      estandar.metodo_sedimentario, estandar.metodo_rocoso, estandar.cementacion,
      estandar.desarrollo, p.revestimiento ?? null],
  );
  return numerizarPozo(rows[0]);
}

function decodificarFoto(foto: NonNullable<PozoCompletoBody["foto"]>) {
  return decodificarFotoBase64(foto.base64, foto.mime_type);
}

function numeroOpcional(valor: unknown): number | undefined { return valor == null ? undefined : Number(valor); }
function numerizarPozo(fila: Record<string,unknown>):Pozo{return{
  ...fila,
  id_pozo:Number(fila.id_pozo),id_propietario:Number(fila.id_propietario),id_sitio:Number(fila.id_sitio),id_perforador:Number(fila.id_perforador),
  creado_por:fila.creado_por==null?undefined:Number(fila.creado_por),
  profundidad_final_m:numeroOpcional(fila.profundidad_final_m),nivel_estatico_m:numeroOpcional(fila.nivel_estatico_m),
  nivel_dinamico_m:numeroOpcional(fila.nivel_dinamico_m),caudal_estimado_lh:numeroOpcional(fila.caudal_estimado_lh),
} as Pozo;}
function numerizarLitologia(fila: Record<string, unknown>) { return { id_intervalo_litologico: Number(fila.id_intervalo_litologico), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), material: String(fila.material),id_litologia:fila.id_litologia==null?null:Number(fila.id_litologia) }; }
function numerizarDiametro(fila: Record<string, unknown>) { return { id_intervalo_diametro_perforacion: Number(fila.id_intervalo_diametro_perforacion), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: fila.material_tuberia == null ? null : String(fila.material_tuberia) as "PVC" | "Acero" }; }
function numerizarFiltro(fila: Record<string, unknown>) { return { id_intervalo_filtro: Number(fila.id_intervalo_filtro), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: String(fila.material_tuberia) as "PVC" | "Acero", ranura_mm: fila.ranura_mm == null ? null : Number(fila.ranura_mm) as 0.5 | 0.75 | 1 }; }
function numerizarAporte(fila: Record<string, unknown>) { return { id_nivel_aporte: Number(fila.id_nivel_aporte), id_pozo: Number(fila.id_pozo), profundidad_m: Number(fila.profundidad_m) }; }
