import fs from "node:fs/promises";
import path from "node:path";
import { nombreFotoPozo, rutaContenida, validarRaizFotos } from "./foto-archivo-service.ts";

export interface ReferenciaFoto { id_pozo: number; foto_url: string | null }
export interface HallazgoFoto {
  tipo: "referencia_sin_archivo" | "archivo_sin_referencia" | "archivos_duplicados" | "trash_antiguo" | "trash_reciente" | "entrada_no_permitida";
  path?: string;
  paths?: string[];
  id_pozo?: number;
  cantidad?: number;
  antiguedad_segundos?: number;
}
export interface ReporteReconciliacionFotos {
  modo: "dry-run";
  referencias_db: number;
  archivos_validos: number;
  referencia_sin_archivo: number;
  archivo_sin_referencia: number;
  archivos_duplicados: number;
  trash_total: number;
  trash_antiguo: number;
  entradas_no_permitidas: number;
  hallazgos: HallazgoFoto[];
}

function relativoSeguro(raiz:string,ruta:string):string {
  const relativa=path.relative(raiz,ruta);
  rutaContenida(raiz,relativa);
  return relativa.split(path.sep).join("/");
}

export async function reconciliarFotos(
  directorio:string,
  referencias:readonly ReferenciaFoto[],
  opciones:{ahoraMs?:number;trashAntiguoMs?:number}={},
):Promise<ReporteReconciliacionFotos>{
  const raiz=await validarRaizFotos(directorio);
  const ahora=opciones.ahoraMs??Date.now();
  const umbral=opciones.trashAntiguoMs??24*60*60*1000;
  const hallazgos:HallazgoFoto[]=[];
  const archivosPorPozo=new Map<number,string[]>();
  let archivosValidos=0;
  let entradasNoPermitidas=0;

  for(const entrada of await fs.readdir(raiz,{withFileTypes:true})){
    if(entrada.name===".trash")continue;
    const ruta=rutaContenida(raiz,entrada.name);
    if(entrada.isSymbolicLink()||!entrada.isFile()){
      entradasNoPermitidas++;
      hallazgos.push({tipo:"entrada_no_permitida",path:relativoSeguro(raiz,ruta)});
      continue;
    }
    const coincidencia=/^pozo-(\d+)\.(?:jpe?g|png)$/i.exec(entrada.name);
    if(!coincidencia){
      entradasNoPermitidas++;
      hallazgos.push({tipo:"entrada_no_permitida",path:relativoSeguro(raiz,ruta)});
      continue;
    }
    const id=Number(coincidencia[1]);
    if(!nombreFotoPozo(id,entrada.name))continue;
    archivosValidos++;
    archivosPorPozo.set(id,[...(archivosPorPozo.get(id)??[]),relativoSeguro(raiz,ruta)]);
  }

  const referenciados=new Set(referencias.filter((x)=>x.foto_url!==null).map((x)=>Number(x.id_pozo)));
  for(const id of [...referenciados].sort((a,b)=>a-b)){
    const rutas=[...(archivosPorPozo.get(id)??[])].sort();
    if(!rutas.length)hallazgos.push({tipo:"referencia_sin_archivo",id_pozo:id});
    else if(rutas.length>1)hallazgos.push({tipo:"archivos_duplicados",id_pozo:id,cantidad:rutas.length,paths:rutas});
  }
  for(const [id,rutas] of [...archivosPorPozo].sort(([a],[b])=>a-b)){
    if(!referenciados.has(id))for(const ruta of rutas)hallazgos.push({tipo:"archivo_sin_referencia",id_pozo:id,path:ruta});
  }

  let trashTotal=0;let trashAntiguo=0;
  const papelera=rutaContenida(raiz,".trash");
  try{
    const estado=await fs.lstat(papelera);
    if(!estado.isDirectory()||estado.isSymbolicLink())throw new Error(".trash no puede ser un symlink");
    for(const entrada of await fs.readdir(papelera,{withFileTypes:true})){
      const ruta=rutaContenida(raiz,path.join(".trash",entrada.name));
      if(entrada.isSymbolicLink()||!entrada.isFile()){
        entradasNoPermitidas++;
        hallazgos.push({tipo:"entrada_no_permitida",path:relativoSeguro(raiz,ruta)});
        continue;
      }
      const stat=await fs.lstat(ruta);const edad=Math.max(0,ahora-stat.mtimeMs);const antiguo=edad>=umbral;
      trashTotal++;if(antiguo)trashAntiguo++;
      hallazgos.push({tipo:antiguo?"trash_antiguo":"trash_reciente",path:relativoSeguro(raiz,ruta),antiguedad_segundos:Math.floor(edad/1000)});
    }
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}

  return{
    modo:"dry-run",referencias_db:referenciados.size,archivos_validos:archivosValidos,
    referencia_sin_archivo:hallazgos.filter((x)=>x.tipo==="referencia_sin_archivo").length,
    archivo_sin_referencia:hallazgos.filter((x)=>x.tipo==="archivo_sin_referencia").length,
    archivos_duplicados:hallazgos.filter((x)=>x.tipo==="archivos_duplicados").length,
    trash_total:trashTotal,trash_antiguo:trashAntiguo,entradas_no_permitidas:entradasNoPermitidas,hallazgos,
  };
}
