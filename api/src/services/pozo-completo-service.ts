import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { PerfilLitologicoVistaPreviaBody, Pozo, PozoCompletoBody, PozoCompletoUpdateBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { validarPersonaPozo } from "./candidatos-pozo-service.ts";
import { aislarFotoExistente, decodificarFotoBase64, purgarFotoConfirmada, restaurarFotoAislada, type FotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";

export interface PozoCompletoResultado {
  pozo: Pozo;
  intervalos_litologicos: Array<{ id_intervalo_litologico: number; id_pozo: number; desde_m: number; hasta_m: number; material: string }>;
  intervalos_diametro: Array<{ id_intervalo_diametro_perforacion: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero" | null }>;
  intervalos_filtro: Array<{ id_intervalo_filtro: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero" }>;
  niveles_aporte: Array<{ id_nivel_aporte: number; id_pozo: number; profundidad_m: number }>;
}

type Intervalo = { desde_m: number; hasta_m: number };

export function validarPozoCompleto(data: PozoCompletoBody): string[] {
  return validarDatosTecnicosPozo({
    profundidad_final_m: data.pozo.profundidad_final_m,
    intervalos_litologicos: data.intervalos_litologicos,
    intervalos_diametro: data.intervalos_diametro,
    intervalos_filtro: data.intervalos_filtro,
    niveles_aporte: data.niveles_aporte,
  });
}

export function validarDatosTecnicosPozo(data: PerfilLitologicoVistaPreviaBody): string[] {
  const errores: string[] = [];
  const profundidad = data.profundidad_final_m;
  validarIntervalos(data.intervalos_litologicos, "litológico", profundidad, errores);
  validarIntervalos(data.intervalos_diametro, "de diámetro", profundidad, errores);
  validarIntervalos(data.intervalos_filtro ?? [], "de filtro", profundidad, errores);
  data.intervalos_diametro.forEach((i, n) => { if (i.material_tuberia !== "PVC" && i.material_tuberia !== "Acero") errores.push(`Tubería ${n + 1}: material inválido.`); });
  (data.intervalos_filtro ?? []).forEach((i, n) => { if (i.material_tuberia !== "PVC" && i.material_tuberia !== "Acero") errores.push(`Filtro ${n + 1}: material inválido.`); });
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
    const pozo = await insertarPozo(client, creadoPor, data);
    const idPozo = pozo.id_pozo;
    const litologia = [] as PozoCompletoResultado["intervalos_litologicos"];
    const diametros = [] as PozoCompletoResultado["intervalos_diametro"];
    const aportes = [] as PozoCompletoResultado["niveles_aporte"];
    const filtros = [] as PozoCompletoResultado["intervalos_filtro"];

    for (const intervalo of data.intervalos_litologicos) {
      const { rows } = await client.query(
        `INSERT INTO intervalo_litologico (id_pozo, desde_m, hasta_m, material)
         VALUES ($1, $2, $3, $4)
         RETURNING id_intervalo_litologico, id_pozo, desde_m, hasta_m, material`,
        [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.material],
      );
      litologia.push(numerizarLitologia(rows[0]));
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
      const { rows } = await client.query(`INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES ($1,$2,$3,$4,$5) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia`, [idPozo,intervalo.desde_m,intervalo.hasta_m,intervalo.diametro_pulg,intervalo.material_tuberia]);
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
    return { pozo, intervalos_litologicos: litologia, intervalos_diametro: diametros, intervalos_filtro: filtros, niveles_aporte: aportes };
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
    const { rows: bloqueado } = await client.query("SELECT id_pozo FROM pozo WHERE id_pozo = $1 FOR UPDATE", [idPozo]);
    if (!bloqueado[0]) throw new err.T05PozoNoEncontrado();
    await client.query("SELECT pg_advisory_xact_lock($1::integer, 606)", [idPozo]);
    await validarPersonaPozo(data.pozo.id_propietario, "propietario", client);
    await validarPersonaPozo(data.pozo.id_perforador, "perforador", client);

    const p = data.pozo;
    const { rows } = await client.query(
      `UPDATE pozo SET id_propietario=$2, id_sitio=$3, empresa=$4, id_perforador=$5,
       fecha_inicio=$6, fecha_fin=$7, profundidad_final_m=$8, sello_sanitario=$9,
       pre_filtro=$10, nivel_estatico_m=$11, nivel_dinamico_m=$12, caudal_estimado_lh=$13,
       metodo_sedimentario=$14, metodo_rocoso=$15, cementacion=$16, desarrollo=$17, revestimiento=$18
       WHERE id_pozo=$1
       RETURNING id_pozo, id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio,
        fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
        caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento,
        foto_url, fecha_creado`,
      [idPozo,p.id_propietario,p.id_sitio,p.empresa??null,p.id_perforador,p.fecha_inicio??null,p.fecha_fin??null,
       p.profundidad_final_m??null,p.sello_sanitario??null,p.pre_filtro??null,p.nivel_estatico_m??null,
       p.nivel_dinamico_m??null,p.caudal_estimado_lh??null,p.metodo_sedimentario??null,p.metodo_rocoso??null,
       p.cementacion??null,p.desarrollo??null,p.revestimiento??null],
    );
    const pozo = { ...rows[0], id_pozo: idPozo, profundidad_final_m: numeroOpcional(rows[0].profundidad_final_m) } as Pozo;

    await client.query("DELETE FROM intervalo_litologico WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_diametro_perforacion WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_filtro WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM nivel_aporte WHERE id_pozo = $1", [idPozo]);
    const hijos = await insertarHijos(client, idPozo, data);

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
    await client.query("COMMIT");
    resultado = { pozo, ...hijos };
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

async function insertarHijos(client: PoolClient, idPozo: number, data: PozoCompletoBody) {
  const intervalos_litologicos: PozoCompletoResultado["intervalos_litologicos"] = [];
  const intervalos_diametro: PozoCompletoResultado["intervalos_diametro"] = [];
  const niveles_aporte: PozoCompletoResultado["niveles_aporte"] = [];
  const intervalos_filtro: PozoCompletoResultado["intervalos_filtro"] = [];
  for (const i of data.intervalos_litologicos) {
    const { rows } = await client.query(`INSERT INTO intervalo_litologico (id_pozo,desde_m,hasta_m,material) VALUES ($1,$2,$3,$4) RETURNING id_intervalo_litologico,id_pozo,desde_m,hasta_m,material`, [idPozo,i.desde_m,i.hasta_m,i.material]);
    intervalos_litologicos.push(numerizarLitologia(rows[0]));
  }
  for (const i of data.intervalos_diametro) {
    const { rows } = await client.query(`INSERT INTO intervalo_diametro_perforacion (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES ($1,$2,$3,$4,$5) RETURNING id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia]);
    intervalos_diametro.push(numerizarDiametro(rows[0]));
  }
  for (const i of data.intervalos_filtro ?? []) {
    const { rows } = await client.query(`INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES ($1,$2,$3,$4,$5) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia]);
    intervalos_filtro.push(numerizarFiltro(rows[0]));
  }
  for (const a of data.niveles_aporte) {
    const { rows } = await client.query(`INSERT INTO nivel_aporte (id_pozo,profundidad_m) VALUES ($1,$2) RETURNING id_nivel_aporte,id_pozo,profundidad_m`, [idPozo,a.profundidad_m]);
    niveles_aporte.push(numerizarAporte(rows[0]));
  }
  return { intervalos_litologicos, intervalos_diametro, intervalos_filtro, niveles_aporte };
}

async function insertarPozo(client: PoolClient, creadoPor: number, data: PozoCompletoBody): Promise<Pozo> {
  const p = data.pozo;
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
    [p.id_propietario, p.id_sitio, p.empresa ?? null, p.id_perforador, creadoPor, p.fecha_inicio ?? null,
      p.fecha_fin ?? null, p.profundidad_final_m ?? null, p.sello_sanitario ?? null, p.pre_filtro ?? null,
      p.nivel_estatico_m ?? null, p.nivel_dinamico_m ?? null, p.caudal_estimado_lh ?? null,
      p.metodo_sedimentario ?? null, p.metodo_rocoso ?? null, p.cementacion ?? null,
      p.desarrollo ?? null, p.revestimiento ?? null],
  );
  return { ...rows[0], id_pozo: Number(rows[0].id_pozo), profundidad_final_m: numeroOpcional(rows[0].profundidad_final_m) } as Pozo;
}

function decodificarFoto(foto: NonNullable<PozoCompletoBody["foto"]>) {
  return decodificarFotoBase64(foto.base64, foto.mime_type);
}

function numeroOpcional(valor: unknown): number | undefined { return valor == null ? undefined : Number(valor); }
function numerizarLitologia(fila: Record<string, unknown>) { return { id_intervalo_litologico: Number(fila.id_intervalo_litologico), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), material: String(fila.material) }; }
function numerizarDiametro(fila: Record<string, unknown>) { return { id_intervalo_diametro_perforacion: Number(fila.id_intervalo_diametro_perforacion), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: fila.material_tuberia == null ? null : String(fila.material_tuberia) as "PVC" | "Acero" }; }
function numerizarFiltro(fila: Record<string, unknown>) { return { id_intervalo_filtro: Number(fila.id_intervalo_filtro), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: String(fila.material_tuberia) as "PVC" | "Acero" }; }
function numerizarAporte(fila: Record<string, unknown>) { return { id_nivel_aporte: Number(fila.id_nivel_aporte), id_pozo: Number(fila.id_pozo), profundidad_m: Number(fila.profundidad_m) }; }
