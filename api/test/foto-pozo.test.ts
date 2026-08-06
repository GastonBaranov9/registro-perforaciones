import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eliminarFotoPersistida } from "../src/services/foto-pozo-service.ts";

function poolFoto(opciones:{fallarUpdate?:boolean;fotoUrl?:string|null}={}){const consultas:unknown[][]=[];const client={async query(sql:string,params:unknown[]=[]){consultas.push(params);if(sql.includes("FOR UPDATE"))return{rows:[{id_pozo:8,foto_url:opciones.fotoUrl??"/foto"}]};if(opciones.fallarUpdate&&sql.includes("SET foto_url"))throw new Error("base no disponible");return{rows:[{id_pozo:8}]};},release(){}};return{pool:{async connect(){return client;}},consultas};}

test("elimina archivo derivado del pozo y limpia referencia", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const archivo = path.join(dir, "pozo-8.jpg");
  await fs.writeFile(archivo, "foto");
  const {pool,consultas}=poolFoto();
  try {
    const resultado = await eliminarFotoPersistida(8, dir, pool as never);
    assert.equal(resultado.archivoExistia, true);
    assert.equal(await fs.stat(archivo).then(() => true, () => false), false);
    assert.ok(consultas.filter((x)=>x[0]===8).length>=3);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("archivo físico inexistente deja la base consistente", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const {pool}=poolFoto({fotoUrl:null});
  try {
    assert.deepEqual(await eliminarFotoPersistida(9, dir, pool as never), { archivoExistia: false });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("si falla la base restaura el archivo aislado", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const archivo = path.join(dir, "pozo-10.png");
  await fs.writeFile(archivo, "foto");
  const {pool}=poolFoto({fallarUpdate:true});
  try {
    await assert.rejects(() => eliminarFotoPersistida(10, dir, pool as never));
    assert.equal(await fs.readFile(archivo, "utf8"), "foto");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("purga fallida posterior a eliminar no revierte ni informa fallo lógico",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"rsp06gc-eliminar-"));const archivo=path.join(dir,"pozo-11.png");
  await fs.writeFile(archivo,"foto");const avisos:Array<Record<string,unknown>>=[];
  const {pool}=poolFoto();
  try{const resultado=await eliminarFotoPersistida(11,dir,pool as never,{logger:{warn(datos){avisos.push(datos);}},eliminarPostCommit:async()=>{throw Object.assign(new Error("controlado"),{code:"EPERM"});}});assert.deepEqual(resultado,{archivoExistia:true});assert.equal(await fs.stat(archivo).then(()=>true,()=>false),false);assert.equal((await fs.readdir(path.join(dir,".trash"))).length,1);assert.deepEqual(avisos,[{id_pozo:11,operacion:"eliminar_foto",etapa:"post_commit",codigo:"EPERM"}]);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
});
