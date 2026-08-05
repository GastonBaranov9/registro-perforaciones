import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { Pozo, PozoCompletoBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";

export interface PozoCompletoResultado {
  pozo: Pozo;
  intervalos_litologicos: Array<{ id_intervalo_litologico: number; id_pozo: number; desde_m: number; hasta_m: number; material: string }>;
  intervalos_diametro: Array<{ id_intervalo_diametro_perforacion: number; id_pozo: number; desde_m: number; hasta_m: number; diametro_pulg: number }>;
  niveles_aporte: Array<{ id_nivel_aporte: number; id_pozo: number; profundidad_m: number }>;
}

type Intervalo = { desde_m: number; hasta_m: number };

export function validarPozoCompleto(data: PozoCompletoBody): string[] {
  const errores: string[] = [];
  const profundidad = data.pozo.profundidad_final_m;
  validarIntervalos(data.intervalos_litologicos, "litológico", profundidad, errores);
  validarIntervalos(data.intervalos_diametro, "de diámetro", profundidad, errores);
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
  try {
    await client.query("BEGIN");
    const pozo = await insertarPozo(client, creadoPor, data);
    const idPozo = pozo.id_pozo;
    const litologia = [] as PozoCompletoResultado["intervalos_litologicos"];
    const diametros = [] as PozoCompletoResultado["intervalos_diametro"];
    const aportes = [] as PozoCompletoResultado["niveles_aporte"];

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
        `INSERT INTO intervalo_diametro_perforacion (id_pozo, desde_m, hasta_m, diametro_pulg)
         VALUES ($1, $2, $3, $4)
         RETURNING id_intervalo_diametro_perforacion, id_pozo, desde_m, hasta_m, diametro_pulg`,
        [idPozo, intervalo.desde_m, intervalo.hasta_m, intervalo.diametro_pulg],
      );
      diametros.push(numerizarDiametro(rows[0]));
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
      const temporal = path.join(directorioFotos, `.pozo-${idPozo}-${randomUUID()}.tmp`);
      await fs.writeFile(temporal, foto.buffer, { flag: "wx" });
      await fs.rename(temporal, archivoFinal);
      await client.query("UPDATE pozo SET foto_url = $2 WHERE id_pozo = $1", [idPozo, `/usuarios/${data.pozo.id_propietario}/pozos/${idPozo}/foto`]);
      pozo.foto_url = `/usuarios/${data.pozo.id_propietario}/pozos/${idPozo}/foto`;
    }

    await client.query("COMMIT");
    return { pozo, intervalos_litologicos: litologia, intervalos_diametro: diametros, niveles_aporte: aportes };
  } catch (error) {
    await client.query("ROLLBACK");
    if (archivoFinal) await fs.rm(archivoFinal, { force: true });
    throw error;
  } finally {
    client.release();
  }
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
  const buffer = Buffer.from(foto.base64, "base64");
  if (buffer.length === 0 || buffer.length > 5_000_000) throw new err.T05DatosIncorrectos("La fotografía debe pesar entre 1 byte y 5 MB.");
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if ((foto.mime_type === "image/jpeg" && !jpeg) || (foto.mime_type === "image/png" && !png))
    throw new err.T05DatosIncorrectos("El contenido de la fotografía no coincide con su tipo.");
  return { buffer, extension: foto.mime_type === "image/png" ? "png" : "jpg" };
}

function numeroOpcional(valor: unknown): number | undefined { return valor == null ? undefined : Number(valor); }
function numerizarLitologia(fila: Record<string, unknown>) { return { id_intervalo_litologico: Number(fila.id_intervalo_litologico), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), material: String(fila.material) }; }
function numerizarDiametro(fila: Record<string, unknown>) { return { id_intervalo_diametro_perforacion: Number(fila.id_intervalo_diametro_perforacion), id_pozo: Number(fila.id_pozo), desde_m: Number(fila.desde_m), hasta_m: Number(fila.hasta_m), diametro_pulg: Number(fila.diametro_pulg) }; }
function numerizarAporte(fila: Record<string, unknown>) { return { id_nivel_aporte: Number(fila.id_nivel_aporte), id_pozo: Number(fila.id_pozo), profundidad_m: Number(fila.profundidad_m) }; }
