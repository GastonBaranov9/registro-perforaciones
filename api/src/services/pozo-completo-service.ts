import { guardarPrefiltro, validarPrefiltro } from './prefiltro-service.ts';
import { errorMaterialDiametro, hayFiltroSinTuberia } from "./compatibilidad-entubamiento.ts";
import { normalizarLitologiaProvisional, provisionalParaIntervaloNuevo, exigirVinculacionDesdePendientes, exigirTextoLitologico, exigirLitologiaNoConstructiva } from './litologia-provisional.ts';
import { guardarSelloSanitario, validarSelloSanitario } from './sello-sanitario-service.ts';
import { iniciarEscrituraSesion } from "./escritura-sesion.ts";
import { exigirEpoca } from './epoca-datos-service.ts';
import { normalizarPropiedad, validarPropiedad } from "./propietario-pozo-service.ts";
import { traducirErrorNumeracion } from "./numeracion-perforacion-service.ts";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { PerfilLitologicoVistaPreviaBody, Pozo, PozoCompletoBody, PozoCompletoUpdateBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { validarPersonaPozo } from "./candidatos-pozo-service.ts";
import { aislarFotosExistentes, compensarFalloTransaccionalFotos, decodificarFotoBase64, purgarFotosConfirmadas, restaurarFotosAisladas, rutaContenida, type FotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";
import { normalizarCoordenadasTexto } from "../utils/coordenadas.ts";
import { DATOS_TECNICOS_ESTANDAR, datosTecnicosParaCreacion } from "../constants/datos-tecnicos-estandar.ts";

export interface PozoCompletoResultado {
  prefiltro_constructivo: import('../models/schemas.ts').IntervaloPrefiltro[];
  sello_sanitario_constructivo: import('../models/schemas.ts').SelloSanitarioConstructivo | null;
  pozo: Pozo;
  sitio: import("../models/schemas.ts").Sitio;
  intervalos_litologicos: Array<{ id_intervalo_litologico: number; id_pozo: number; desde_m: number; hasta_m: number; material: string; id_litologia:number|null; litologia_provisional?:string|null }>;
  intervalos_diametro: Array<{ id_intervalo_diametro_perforacion: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero" | null; sin_tuberia?: boolean }>;
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
  litologia_provisional?: string | null;
};
type FiltroOriginal = { id_intervalo_filtro: number; ranura_mm: 0.5 | 0.75 | 1 | null };
type FiltroEntrada = { desde_m: number; hasta_m: number; diametro_pulg: number; material_tuberia: "PVC" | "Acero"; id_intervalo_filtro?: number; ranura_mm?: 0.5 | 0.75 | 1 | null };

export function validarPozoCompleto(data: DatosCompletosPozo): string[] {
  normalizarPropiedad(data.pozo);
  const errores = validarDatosTecnicosPozo({
    profundidad_final_m: data.pozo.profundidad_final_m,
    prefiltro_constructivo: data.prefiltro_constructivo,
    intervalos_litologicos: data.intervalos_litologicos,
    intervalos_diametro: data.intervalos_diametro,
    intervalos_filtro: data.intervalos_filtro,
    niveles_aporte: data.niveles_aporte,
  });
  try { validarSelloSanitario(data.sello_sanitario_constructivo, data.pozo.profundidad_final_m); }
  catch (error) { errores.push((error as Error).message); }
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

export function validarDatosTecnicosPozo(data: Omit<PerfilLitologicoVistaPreviaBody, 'profundidad_final_m'> & { profundidad_final_m?: number }): string[] {
  const errores: string[] = [];
  for (const i of data.intervalos_litologicos) {
    try { exigirTextoLitologico(i.material); normalizarLitologiaProvisional(i); } catch (e) { errores.push((e as Error).message); }
  }
  const profundidad = data.profundidad_final_m;
  try { validarPrefiltro(data.prefiltro_constructivo, profundidad); }
  catch (error) { errores.push((error as Error).message); }
  validarIntervalos(data.intervalos_litologicos, "litológico", profundidad, errores);
  validarIntervalos(data.intervalos_diametro, "de diámetro", profundidad, errores);
  validarIntervalos(data.intervalos_filtro ?? [], "de filtro", profundidad, errores);
  data.intervalos_diametro.forEach((i, n) => { const error = errorMaterialDiametro(i); if (error) errores.push(`Intervalo de diámetro ${n + 1}: ${error}`); });
  if (hayFiltroSinTuberia(data.intervalos_diametro, data.intervalos_filtro ?? []))
    errores.push("Un filtro no puede solaparse con una perforación sin cañería.");
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
  claveOffline?: string,
  epoca?: unknown,
): Promise<PozoCompletoResultado> {
  const errores = validarPozoCompleto(data);
  if (errores.length) throw new err.T05DatosIncorrectos(errores.join(" "));

  const client = await pool.connect();
  let descartar = false;
  let archivoFinal: string | null = null;
  let archivoTemporal: string | null = null;
  let commitIntentado = false;
  try {
    await iniciarEscrituraSesion(client, false);
    if (claveOffline !== undefined) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claveOffline))
        throw new err.T05DatosIncorrectos("Identificador local inválido.");
      if (data.pozo.numero_perforacion != null) throw new err.T05SinPermiso("Un borrador local no puede asignar numeración.");
      // Sesión bloqueada antes de consultar incluso un resultado ya confirmado.
      await validarPersonaPozo(creadoPor, "perforador", client);
      await exigirEpoca(client, epoca);
      if (data.pozo.id_perforador !== creadoPor || data.pozo.id_propietario !== null) throw new err.T05SinPermiso();
      claveOffline = claveOffline.toLowerCase();
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 714))", [`${creadoPor}:${claveOffline}`]);
      const previo = await client.query("SELECT epoca,huella,resultado FROM creacion_offline WHERE actor=$1 AND clave=$2", [creadoPor, claveOffline]);
      if (previo.rows[0]) {
        if (previo.rows[0].epoca !== String(epoca).toLowerCase()) throw new err.T05EpocaRetirada();
        if (previo.rows[0].huella !== huellaOffline(data)) throw new err.T05DatosIncorrectos("Conflicto: este identificador local ya fue enviado con otros datos. Conserve el borrador y consulte Administración.");
        await client.query("COMMIT");
        return previo.rows[0].resultado;
      }
      const cerrada = await client.query('SELECT 1 FROM clave_offline_cerrada WHERE actor=$1 AND clave=$2', [creadoPor, claveOffline]);
      if (cerrada.rows.length) throw new err.T05ClaveOfflineCerrada();
    }
    if (data.pozo.numero_perforacion != null) {
      throw new err.T05DatosIncorrectos('Use Carga histórica para un número explícito. El alta normal siempre es automática.');
    }
    await validarPropiedad(data.pozo, client);
    await validarPersonaPozo(data.pozo.id_perforador, "perforador", client);
    const sitio = await insertarSitio(client, data.sitio_nuevo);
    const pozo = await insertarPozo(client, creadoPor, data, sitio.id_sitio);
    const idPozo = pozo.id_pozo;
    const sello = await guardarSelloSanitario(client, idPozo, data.sello_sanitario_constructivo ?? null, pozo.profundidad_final_m);
    const prefiltro = await guardarPrefiltro(client, idPozo, data.prefiltro_constructivo ?? null, pozo.profundidad_final_m);
    const litologia = [] as PozoCompletoResultado["intervalos_litologicos"];
    const diametros = [] as PozoCompletoResultado["intervalos_diametro"];
    const aportes = [] as PozoCompletoResultado["niveles_aporte"];
    const filtros = [] as PozoCompletoResultado["intervalos_filtro"];

    for (const intervalo of data.intervalos_litologicos) {
      litologia.push(await insertarIntervaloLitologico(client, idPozo, intervalo));
    }
    for (const intervalo of data.intervalos_diametro) {
      const { rows } = await client.query(
        `INSERT INTO intervalo_diametro_perforacion (id_pozo, desde_m, hasta_m, diametro_pulg, material_tuberia, sin_tuberia)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_intervalo_diametro_perforacion, id_pozo, desde_m, hasta_m, diametro_pulg, material_tuberia, sin_tuberia`,
        [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.diametro_pulg, intervalo.material_tuberia, intervalo.sin_tuberia === true],
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
      archivoFinal = rutaContenida(directorioFotos, `pozo-${idPozo}.${foto.extension}`);
      archivoTemporal = rutaContenida(directorioFotos, path.join(".trash", `.staging-${idPozo}-${randomUUID()}`));
      await fs.mkdir(path.dirname(archivoTemporal), { recursive: true });
      await fs.writeFile(archivoTemporal, foto.buffer, { flag: "wx" });
      await fs.rename(archivoTemporal, archivoFinal);
      archivoTemporal = null;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, `/usuarios/${data.pozo.id_propietario ?? data.pozo.id_perforador}/pozos/${idPozo}/foto`]);
      pozo.foto_url = `/usuarios/${data.pozo.id_propietario ?? data.pozo.id_perforador}/pozos/${idPozo}/foto`;
    }

    const resultado = { pozo, sitio, sello_sanitario_constructivo: sello, prefiltro_constructivo: prefiltro, intervalos_litologicos: litologia, intervalos_diametro: diametros, intervalos_filtro: filtros, niveles_aporte: aportes };
    if (claveOffline) await client.query("INSERT INTO creacion_offline(actor,clave,huella,resultado,epoca) VALUES($1,$2,$3,$4,$5)", [creadoPor, claveOffline, huellaOffline(data), JSON.stringify(resultado), epoca]);
    commitIntentado = true;
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    const compensacion = await compensarFalloTransaccionalFotos({
      idPozo: 0, operacion: "crear_pozo_completo",
      rollback: async () => { await client.query("ROLLBACK"); },
      restaurar: async () => {
        // Una respuesta COMMIT perdida no prueba rollback: conservar el archivo.
        // El reconciliador existente puede auditar huérfanos; nunca borrar una foto confirmada.
        if (commitIntentado) return;
        const limpieza = await Promise.allSettled([archivoTemporal, archivoFinal]
          .filter((ruta): ruta is string => ruta !== null).map(ruta => fs.rm(ruta, { force: true })));
        if (limpieza.some(resultado => resultado.status === "rejected")) throw new Error("Limpieza de fotografías incompleta");
      },
    });
    descartar = Boolean(compensacion.errorRollback);
    if (compensacion.errorFilesystem) throw new err.T05ErrorDesconocido("Falló la creación y no se pudo limpiar la fotografía.", { cause: error });
    throw traducirErrorNumeracion(error);
  } finally {
    client.release(descartar);
  }
}

export function huellaOffline(data: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(data))).digest("hex");
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
  let descartar = false;
  let fotosAisladas: FotoAislada[] = [];
  let nuevo: string | null = null;
  let temporalNuevo: string | null = null;
  let resultado: PozoCompletoResultado;
  try {
    await iniciarEscrituraSesion(client, false);
    await client.query("SELECT pg_advisory_xact_lock($1::integer, 606)", [idPozo]);
    const { rows: bloqueado } = await client.query<{ id_pozo:number; id_sitio:number; id_propietario: number | null; numero_perforacion: number | null; origen:string }>(
      "SELECT id_pozo,id_sitio,id_propietario,numero_perforacion,origen FROM pozo WHERE id_pozo = $1 FOR UPDATE", [idPozo]);
    if (!bloqueado[0]) throw new err.T05PozoNoEncontrado();
    if(bloqueado[0].origen==='historico')throw new err.T05DatosIncorrectos('Use la edición histórica para esta perforación.');
    if (Object.hasOwn(data.pozo, "numero_perforacion") && data.pozo.numero_perforacion !== bloqueado[0].numero_perforacion)
      throw new err.T05DatosIncorrectos("La numeración se administra por separado; no se puede cambiar desde la edición habitual.");
    const provisional = await validarPropiedad(data.pozo, client);
    await validarPersonaPozo(data.pozo.id_perforador, "perforador", client);

    if ((bloqueado[0].id_propietario == null ? null : Number(bloqueado[0].id_propietario)) !== data.pozo.id_propietario)
      throw new err.T05DatosIncorrectos("La vinculación del propietario requiere la operación administrativa específica. Recargue si cambió.");

    const sello = await guardarSelloSanitario(client, idPozo, data.sello_sanitario_constructivo, data.pozo.profundidad_final_m);
    const prefiltro = await guardarPrefiltro(client, idPozo, data.prefiltro_constructivo, data.pozo.profundidad_final_m);
    const hijos = await reemplazarHijosPozo(client, idPozo, data);
    const p = data.pozo;
    const { rows } = await client.query(
      `UPDATE pozo SET id_propietario=$2, id_sitio=$3, empresa=$4, id_perforador=$5,
       fecha_inicio=$6, fecha_fin=$7, profundidad_final_m=$8,
       nivel_estatico_m=$9, nivel_dinamico_m=$10, caudal_estimado_lh=$11,
       metodo_sedimentario=COALESCE($12::text,metodo_sedimentario), metodo_rocoso=COALESCE($13::text,metodo_rocoso),
       cementacion=COALESCE($14::text,cementacion), desarrollo=COALESCE($15::text,desarrollo), revestimiento=$16, propietario_provisional=$17
       WHERE id_pozo=$1
       RETURNING id_pozo, numero_perforacion, propietario_provisional, id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio,
        fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
        caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento,
        foto_url, fecha_creado`,
      [idPozo,p.id_propietario,Number(bloqueado[0].id_sitio),p.empresa??null,p.id_perforador,p.fecha_inicio??null,p.fecha_fin??null,
       p.profundidad_final_m??null,p.nivel_estatico_m??null,p.nivel_dinamico_m??null,p.caudal_estimado_lh??null,
       p.metodo_sedimentario??null,p.metodo_rocoso??null,p.cementacion??null,p.desarrollo??null,p.revestimiento??null,provisional],
    );
    const pozo = numerizarPozo({ ...rows[0], id_pozo: idPozo });

    if (data.foto_accion !== "conservar") {
      await fs.mkdir(directorioFotos, { recursive: true });
      fotosAisladas = await aislarFotosExistentes(idPozo, directorioFotos);
      if (data.foto_accion === "reemplazar" && data.foto) {
        const foto = decodificarFoto(data.foto);
        nuevo = rutaContenida(directorioFotos, `pozo-${idPozo}.${foto.extension}`);
        temporalNuevo = rutaContenida(directorioFotos, path.join(".trash", `.staging-${idPozo}-${randomUUID()}`));
        await fs.writeFile(temporalNuevo, foto.buffer, { flag: "wx" });
        await fs.rename(temporalNuevo, nuevo);
        temporalNuevo = null;
        pozo.foto_url = `/usuarios/${p.id_propietario ?? p.id_perforador}/pozos/${idPozo}/foto`;
      } else pozo.foto_url = undefined;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, pozo.foto_url ?? null]);
    } else if (pozo.foto_url) {
      pozo.foto_url = `/usuarios/${p.id_propietario ?? p.id_perforador}/pozos/${idPozo}/foto`;
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, pozo.foto_url]);
    }
    const sitio = await obtenerSitioTransaccional(client, Number(bloqueado[0].id_sitio));
    await client.query("COMMIT");
    resultado = { pozo, sitio, sello_sanitario_constructivo: sello, prefiltro_constructivo: prefiltro, ...hijos };
  } catch (error) {
    const compensacion = await compensarFalloTransaccionalFotos({
      idPozo,
      operacion: "actualizar_pozo_completo",
      logger: opciones.logger,
      rollback: async () => { await client.query("ROLLBACK"); },
      restaurar: async () => {
        const errores: unknown[] = [];
        for (const ruta of [temporalNuevo, nuevo]) {
          if (ruta) try { await fs.rm(ruta, { force: true }); } catch (fallo) { errores.push(fallo); }
        }
        if (fotosAisladas.length) {
          try { await restaurarFotosAisladas(fotosAisladas); } catch (fallo) { errores.push(fallo); }
        }
        if (errores.length) throw new Error("Compensación de archivos incompleta");
      },
    });
    descartar = Boolean(compensacion.errorRollback);
    if (compensacion.errorFilesystem)
      throw new err.T05ErrorDesconocido("Falló la actualización y no se pudo restaurar la fotografía anterior.", { cause: error });
    throw error;
  } finally { client.release(descartar); }
  await purgarFotosConfirmadas(fotosAisladas, idPozo, "actualizar_pozo_completo", opciones.logger, opciones.eliminarPostCommit);
  return resultado;
}


export async function reemplazarHijosPozo(client: PoolClient, idPozo: number, data: Pick<PozoCompletoUpdateBody, "intervalos_litologicos"|"intervalos_diametro"|"intervalos_filtro"|"niveles_aporte">) {
    const { rows: litologiasOriginales } = await client.query<IntervaloOriginal>(
      "SELECT id_intervalo_litologico,desde_m,hasta_m,material,id_litologia,litologia_provisional FROM intervalo_litologico WHERE id_pozo = $1 FOR UPDATE", [idPozo]);
    const originales = litologiasOriginales.map((fila) => ({
      id_intervalo_litologico: Number(fila.id_intervalo_litologico),
      desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), material: String(fila.material),
      id_litologia: fila.id_litologia == null ? null : Number(fila.id_litologia),
      litologia_provisional: fila.litologia_provisional,
    }));
    const resoluciones = resolverLitologiasOriginales(data.intervalos_litologicos, originales);
    for (const intervalo of data.intervalos_litologicos) {
      const previo = originales.find(x => x.id_intervalo_litologico === intervalo.id_intervalo_litologico);
      exigirVinculacionDesdePendientes(previo?.litologia_provisional, intervalo.id_litologia);
      // Omitir el ID no permite disfrazar una sustitución como un alta.
      if (intervalo.id_litologia != null && intervalo.id_intervalo_litologico == null) {
        const retirado = originales.find(x => x.litologia_provisional != null && !data.intervalos_litologicos.some(i =>
          i.id_intervalo_litologico === x.id_intervalo_litologico || (i.id_litologia == null && i.desde_m === x.desde_m && i.hasta_m === x.hasta_m && i.material === x.material)));
        exigirVinculacionDesdePendientes(retirado?.litologia_provisional, intervalo.id_litologia);
      }
    }
    const idsFiltros = data.intervalos_filtro.flatMap((filtro) => filtro.id_intervalo_filtro == null ? [] : [filtro.id_intervalo_filtro]);
    if (new Set(idsFiltros).size !== idsFiltros.length) throw new err.T05DatosIncorrectos("No se puede repetir un filtro persistido.");
    let ranurasFiltros = new Map<number, 0.5 | 0.75 | 1 | null>();
    if (idsFiltros.length) {
      const { rows: filtrosOriginales } = await client.query<{id_intervalo_filtro:number;ranura_mm:number|null}>(
        "SELECT id_intervalo_filtro,ranura_mm FROM intervalo_filtro WHERE id_pozo=$1 AND id_intervalo_filtro=ANY($2::bigint[]) FOR UPDATE",
        [idPozo, idsFiltros],
      );
      if (filtrosOriginales.length !== idsFiltros.length) throw new err.T05DatosIncorrectos("Un filtro histórico no pertenece al pozo editado.");
      ranurasFiltros = resolverRanurasFiltros(data.intervalos_filtro, filtrosOriginales.map((filtro) => ({ id_intervalo_filtro: Number(filtro.id_intervalo_filtro), ranura_mm: filtro.ranura_mm == null ? null : Number(filtro.ranura_mm) as 0.5 | 0.75 | 1 })));
    }

    await client.query("DELETE FROM intervalo_litologico WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_diametro_perforacion WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM intervalo_filtro WHERE id_pozo = $1", [idPozo]);
    await client.query("DELETE FROM nivel_aporte WHERE id_pozo = $1", [idPozo]);
    const hijos = await insertarHijos(client, idPozo, data, originales, resoluciones, ranurasFiltros);
    return hijos;
}

export async function insertarHijos(client: PoolClient, idPozo: number, data: Pick<DatosCompletosPozo, 'intervalos_litologicos' | 'intervalos_diametro' | 'intervalos_filtro' | 'niveles_aporte'>, originales?: IntervaloOriginal[], resoluciones?: Map<number, number | null | undefined>, ranurasFiltros?: Map<number, 0.5 | 0.75 | 1 | null>) {
  const intervalos_litologicos: PozoCompletoResultado["intervalos_litologicos"] = [];
  const intervalos_diametro: PozoCompletoResultado["intervalos_diametro"] = [];
  const niveles_aporte: PozoCompletoResultado["niveles_aporte"] = [];
  const intervalos_filtro: PozoCompletoResultado["intervalos_filtro"] = [];
  for (const i of data.intervalos_litologicos) {
    const originalId = resoluciones?.get(intervalos_litologicos.length);
    const previo = originales?.find(x => i.id_intervalo_litologico != null
      ? x.id_intervalo_litologico === i.id_intervalo_litologico
      : i.id_litologia == null && x.desde_m === i.desde_m && x.hasta_m === i.hasta_m && normalizarMaterial(x.material) === normalizarMaterial(i.material));
    const dato = i.id_litologia == null && i.litologia_provisional == null && previo?.litologia_provisional
      ? {...i,litologia_provisional:previo.litologia_provisional} : i;
    intervalos_litologicos.push(await insertarIntervaloLitologico(client, idPozo, dato, originalId));
  }
  for (const i of data.intervalos_diametro) {
    const { rows } = await client.query(`INSERT INTO intervalo_diametro_perforacion (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,sin_tuberia) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,sin_tuberia`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia,i.sin_tuberia === true]);
    intervalos_diametro.push(numerizarDiametro(rows[0]));
  }
  for (const i of data.intervalos_filtro ?? []) {
    const idFiltro = "id_intervalo_filtro" in i ? i.id_intervalo_filtro : undefined;
    const ranura = idFiltro == null ? i.ranura_mm : ranurasFiltros?.get(idFiltro) ?? i.ranura_mm;
    const { rows } = await client.query(`INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm`, [idPozo,i.desde_m,i.hasta_m,i.diametro_pulg,i.material_tuberia,ranura ?? null]);
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
        if (!original) throw new err.T05DatosIncorrectos("Un id_intervalo_litologico no pertenece al pozo editado.");
        if (consumidos.has(original.id_intervalo_litologico)) throw new err.T05DatosIncorrectos("Un intervalo litologico original no puede reutilizarse en el mismo update.");
        resoluciones.set(indice, original.id_litologia);
        consumidos.add(original.id_intervalo_litologico);
      } else {
        resoluciones.set(indice, undefined);
      }
      continue;
    }
    if (intervalo.id_intervalo_litologico != null) {
      const original = originales.find((fila) => fila.id_intervalo_litologico === intervalo.id_intervalo_litologico);
      if (!original) throw new err.T05DatosIncorrectos("Un id_intervalo_litologico no pertenece al pozo editado.");
      if (consumidos.has(original.id_intervalo_litologico)) throw new err.T05DatosIncorrectos("Un intervalo litologico original no puede reutilizarse en el mismo update.");
      resoluciones.set(indice, original.id_litologia);
      consumidos.add(original.id_intervalo_litologico);
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

export function resolverRanurasFiltros(
  filtros: readonly FiltroEntrada[],
  originales: readonly FiltroOriginal[],
): Map<number, 0.5 | 0.75 | 1 | null> {
  const resultado = new Map<number, 0.5 | 0.75 | 1 | null>();
  for (const filtro of filtros) {
    if (filtro.id_intervalo_filtro == null) continue;
    const original = originales.find((fila) => fila.id_intervalo_filtro === filtro.id_intervalo_filtro);
    if (!original) throw new err.T05DatosIncorrectos("Un filtro persistido no pertenece al pozo editado.");
    const presente = Object.prototype.hasOwnProperty.call(filtro, "ranura_mm");
    if (!presente) { resultado.set(filtro.id_intervalo_filtro, original.ranura_mm); continue; }
    if (filtro.ranura_mm == null) {
      if (original.ranura_mm != null) throw new err.T05DatosIncorrectos("No se puede eliminar una ranura ya especificada.");
      resultado.set(filtro.id_intervalo_filtro, null);
      continue;
    }
    if (![0.5, 0.75, 1].includes(filtro.ranura_mm)) throw new err.T05DatosIncorrectos("Ranura invÃ¡lida.");
    resultado.set(filtro.id_intervalo_filtro, filtro.ranura_mm);
  }
  return resultado;
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
  const provisional = originalId === undefined ? provisionalParaIntervaloNuevo(intervalo) : normalizarLitologiaProvisional(intervalo);
  const idEnviado = provisional ? null : intervalo.id_litologia ?? (originalId == null ? null : originalId);
  exigirTextoLitologico(intervalo.material);
  await exigirLitologiaNoConstructiva(client, idEnviado);
  const esCreacion = originalId === undefined && !provisional;
  const { rows } = await client.query(
    `WITH elegida AS (SELECT id_litologia,nombre FROM catalogo_litologia c
       WHERE (($5::bigint IS NOT NULL AND c.id_litologia=$5
         AND (c.activo OR ($6::bigint IS NOT NULL AND c.id_litologia=$6)))
       OR ($5::bigint IS NULL AND $7::boolean AND c.activo AND c.nombre_normalizado=litologia_normalizar($4)))
       FOR SHARE)
     INSERT INTO intervalo_litologico (id_pozo,desde_m,hasta_m,material,id_litologia,litologia_provisional)
     SELECT $1,$2,$3,COALESCE(c.nombre,$8,$4),c.id_litologia,$8
     FROM (SELECT 1) base LEFT JOIN elegida c ON TRUE
     WHERE $5::bigint IS NULL OR c.id_litologia IS NOT NULL
     RETURNING id_intervalo_litologico,id_pozo,desde_m,hasta_m,material,id_litologia,litologia_provisional`,
    [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.material, idEnviado, originalId ?? null, esCreacion, provisional],
  );
  const fila = rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new err.T05DatosIncorrectos("La litología indicada no existe o no está activa.");
  return numerizarLitologia(fila);
}

async function insertarSitio(client: PoolClient, sitio: PozoCompletoBody["sitio_nuevo"]): Promise<import("../models/schemas.ts").Sitio> {
  const coordenadas = normalizarCoordenadasTexto(sitio.latitud, sitio.longitud, true);
  if (!coordenadas) throw new err.T05DatosIncorrectos("Las coordenadas del sitio son invÃ¡lidas.");
  const { rows } = await client.query(
    `INSERT INTO public.sitio (departamento,localidad,latitud,longitud,padron)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id_sitio,departamento,localidad,latitud,longitud,padron`,
    [sitio.departamento.trim(), sitio.localidad?.trim() || null, coordenadas.latitud, coordenadas.longitud, sitio.padron?.trim() || null],
  );
  return { ...rows[0], id_sitio: Number(rows[0].id_sitio) };
}

async function obtenerSitioTransaccional(client: PoolClient, idSitio: number): Promise<import("../models/schemas.ts").Sitio> {
  const { rows } = await client.query(
    "SELECT id_sitio,departamento,localidad,latitud,longitud,padron FROM public.sitio WHERE id_sitio=$1",
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
      profundidad_final_m, nivel_estatico_m, nivel_dinamico_m,
      caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento, numero_perforacion, propietario_provisional
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id_pozo, numero_perforacion, propietario_provisional, id_propietario, id_sitio, empresa, id_perforador, creado_por, fecha_inicio,
      fecha_fin, profundidad_final_m, sello_sanitario, pre_filtro, nivel_estatico_m, nivel_dinamico_m,
      caudal_estimado_lh, metodo_sedimentario, metodo_rocoso, cementacion, desarrollo, revestimiento,
      foto_url, fecha_creado`,
    [p.id_propietario, idSitio, p.empresa ?? null, p.id_perforador, creadoPor, p.fecha_inicio ?? null,
      p.fecha_fin ?? null, p.profundidad_final_m ?? null, p.nivel_estatico_m ?? null,
      p.nivel_dinamico_m ?? null, p.caudal_estimado_lh ?? null,
      estandar.metodo_sedimentario, estandar.metodo_rocoso, estandar.cementacion,
      estandar.desarrollo, p.revestimiento ?? null, p.numero_perforacion ?? null, normalizarPropiedad(p)],
  );
  return numerizarPozo(rows[0]);
}

function decodificarFoto(foto: NonNullable<PozoCompletoBody["foto"]>) {
  return decodificarFotoBase64(foto.base64, foto.mime_type);
}

function numeroOpcional(valor: unknown): number | undefined { return valor == null ? undefined : Number(valor); }
function numerizarPozo(fila: Record<string,unknown>):Pozo{return{
  ...fila,
  id_pozo:Number(fila.id_pozo),id_propietario:fila.id_propietario == null ? null : Number(fila.id_propietario),id_sitio:Number(fila.id_sitio),id_perforador:Number(fila.id_perforador),
  creado_por:fila.creado_por==null?undefined:Number(fila.creado_por),
  profundidad_final_m:numeroOpcional(fila.profundidad_final_m),nivel_estatico_m:numeroOpcional(fila.nivel_estatico_m),
  nivel_dinamico_m:numeroOpcional(fila.nivel_dinamico_m),caudal_estimado_lh:numeroOpcional(fila.caudal_estimado_lh),
} as Pozo;}
function numerizarLitologia(fila: Record<string, unknown>) { return { id_intervalo_litologico: Number(fila.id_intervalo_litologico), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), material: String(fila.material),litologia_provisional:fila.litologia_provisional == null ? null : String(fila.litologia_provisional),id_litologia:fila.id_litologia==null?null:Number(fila.id_litologia) }; }
function numerizarDiametro(fila: Record<string, unknown>) { return { id_intervalo_diametro_perforacion: Number(fila.id_intervalo_diametro_perforacion), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: fila.material_tuberia == null ? null : String(fila.material_tuberia) as "PVC" | "Acero", sin_tuberia: fila.sin_tuberia === true }; }
function numerizarFiltro(fila: Record<string, unknown>) { return { id_intervalo_filtro: Number(fila.id_intervalo_filtro), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg), material_tuberia: String(fila.material_tuberia) as "PVC" | "Acero", ranura_mm: fila.ranura_mm == null ? null : Number(fila.ranura_mm) as 0.5 | 0.75 | 1 }; }
function numerizarAporte(fila: Record<string, unknown>) { return { id_nivel_aporte: Number(fila.id_nivel_aporte), id_pozo: Number(fila.id_pozo), profundidad_m: Number(fila.profundidad_m) }; }
