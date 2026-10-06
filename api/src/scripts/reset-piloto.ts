// Operación manual. Sin flags no conecta a PostgreSQL ni toca archivos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { cargarConfigDbOperaciones } from '../db/operaciones-config.ts';
import { leerMigraciones, checksumMigracionAplicadaValido } from '../db/migrator.ts';
import { resetPiloto } from '../services/reset-piloto-service.ts';

async function hash(file: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function regular(file: string) { const s=await fs.lstat(file); if(!s.isFile()||s.isSymbolicLink()) throw new Error('Archivo no regular'); return s; }
async function directorio(file: string) { const s=await fs.lstat(file); if(!s.isDirectory()||s.isSymbolicLink()) throw new Error('Directorio no seguro'); }

let pool: Pool | undefined;
try {
  const args=process.argv.slice(2);
  if (args.length!==2 || !args.includes('--execute') || !args.includes('--maintenance') || process.env.RESET_CONFIRM!=='RESET_RSP_PILOT_2580_3001')
    throw new Error('No ejecutado. Requiere --execute --maintenance y RESET_CONFIRM=RESET_RSP_PILOT_2580_3001. Lea docs/RESET_CONTROLADO_PILOTO.md.');
  if (process.env.PGDATABASE!=='registro_perforaciones_pilot' || process.env.PGUSER!=='rsp_pilot') throw new Error('Destino de piloto incorrecto');
  const root=process.env.FOTOS_DIR;
  if(root!=='/var/lib/registro-perforaciones/fotos') throw new Error('FOTOS_DIR debe ser el montaje activo documentado');
  const bundle=process.env.RESET_BACKUP_DIR;
  if(!bundle || !path.isAbsolute(bundle)) throw new Error('Falta directorio absoluto del backup verificado');
  await directorio(bundle); await directorio(path.dirname(root)); await directorio(root);
  const manifestPath=path.join(bundle,'manifest.txt'); await regular(manifestPath);
  const lines=(await fs.readFile(manifestPath,'utf8')).trim().split(/\r?\n/);
  const manifest=new Map<string,string>();
  for(const line of lines) { const i=line.indexOf('='); if(i<1) throw new Error('Manifest inválido'); const k=line.slice(0,i); if(manifest.has(k)) throw new Error('Manifest duplicado'); manifest.set(k,line.slice(i+1)); }
  if(manifest.get('STATUS')!=='complete'||manifest.get('SCHEMA_STATE')!=='managed'||manifest.get('RSP_BACKUP_FORMAT')!=='1') throw new Error('Backup no completo/gestionado');
  for(const [file,prefix] of [['database.dump','DATABASE'],['photos.tar.gz','PHOTOS']]) {
    const ruta=path.join(bundle,file); const stat=await regular(ruta);
    if(manifest.get(`${prefix}_FILE`)!==file || String(stat.size)!==manifest.get(`${prefix}_SIZE`) || await hash(ruta)!==manifest.get(`${prefix}_SHA256`)) throw new Error('Backup no coincide con su manifest');
  }
  const expectedHash=process.env.RESET_PHOTO_SHA256;
  if(!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Falta SHA256 de pozo-5.jpg verificado contra el backup');
  // Leer el miembro concreto por stdout; nunca extraer el tar sobre el volumen.
  const archived = await promisify(execFile)('tar',['-xzOf',path.join(bundle,'photos.tar.gz'),'fotos/pozo-5.jpg'],{encoding:'buffer',maxBuffer:2*1024*1024,timeout:30000});
  if(archived.stdout.length!==1285735 || createHash('sha256').update(archived.stdout).digest('hex')!==expectedHash) throw new Error('La foto del backup no coincide con RESET_PHOTO_SHA256');
  const photo=path.join(root,'pozo-5.jpg');
  const comprobarFoto=async()=>{
    if((await regular(photo)).size!==1285735 || await hash(photo)!==expectedHash) throw new Error('Foto distinta del inventario/backup');
    const names=(await fs.readdir(root)).sort();
    if(JSON.stringify(names)!==JSON.stringify(['.trash','pozo-5.jpg'])) throw new Error('Archivos inesperados');
    await directorio(path.join(root,'.trash'));
    if((await fs.readdir(path.join(root,'.trash'))).length) throw new Error('.trash no está vacía');
  };
  await comprobarFoto();
  const quarantine=path.join(path.dirname(root),`reset-quarantine-${randomUUID()}`);
  const saved=path.join(quarantine,'pozo-5.jpg');
  const migrations=await leerMigraciones();
  pool=new Pool({...cargarConfigDbOperaciones(),max:1});
  const result=await resetPiloto(pool,{
    database:'registro_perforaciones_pilot',user:'rsp_pilot',mantenimiento:true,
    verificarMigraciones:async ledger=>{
      const rows=ledger as {version:string;nombre:string;checksum_sha256:string}[];
      if(rows.length!==migrations.length || rows.some(r=>!migrations.some(m=>m.version===r.version&&m.nombre===r.nombre&&checksumMigracionAplicadaValido(m,r.checksum_sha256)))) throw new Error('Checksum de migraciones diferente');
      const signature=rows.map(r=>`${r.version}:${r.nombre}:${r.checksum_sha256.trim()}`).join(',');
      if(manifest.get('MIGRATIONS')!==signature) throw new Error('El backup debe corresponder al ledger instalado 000..017');
    },
    registrarPreparado:async data=>{
      await fs.mkdir(quarantine,{recursive:false});
      await fs.writeFile(path.join(quarantine,'PREPARED.json'),JSON.stringify({data,backup:path.basename(bundle),foto_sha256:expectedHash,photo,saved},null,2),{flag:'wx'});
    },
    cuarentena:async()=>{ await comprobarFoto(); await fs.rename(photo,saved); },
    restaurarFoto:async()=>{
      try { await fs.lstat(photo); throw new Error('La ruta activa fue ocupada; mantener cuarentena'); }
      catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
      await fs.rename(saved,photo);
    },
  });
  await fs.writeFile(path.join(quarantine,'COMMITTED.json'),JSON.stringify(result),{flag:'wx'});
  console.log(JSON.stringify({status:'RESET_CONFIRMADO',...result,cuarentena:quarantine}));
} catch(error) {
  console.error(error instanceof Error?error.message:'Reset abortado'); process.exitCode=1;
} finally { await pool?.end(); }
