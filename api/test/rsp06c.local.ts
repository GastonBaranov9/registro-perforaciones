import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";
import { listarCandidatosPozo, validarPersonaPozo } from "../src/services/candidatos-pozo-service.ts";
import { actualizarPozoCompleto, crearPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../src/pdf/pdf-generate.ts";
import { createIntervaloLitologico } from "../src/services/intervalos-litologicos-services.ts";
import Fastify from "fastify";
import rutasLitologicas from "../src/routes/intervalos-litologicos.ts";

const fotos = path.resolve("public");
const idsUsuarios: number[] = [];
let idPozo: number | null = null;
const avisosPurga: Array<Record<string,unknown>> = [];
const purgaFallida = { logger:{warn(datos:Record<string,unknown>){avisosPurga.push(datos);}}, eliminarPostCommit:async()=>{throw Object.assign(new Error("purga controlada"),{code:"EACCES"});} };
try {
  const roles = await myPool.query(`SELECT id_rol, nombre FROM rol WHERE nombre = ANY($1::text[]) ORDER BY nombre`, [["propietario", "perforador"]]);
  const idProp = Number(roles.rows.find((x) => x.nombre === "propietario")?.id_rol);
  const idPerf = Number(roles.rows.find((x) => x.nombre === "perforador")?.id_rol);
  const sitio = await myPool.query(`SELECT id_sitio FROM sitio ORDER BY id_sitio LIMIT 1`);
  if (!idProp || !idPerf || !sitio.rows[0]) throw new Error("Faltan roles o sitio base para la prueba controlada.");
  for (const [indice, rol] of [idProp, idProp, idPerf, idPerf].entries()) {
    const marca = randomUUID();
    const { rows } = await myPool.query(
      `INSERT INTO usuario (email,nombre,password,activo) VALUES ($1,$2,$3,true) RETURNING id_usuario`,
      [`rsp06c-${marca}@example.invalid`, `Temporal RSP06C ${indice + 1}`, "hash-temporal-no-utilizable"],
    );
    const id = Number(rows[0].id_usuario); idsUsuarios.push(id);
    await myPool.query(`INSERT INTO usuario_rol (id_usuario,id_rol) VALUES ($1,$2)`, [id, rol]);
  }
  const catalogos = await listarCandidatosPozo(idsUsuarios[2], true);
  assert.ok(idsUsuarios.slice(0, 2).every((id) => catalogos.propietarios.some((x) => x.id_usuario === id)));
  assert.ok(idsUsuarios.slice(2).every((id) => catalogos.perforadores.some((x) => x.id_usuario === id)));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const creado = await crearPozoCompleto(idsUsuarios[2], {
    pozo: { id_propietario: idsUsuarios[0], id_perforador: idsUsuarios[2], id_sitio: Number(sitio.rows[0].id_sitio), empresa: "TEMPORAL RSP06C", profundidad_final_m: 80 },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 20, material: "Arena" }, { desde_m: 25, hasta_m: 80, material: "Roca" }],
    intervalos_diametro: [{ desde_m: 0, hasta_m: 40, diametro_pulg: 8, material_tuberia: "Acero" }, { desde_m: 40, hasta_m: 80, diametro_pulg: 6, material_tuberia: "PVC" }],
    niveles_aporte: [{ profundidad_m: 30 }], foto: { mime_type: "image/png", base64: png },
  }, fotos);
  idPozo = creado.pozo.id_pozo;
  const actualizado = await actualizarPozoCompleto(idPozo, {
    pozo: { ...creado.pozo, id_propietario: idsUsuarios[1], id_perforador: idsUsuarios[3], empresa: "TEMPORAL RSP06C EDITADO", profundidad_final_m: 90 },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 18, material: "Arena fina" }, { desde_m: 30, hasta_m: 90, material: "Basalto" }],
    intervalos_diametro: [{ desde_m: 0, hasta_m: 90, diametro_pulg: 6, material_tuberia: "PVC" }], niveles_aporte: [{ profundidad_m: 45 }],
    foto_accion: "reemplazar", foto: { mime_type: "image/png", base64: png },
  }, fotos, undefined, purgaFallida);
  assert.equal(actualizado.intervalos_litologicos.length, 2);
  let reporte = await getReportePozo(idPozo); assert.ok(reporte);
  assert.ok(reporte.foto_url && (await fs.readdir(fotos)).includes(`pozo-${idPozo}.png`));
  assert.ok((await generarPDFBytes(reporte, idPozo)).length > 1_000);
  await assert.rejects(()=>createIntervaloLitologico(idPozo!,{desde_m:90,hasta_m:91,material:"Fuera de profundidad"}),/excede/);
  const app=Fastify();app.decorate("authenticate",async()=>undefined);app.decorate("pozoIsFromUser",async()=>undefined);app.decorate("userIsAdminOrPerforador",async()=>undefined);app.decorate("userIsPropietarioOrPerforadorOrAdmin",async()=>undefined);await app.register(rutasLitologicas);await app.ready();
  const fuera=await app.inject({method:"POST",url:`/usuarios/${idsUsuarios[1]}/pozos/${idPozo}/intervalo_litologico`,payload:{desde_m:90,hasta_m:91,material:"Fuera"}});
  const solapado=await app.inject({method:"POST",url:`/usuarios/${idsUsuarios[1]}/pozos/${idPozo}/intervalo_litologico`,payload:{desde_m:5,hasta_m:10,material:"Solapado"}});await app.close();
  assert.equal(fuera.statusCode,400);assert.equal(solapado.statusCode,400);
  await actualizarPozoCompleto(idPozo, { ...actualizado, pozo: actualizado.pozo, foto_accion: "eliminar" }, fotos, undefined, purgaFallida);
  reporte = await getReportePozo(idPozo); assert.ok(reporte?.foto_url == null);
  assert.equal((await fs.readdir(fotos)).some(nombre=>nombre.startsWith(`pozo-${idPozo}.`)),false);
  assert.ok((await generarPDFBytes(reporte!, idPozo)).length > 1_000);
  const antes = await myPool.query(`SELECT empresa, profundidad_final_m FROM pozo WHERE id_pozo=$1`, [idPozo]);
  await assert.rejects(() => actualizarPozoCompleto(idPozo!, { ...actualizado, pozo: { ...actualizado.pozo, profundidad_final_m: 10 }, foto_accion: "conservar" }, fotos));
  const despues = await myPool.query(`SELECT empresa, profundidad_final_m FROM pozo WHERE id_pozo=$1`, [idPozo]);
  assert.deepEqual(despues.rows, antes.rows);
  await myPool.query(`UPDATE usuario SET activo=false WHERE id_usuario=$1`, [idsUsuarios[0]]);
  await assert.rejects(() => validarPersonaPozo(idsUsuarios[0], "propietario", myPool));
  assert.equal(avisosPurga.length,2);
  console.log(JSON.stringify({ ejecutada:true, catalogos:true, creacion:true, edicion:true, fotoReemplazada:true, fotoEliminada:true, purgaPostCommitControlada:true, litologiaFueraProfundidadRechazada:true, pdf:true, rollback:true, rechazoPersona:true }));
} finally {
  if (idPozo) await myPool.query(`DELETE FROM pozo WHERE id_pozo=$1`, [idPozo]);
  for (const id of idsUsuarios.reverse()) await myPool.query(`DELETE FROM usuario WHERE id_usuario=$1`, [id]);
  if (idPozo) for (const nombre of await fs.readdir(fotos).catch(() => [])) if (nombre.startsWith(`pozo-${idPozo}.`)) await fs.rm(path.join(fotos,nombre), { force:true });
  if(idPozo){const papelera=path.join(fotos,".trash");for(const nombre of await fs.readdir(papelera).catch(()=>[]))if(nombre.startsWith(`${idPozo}-`))await fs.rm(path.join(papelera,nombre),{force:true});}
  await myPool.end();
}
