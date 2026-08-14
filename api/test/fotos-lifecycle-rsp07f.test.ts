import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eliminarPozoPersistido } from "../src/services/foto-pozo-service.ts";
import { reconciliarFotos } from "../src/services/fotos-reconcile-service.ts";
import { rutaContenida } from "../src/services/foto-archivo-service.ts";

function poolPozo(opciones:{id?:number;fallarDelete?:boolean}={}){
  const id=opciones.id??41;const consultas:string[]=[];
  const client={
    async query(sql:string){
      consultas.push(sql.trim());
      if(sql.includes("SELECT id_pozo FROM pozo"))return{rows:[{id_pozo:id}]};
      if(sql.includes("DELETE FROM public.pozo")){
        if(opciones.fallarDelete)throw new Error("fallo DB controlado");
        return{rows:[{id_pozo:id}]};
      }
      return{rows:[]};
    },
    release(){consultas.push("RELEASE");},
  };
  return{consultas,pool:{async connect(){return client;}}};
}

async function temporal(nombre:string,fn:(dir:string)=>Promise<void>){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),nombre));
  try{await fs.mkdir(path.join(dir,".trash"));await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}
}

test("borrar pozo aísla y elimina todas sus fotos sin tocar otro pozo",()=>temporal("rsp07f-delete-",async(dir)=>{
  await fs.writeFile(path.join(dir,"pozo-41.jpg"),"a");
  await fs.writeFile(path.join(dir,"pozo-41.png"),"b");
  await fs.writeFile(path.join(dir,"pozo-42.jpg"),"ajena");
  const falso=poolPozo();
  const resultado=await eliminarPozoPersistido(41,dir,falso.pool as never);
  assert.deepEqual(resultado,{fotos:2});
  assert.deepEqual((await fs.readdir(dir)).sort(),[".trash","pozo-42.jpg"]);
  assert.deepEqual(await fs.readdir(path.join(dir,".trash")),[]);
  assert.ok(falso.consultas.some((sql)=>sql.startsWith("DELETE FROM public.pozo")));
}));

test("fallo DB antes del commit restaura todas las fotos y conserva cero trash",()=>temporal("rsp07f-rollback-",async(dir)=>{
  await fs.writeFile(path.join(dir,"pozo-51.jpg"),"original-a");
  await fs.writeFile(path.join(dir,"pozo-51.png"),"original-b");
  const falso=poolPozo({id:51,fallarDelete:true});
  await assert.rejects(()=>eliminarPozoPersistido(51,dir,falso.pool as never),/fallo DB controlado/);
  assert.equal(await fs.readFile(path.join(dir,"pozo-51.jpg"),"utf8"),"original-a");
  assert.equal(await fs.readFile(path.join(dir,"pozo-51.png"),"utf8"),"original-b");
  assert.deepEqual(await fs.readdir(path.join(dir,".trash")),[]);
  assert.ok(falso.consultas.includes("ROLLBACK"));
}));

test("fallo de purga post-commit queda registrado y reconciliable",()=>temporal("rsp07f-purge-",async(dir)=>{
  await fs.writeFile(path.join(dir,"pozo-61.jpg"),"original");
  const avisos:Array<Record<string,unknown>>=[];
  await eliminarPozoPersistido(61,dir,poolPozo({id:61}).pool as never,{
    logger:{warn(datos){avisos.push(datos);}},
    eliminarPostCommit:async()=>{throw Object.assign(new Error("disco controlado"),{code:"EIO"});},
  });
  assert.equal((await fs.readdir(path.join(dir,".trash"))).length,1);
  assert.deepEqual(avisos,[{id_pozo:61,operacion:"eliminar_pozo",etapa:"post_commit",codigo:"EIO"}]);
}));

test("reconciliador detecta faltante, huérfano y trash sin modificar nada",()=>temporal("rsp07f-reconcile-",async(dir)=>{
  await fs.writeFile(path.join(dir,"pozo-71.jpg"),"válida");
  await fs.writeFile(path.join(dir,"pozo-72.png"),"huérfana");
  const trash=path.join(dir,".trash","71-control-pozo-71.jpg");
  await fs.writeFile(trash,"abandonada");
  const antiguo=new Date(Date.now()-48*60*60*1000);await fs.utimes(trash,antiguo,antiguo);
  const antes=await Promise.all([fs.readFile(path.join(dir,"pozo-72.png")),fs.readFile(trash)]);
  const reporte=await reconciliarFotos(dir,[{id_pozo:71,foto_url:"/foto"},{id_pozo:73,foto_url:"/foto"}],{ahoraMs:Date.now(),trashAntiguoMs:24*60*60*1000});
  assert.equal(reporte.referencia_sin_archivo,1);
  assert.equal(reporte.archivo_sin_referencia,1);
  assert.equal(reporte.trash_antiguo,1);
  assert.equal(reporte.modo,"dry-run");
  assert.deepEqual(await Promise.all([fs.readFile(path.join(dir,"pozo-72.png")),fs.readFile(trash)]),antes);
}));

test("paths absolutos, traversal y symlink de foto se rechazan",()=>temporal("rsp07f-path-",async(dir)=>{
  assert.throws(()=>rutaContenida(dir,"../escape.jpg"),/fuera de FOTOS_DIR/);
  assert.throws(()=>rutaContenida(dir,path.resolve(dir,"..","escape.jpg")),/no permitida/);
  const destino=path.join(dir,"..","fuera-rsp07f.jpg");
  await fs.writeFile(destino,"fuera");
  try{
    try{await fs.symlink(destino,path.join(dir,"pozo-81.jpg"));}
    catch(error){if((error as NodeJS.ErrnoException).code==="EPERM")return;throw error;}
    await assert.rejects(()=>eliminarPozoPersistido(81,dir,poolPozo({id:81}).pool as never),/archivo regular/);
    assert.equal(await fs.readFile(destino,"utf8"),"fuera");
  }finally{await fs.rm(destino,{force:true});}
}));
