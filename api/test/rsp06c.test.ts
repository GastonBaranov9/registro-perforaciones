import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listarCandidatosPozo, validarPersonaPozo } from "../src/services/candidatos-pozo-service.ts";
import { actualizarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import type { PozoCompletoUpdateBody } from "../src/models/schemas.ts";

test("catálogos separan activos por rol y fijan perforador no administrador", async () => {
  const sqlEjecutado: string[] = [];
  const db = { async query(sql: string, params: unknown[]) {
    sqlEjecutado.push(sql);
    const rol = String(params[0]); const id = params[1] == null ? null : Number(params[1]);
    const base = rol === "propietario"
      ? [{ id_usuario: 2, nombre: "Nombre repetido", email: "a@example.test", roles: [rol] }, { id_usuario: 3, nombre: "Nombre repetido", email: "b@example.test", roles: [rol] }]
      : [{ id_usuario: id ?? 8, nombre: "Perforador", email: "p@example.test", roles: [rol] }];
    return { rows: base };
  } };
  const resultado = await listarCandidatosPozo(8, false, db as never);
  assert.deepEqual(resultado.propietarios, []);
  assert.deepEqual(resultado.perforadores.map((x) => x.id_usuario), [8]);
  assert.ok(sqlEjecutado.every((sql) => sql.includes("u.activo = true") && !sql.includes("password") && !sql.includes("version_sesion")));
});

test("persona inexistente, inactiva o con rol incorrecto es rechazada", async () => {
  const db = { async query() { return { rows: [] }; } };
  await assert.rejects(() => validarPersonaPozo(999, "propietario", db as never), /no está activa|rol propietario/);
});

function updateBody(): PozoCompletoUpdateBody {
  return { pozo: { id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: 40 },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 15, material: "Arena" }],
    intervalos_diametro: [{ desde_m: 0, hasta_m: 40, diametro_pulg: 6, material_tuberia: "PVC" }], intervalos_filtro: [], niveles_aporte: [{ profundidad_m: 20 }], foto_accion: "conservar" };
}

function poolActualizacion(fallar = false, rechazarLitologia = false, fallarRollback = false, fallarSitio = false) {
  const consultas: string[] = [];
  let parametrosUpdate: unknown[] | undefined;
  const client = { async query(sql: string, params?:unknown[]) {
    consultas.push(sql);
    if (fallarRollback && sql === "ROLLBACK") throw Object.assign(new Error("rollback controlado"), { code: "ECONNRESET" });
    if (sql.includes("JOIN usuario_rol")) return { rows: [{ id_usuario: 2 }] };
    if (sql.includes("SELECT id_pozo,id_sitio FROM pozo")) return { rows: [{ id_pozo: 55, id_sitio: 4 }] };
    if (sql.includes("UPDATE pozo SET id_propietario")) { parametrosUpdate=params; return { rows: [{ id_pozo: 55, id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: "40", foto_url: "/foto" }] }; }
    if (sql.includes("FROM public.sitio WHERE id_sitio")) {
      if (fallarSitio) throw new Error("fallo posterior a foto");
      return { rows: [{ id_sitio:4,departamento:"Salto",localidad:"Salto",latitud:"-31",longitud:"-57" }] };
    }
    if (fallar && sql.includes("INSERT INTO intervalo_diametro")) throw new Error("fallo intermedio");
    if (sql.includes("INSERT INTO intervalo_litologico")) return rechazarLitologia ? { rows: [] } : { rows: [{ id_intervalo_litologico: 7, id_pozo: 55, desde_m: "0", hasta_m: "15", material: "Arena", id_litologia: 7 }] };
    if (sql.includes("INSERT INTO intervalo_diametro")) return { rows: [{ id_intervalo_diametro_perforacion: 8, id_pozo: 55, desde_m: "0", hasta_m: "40", diametro_pulg: "6" }] };
    if (sql.includes("INSERT INTO nivel_aporte")) return { rows: [{ id_nivel_aporte: 9, id_pozo: 55, profundidad_m: "20" }] };
    return { rows: [] };
  }, release() { consultas.push("RELEASE"); } };
  return { consultas, get parametrosUpdate(){return parametrosUpdate;}, pool: { async connect() { return client; } } };
}

test("actualización completa reemplaza hijos dentro de una transacción", async () => {
  const falso = poolActualizacion(); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try {
    const data=updateBody();data.pozo.id_sitio=999;
    const resultado = await actualizarPozoCompleto(55, data, dir, falso.pool as never);
    assert.equal(resultado.intervalos_litologicos[0].id_pozo, 55);
    assert.equal(resultado.sitio.id_sitio,4);
    assert.equal(resultado.pozo.id_sitio,4);
    assert.equal(falso.parametrosUpdate?.[2],4);
    const actualizacion = falso.consultas.find((sql) => sql.startsWith("UPDATE pozo SET"));
    assert.ok(actualizacion);
    const asignaciones = actualizacion.split("WHERE id_pozo")[0];
    assert.doesNotMatch(asignaciones, /sello_sanitario|pre_filtro/);
    assert.ok(falso.consultas.some((x) => x === "COMMIT"));
    assert.equal(falso.consultas.filter((x) => x.startsWith("DELETE FROM")).length, 4);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("propietarios solo se consultan al buscar y el resultado queda limitado", async () => {
  const db = { async query(_sql:string,params:unknown[]) { return { rows:Array.from({length:10},(_,i)=>({id_usuario:i+1,nombre:`Persona ${i}`,email:`p${i}@example.test`,roles:[String(params[0])]})) }; } };
  const resultado=await listarCandidatosPozo(8,false,db as never,{propietario:"persona",limite:10});
  assert.equal(resultado.propietarios.length,10);
});

test("actualización completa acepta una litología activa identificada",async()=>{
  const falso=poolActualizacion();const data=updateBody();data.intervalos_litologicos[0].id_litologia=7;const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rsp06h-r1-edit-ok-"));
  try { const resultado=await actualizarPozoCompleto(55,data,dir,falso.pool as never);assert.equal(resultado.intervalos_litologicos[0].id_litologia,7);assert.ok(falso.consultas.includes("COMMIT")); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});

for(const caso of ["inexistente","inactiva"] as const)test(`actualización completa rechaza litología ${caso} con 400 y conserva estado previo`,async()=>{
  const falso=poolActualizacion(false,true);const data=updateBody();data.intervalos_litologicos[0].id_litologia=999;const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rsp06h-r1-edit-rechazo-"));
  try { await fs.writeFile(path.join(dir,"pozo-55.jpg"),Buffer.from([0xff,0xd8,0xff,1]));await assert.rejects(()=>actualizarPozoCompleto(55,data,dir,falso.pool as never),(error:unknown)=>{assert.ok(error instanceof Error);assert.equal((error as Error&{statusCode?:number}).statusCode,400);assert.doesNotMatch(error.name,/TypeError/);return true;});assert.ok(falso.consultas.includes("ROLLBACK"));assert.ok(!falso.consultas.includes("COMMIT"));assert.ok(falso.consultas.some((sql)=>sql.startsWith("DELETE FROM")));assert.deepEqual(await fs.readdir(dir),["pozo-55.jpg"]); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("fallo intermedio revierte datos generales e hijos", async () => {
  const falso = poolActualizacion(true); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try {
    await assert.rejects(() => actualizarPozoCompleto(55, updateBody(), dir, falso.pool as never));
    assert.ok(falso.consultas.includes("ROLLBACK")); assert.ok(!falso.consultas.includes("COMMIT"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("actualizacion completa restaura fotos aunque falle el rollback DB", async () => {
  const falso = poolActualizacion(false, false, true, true);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07f-r6-completo-"));
  const avisos: Array<Record<string, unknown>> = [];
  try {
    await fs.writeFile(path.join(dir, "pozo-55.jpg"), "anterior");
    await assert.rejects(
      () => actualizarPozoCompleto(
        55,
        { ...updateBody(), foto_accion: "eliminar" },
        dir,
        falso.pool as never,
        { logger: { warn(datos) { avisos.push(datos); } } },
      ),
      /fallo posterior a foto/,
    );
    assert.equal(await fs.readFile(path.join(dir, "pozo-55.jpg"), "utf8"), "anterior");
    assert.deepEqual(await fs.readdir(path.join(dir, ".trash")), []);
    assert.deepEqual(avisos, [{ id_pozo: 55, operacion: "actualizar_pozo_completo", etapa: "rollback_db", codigo: "ECONNRESET" }]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("profundidad reducida y solapamiento se rechazan antes de borrar hijos", async () => {
  const data = updateBody(); data.pozo.profundidad_final_m = 10;
  const falso = poolActualizacion(); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try { await assert.rejects(() => actualizarPozoCompleto(55, data, dir, falso.pool as never), /excede/); assert.equal(falso.consultas.length, 0); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("actualización conserva, elimina y reemplaza fotografía sin aceptar nombres del cliente", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-foto-"));
  try {
    await fs.writeFile(path.join(dir, "pozo-55.jpg"), Buffer.from([0xff, 0xd8, 0xff, 1]));
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "conservar" }, dir, poolActualizacion().pool as never);
    assert.ok((await fs.readdir(dir)).includes("pozo-55.jpg"));
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "eliminar" }, dir, poolActualizacion().pool as never);
    assert.equal((await fs.readdir(dir)).some((x) => x.startsWith("pozo-55.")), false);
    const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]).toString("base64");
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "reemplazar", foto: { mime_type: "image/png", base64: png } }, dir, poolActualizacion().pool as never);
    assert.ok((await fs.readdir(dir)).includes("pozo-55.png"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("una purga fallida después de COMMIT conserva la actualización confirmada", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rsp06gc-postcommit-")); const falso=poolActualizacion();
  const avisos:Array<Record<string,unknown>>=[];
  try{
    await fs.writeFile(path.join(dir,"pozo-55.jpg"),Buffer.from([0xff,0xd8,0xff,1]));
    const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]).toString("base64");
    const resultado=await actualizarPozoCompleto(55,{...updateBody(),foto_accion:"reemplazar",foto:{mime_type:"image/png",base64:png}},dir,falso.pool as never,{logger:{warn(datos){avisos.push(datos);}},eliminarPostCommit:async()=>{const error=Object.assign(new Error("controlado"),{code:"EACCES"});throw error;}});
    assert.equal(resultado.pozo.foto_url,"/usuarios/2/pozos/55/foto");
    assert.ok((await fs.readdir(dir)).includes("pozo-55.png"));
    assert.ok((await fs.readdir(path.join(dir,".trash"))).length===1);
    assert.equal(falso.consultas.filter(x=>x==="COMMIT").length,1);assert.equal(falso.consultas.includes("ROLLBACK"),false);
    assert.deepEqual(avisos,[{id_pozo:55,operacion:"actualizar_pozo_completo",etapa:"post_commit",codigo:"EACCES"}]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
