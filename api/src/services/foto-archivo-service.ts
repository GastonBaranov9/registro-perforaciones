import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as err from "../models/errors.ts";
import { MAX_FOTO_BYTES } from "../constants/fotos.ts";

export { MAX_FOTO_BYTES } from "../constants/fotos.ts";
export type MimeFoto = "image/jpeg" | "image/png";
export interface LoggerPurga { warn(datos: Record<string, unknown>, mensaje: string): void }
export interface FotoAislada { original: string; aislado: string }
export interface DependenciasReemplazoFoto {
  escribir?: (ruta: string, contenido: Buffer) => Promise<void>;
  promover?: (origen: string, destino: string) => Promise<void>;
  eliminar?: (ruta: string) => Promise<void>;
}

export function validarFotoBuffer(buffer: Buffer, mime?: string): { buffer: Buffer; extension: "jpg" | "png"; mime: MimeFoto } {
  if (mime !== undefined && mime !== "image/jpeg" && mime !== "image/png") throw new err.T05DatosIncorrectos("La fotografía debe ser JPEG o PNG.");
  if (buffer.length === 0 || buffer.length > MAX_FOTO_BYTES) throw new err.T05DatosIncorrectos("La fotografía debe pesar entre 1 byte y 5 MB.");
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  if (!jpeg && !png) throw new err.T05DatosIncorrectos("La firma de la fotografía no corresponde a JPEG o PNG.");
  const detectado: MimeFoto = png ? "image/png" : "image/jpeg";
  if (mime !== undefined && mime !== detectado) throw new err.T05DatosIncorrectos("El contenido de la fotografía no coincide con su tipo.");
  return { buffer, extension: png ? "png" : "jpg", mime: detectado };
}

export function decodificarFotoBase64(base64: string, mime: MimeFoto) {
  if (!base64 || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new err.T05DatosIncorrectos("La codificación base64 de la fotografía no es válida.");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.toString("base64") !== base64) throw new err.T05DatosIncorrectos("La codificación base64 de la fotografía no es canónica.");
  return validarFotoBuffer(buffer, mime);
}

export function rutaContenida(directorio: string, relativa: string): string {
  if (!path.isAbsolute(directorio) || path.isAbsolute(relativa) || relativa.includes("\0"))
    throw new Error("Ruta de fotografía no permitida");
  const raiz = path.resolve(directorio);
  const candidata = path.resolve(raiz, relativa);
  if (candidata === raiz || !candidata.startsWith(`${raiz}${path.sep}`))
    throw new Error("Ruta de fotografía fuera de FOTOS_DIR");
  return candidata;
}

export function nombreFotoPozo(idPozo: number, nombre: string): boolean {
  return Number.isSafeInteger(idPozo) && idPozo > 0
    && new RegExp(`^pozo-${idPozo}\\.(?:jpe?g|png)$`, "i").test(nombre);
}

async function validarArchivoRegular(ruta: string): Promise<void> {
  const estado = await fs.lstat(ruta);
  if (!estado.isFile() || estado.isSymbolicLink()) throw new Error("La entrada de fotografía no es un archivo regular");
}

export async function validarRaizFotos(directorio: string): Promise<string> {
  if (!path.isAbsolute(directorio)) throw new Error("FOTOS_DIR debe ser absoluto");
  await fs.mkdir(directorio, { recursive: true });
  const estado = await fs.lstat(directorio);
  if (!estado.isDirectory() || estado.isSymbolicLink()) throw new Error("FOTOS_DIR no puede ser un symlink");
  return path.resolve(directorio);
}

export async function listarFotosPozo(idPozo: number, directorio: string): Promise<string[]> {
  if (!Number.isSafeInteger(idPozo) || idPozo <= 0) throw new Error("ID de pozo no permitido");
  await validarRaizFotos(directorio);
  const nombres = (await fs.readdir(directorio)).filter((nombre) => nombreFotoPozo(idPozo, nombre)).sort();
  for (const nombre of nombres) await validarArchivoRegular(rutaContenida(directorio, nombre));
  return nombres;
}

export async function leerFotoPozo(idPozo:number,directorio:string):Promise<{nombre:string;buffer:Buffer}|null>{
  const nombre=(await listarFotosPozo(idPozo,directorio))[0];
  if(!nombre)return null;
  const ruta=rutaContenida(directorio,nombre);
  await validarArchivoRegular(ruta);
  return{nombre,buffer:await fs.readFile(ruta)};
}

export async function aislarFotosExistentes(idPozo: number, directorio: string): Promise<FotoAislada[]> {
  const papelera = rutaContenida(directorio, ".trash");
  await fs.mkdir(papelera, { recursive: true });
  const estadoPapelera = await fs.lstat(papelera);
  if (!estadoPapelera.isDirectory() || estadoPapelera.isSymbolicLink()) throw new Error(".trash no puede ser un symlink");
  const aisladas: FotoAislada[] = [];
  try {
    for (const nombre of await listarFotosPozo(idPozo, directorio)) {
      const foto = {
        original: rutaContenida(directorio, nombre),
        aislado: rutaContenida(directorio, path.join(".trash", `${idPozo}-${randomUUID()}-${nombre}`)),
      };
      await fs.rename(foto.original, foto.aislado);
      aisladas.push(foto);
    }
    return aisladas;
  } catch (error) {
    await restaurarFotosAisladas(aisladas);
    throw error;
  }
}

export async function aislarFotoExistente(idPozo: number, directorio: string): Promise<FotoAislada | null> {
  return (await aislarFotosExistentes(idPozo, directorio))[0] ?? null;
}

export async function restaurarFotosAisladas(fotos: readonly FotoAislada[]): Promise<void> {
  for (const foto of [...fotos].reverse()) {
    await validarArchivoRegular(foto.aislado);
    await fs.rename(foto.aislado, foto.original);
  }
}

export async function restaurarFotoAislada(foto: FotoAislada | null): Promise<void> {
  await restaurarFotosAisladas(foto ? [foto] : []);
}

export async function reemplazarFotoReversible<T>(
  idPozo: number,
  directorio: string,
  foto: { buffer: Buffer; extension: "jpg" | "png" },
  confirmar: (fotoUrl: string) => Promise<T>,
  fotoUrl: string,
  dependencias: DependenciasReemplazoFoto = {},
): Promise<{ resultado: T; anterior: FotoAislada | null; anteriores: FotoAislada[] }> {
  const escribir = dependencias.escribir ?? ((ruta, contenido) => fs.writeFile(ruta, contenido, { flag: "wx" }));
  const promover = dependencias.promover ?? ((origen, destino) => fs.rename(origen, destino));
  const eliminar = dependencias.eliminar ?? ((ruta) => fs.rm(ruta, { force: true }));
  await fs.mkdir(directorio, { recursive: true });
  const staging = path.join(directorio, ".trash", `.staging-${idPozo}-${randomUUID()}`);
  const destino = path.join(directorio, `pozo-${idPozo}.${foto.extension}`);
  let anteriores: FotoAislada[] = [];
  let promovida = false;
  try {
    await fs.mkdir(path.dirname(staging), { recursive: true });
    await escribir(staging, foto.buffer);
    anteriores = await aislarFotosExistentes(idPozo, directorio);
    await promover(staging, destino);
    promovida = true;
    return { resultado: await confirmar(fotoUrl), anterior: anteriores[0] ?? null, anteriores };
  } catch (error) {
    try { await eliminar(promovida ? destino : staging); } catch { /* la restauración tiene prioridad */ }
    await restaurarFotosAisladas(anteriores);
    throw error;
  }
}

export async function purgarFotoConfirmada(foto: FotoAislada | null,idPozo:number,operacion:string,logger?:LoggerPurga,eliminar:(ruta:string)=>Promise<void>=(ruta)=>fs.rm(ruta,{force:true})):Promise<boolean>{
  if(!foto)return true;
  try{await eliminar(foto.aislado);return true;}catch(error:unknown){
    const codigo=typeof error==="object"&&error!==null&&"code" in error?String(error.code):"PURGE_FAILED";
    try{logger?.warn({id_pozo:idPozo,operacion,etapa:"post_commit",codigo},"No se pudo purgar una fotografía aislada");}catch{return false;}return false;
  }
}

export async function purgarFotosConfirmadas(fotos: readonly FotoAislada[],idPozo:number,operacion:string,logger?:LoggerPurga,eliminar?:(ruta:string)=>Promise<void>):Promise<boolean>{
  let completas = true;
  for (const foto of fotos) completas = await purgarFotoConfirmada(foto,idPozo,operacion,logger,eliminar) && completas;
  return completas;
}
