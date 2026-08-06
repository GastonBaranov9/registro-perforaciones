import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reemplazarFotoReversible } from "../src/services/foto-archivo-service.ts";

const anterior = Buffer.from([0xff,0xd8,0xff,0x01]);
const nueva = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

async function escenario(fn: (directorio:string)=>Promise<void>) {
  const directorio = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06gd-foto-"));
  try { await fn(directorio); } finally { await fs.rm(directorio,{recursive:true,force:true}); }
}

test("restaura la foto anterior si falla la promoción después de aislarla", async () => escenario(async (directorio) => {
  await fs.writeFile(path.join(directorio,"pozo-7.jpg"),anterior);
  await assert.rejects(reemplazarFotoReversible(7,directorio,{buffer:nueva,extension:"png"},async()=>true,"/foto",{
    promover:async()=>{throw Object.assign(new Error("fallo controlado"),{code:"EIO"});},
  }));
  assert.deepEqual(await fs.readFile(path.join(directorio,"pozo-7.jpg")),anterior);
  assert.equal((await fs.readdir(directorio)).some((x)=>x==="pozo-7.png"),false);
  assert.deepEqual(await fs.readdir(path.join(directorio,".trash")),[]);
}));

test("elimina una escritura temporal parcial sin afectar la foto anterior", async () => escenario(async (directorio) => {
  await fs.writeFile(path.join(directorio,"pozo-8.jpg"),anterior);
  await assert.rejects(reemplazarFotoReversible(8,directorio,{buffer:nueva,extension:"png"},async()=>true,"/foto",{
    escribir:async(ruta)=>{await fs.writeFile(ruta,nueva.subarray(0,4));throw Object.assign(new Error("disco lleno"),{code:"ENOSPC"});},
  }));
  assert.deepEqual(await fs.readFile(path.join(directorio,"pozo-8.jpg")),anterior);
  assert.deepEqual(await fs.readdir(path.join(directorio,".trash")),[]);
}));

test("revierte archivo nuevo y anterior cuando falla la confirmación lógica", async () => escenario(async (directorio) => {
  await fs.writeFile(path.join(directorio,"pozo-9.jpg"),anterior);
  await assert.rejects(reemplazarFotoReversible(9,directorio,{buffer:nueva,extension:"png"},async()=>{throw new Error("base controlada");},"/foto"));
  assert.deepEqual(await fs.readFile(path.join(directorio,"pozo-9.jpg")),anterior);
  await assert.rejects(fs.access(path.join(directorio,"pozo-9.png")));
  assert.deepEqual(await fs.readdir(path.join(directorio,".trash")),[]);
}));

test("sin foto previa una escritura fallida no deja archivos", async () => escenario(async (directorio) => {
  await assert.rejects(reemplazarFotoReversible(10,directorio,{buffer:nueva,extension:"png"},async()=>true,"/foto",{
    escribir:async()=>{throw Object.assign(new Error("sin espacio"),{code:"ENOSPC"});},
  }));
  assert.deepEqual(await fs.readdir(path.join(directorio,".trash")),[]);
}));
