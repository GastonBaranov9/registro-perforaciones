import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { myPool } from "../src/db/pool.ts";
import { crearPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { eliminarFotoPersistida } from "../src/services/foto-pozo-service.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../src/pdf/pdf-generate.ts";

const directorioFotos = path.resolve("public");
let idPozo: number | null = null;
try {
  const perforador = await idPorRol("perfor");
  const propietario = await idPorRol("propiet");
  const sitio = await myPool.query("SELECT id_sitio FROM sitio ORDER BY id_sitio LIMIT 1");
  if (!perforador || !propietario || !sitio.rows[0]) {
    console.log(JSON.stringify({ ejecutada: false, motivo: "faltan datos base no sensibles" }));
    process.exitCode = 2;
  } else {
    const resultado = await crearPozoCompleto(
      perforador,
      {
        pozo: { id_propietario: propietario, id_sitio: Number(sitio.rows[0].id_sitio), id_perforador: perforador, empresa: "AUDITORIA TEMPORAL RSP06B", profundidad_final_m: 60 },
        intervalos_litologicos: [{ desde_m: 0, hasta_m: 12, material: "Arena" }, { desde_m: 18, hasta_m: 60, material: "Roca" }],
        intervalos_diametro: [{ desde_m: 0, hasta_m: 30, diametro_pulg: 8 }, { desde_m: 30, hasta_m: 60, diametro_pulg: 6 }],
        niveles_aporte: [{ profundidad_m: 25 }],
        foto: { mime_type: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" },
      },
      directorioFotos,
    );
    idPozo = resultado.pozo.id_pozo;
    const conteos = await myPool.query(
      `SELECT
        (SELECT count(*) FROM intervalo_litologico WHERE id_pozo = $1)::int AS litologia,
        (SELECT count(*) FROM intervalo_diametro_perforacion WHERE id_pozo = $1)::int AS diametros,
        (SELECT count(*) FROM nivel_aporte WHERE id_pozo = $1)::int AS aportes`,
      [idPozo],
    );
    assert.deepEqual(conteos.rows[0], { litologia: 2, diametros: 2, aportes: 1 });
    const conFoto = await getReportePozo(idPozo);
    assert.ok(conFoto);
    assert.ok((await generarPDFBytes(conFoto, idPozo)).length > 1_000);

    const eliminacion = await eliminarFotoPersistida(idPozo, directorioFotos);
    assert.equal(eliminacion.archivoExistia, true);
    const sinFoto = await getReportePozo(idPozo);
    assert.ok(sinFoto && sinFoto.foto_url === null);
    assert.ok((await generarPDFBytes(sinFoto, idPozo)).length > 1_000);

    const antes = await myPool.query("SELECT count(*)::int AS cantidad FROM pozo WHERE empresa = $1", ["AUDITORIA INVALIDA RSP06B"]);
    await assert.rejects(() => crearPozoCompleto(perforador, {
      pozo: { id_propietario: propietario, id_sitio: Number(sitio.rows[0].id_sitio), id_perforador: perforador, empresa: "AUDITORIA INVALIDA RSP06B", profundidad_final_m: 10 },
      intervalos_litologicos: [{ desde_m: 0, hasta_m: 11, material: "Inválido" }], intervalos_diametro: [], niveles_aporte: [],
    }, directorioFotos));
    const despues = await myPool.query("SELECT count(*)::int AS cantidad FROM pozo WHERE empresa = $1", ["AUDITORIA INVALIDA RSP06B"]);
    assert.equal(despues.rows[0].cantidad, antes.rows[0].cantidad);
    console.log(JSON.stringify({ ejecutada: true, relaciones: true, pdfConFoto: true, pdfSinFoto: true, rollback: true }));
  }
} finally {
  if (idPozo) {
    await myPool.query("DELETE FROM pozo WHERE id_pozo = $1", [idPozo]);
    const archivos = await fs.readdir(directorioFotos).catch(() => []);
    for (const archivo of archivos.filter((nombre) => nombre.startsWith(`pozo-${idPozo}.`)))
      await fs.rm(path.join(directorioFotos, archivo), { force: true });
  }
  await myPool.end();
}

async function idPorRol(fragmento: string): Promise<number | null> {
  const { rows } = await myPool.query(
    `SELECT u.id_usuario FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.activo = true AND lower(r.nombre) LIKE $1
     ORDER BY u.id_usuario LIMIT 1`,
    [`%${fragmento}%`],
  );
  return rows[0] ? Number(rows[0].id_usuario) : null;
}
