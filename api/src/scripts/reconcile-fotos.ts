import { Pool } from "pg";
import { cargarConfigDbOperaciones } from "../db/operaciones-config.ts";
import { reconciliarFotos, type ReferenciaFoto } from "../services/fotos-reconcile-service.ts";

const argumentos=new Set(process.argv.slice(2));
const permitidos=new Set(["--dry-run"]);
const desconocido=[...argumentos].find((x)=>!permitidos.has(x));
let pool:Pool|undefined;
try{
  if(desconocido)throw new Error(`Argumento no reconocido: ${desconocido}. Solo se admite --dry-run; apply no está automatizado.`);
  const directorio=process.env.FOTOS_DIR;
  if(!directorio)throw new Error("Falta FOTOS_DIR");
  pool=new Pool(cargarConfigDbOperaciones());
  const {rows}=await pool.query<ReferenciaFoto>("SELECT id_pozo,foto_url FROM public.pozo ORDER BY id_pozo");
  console.log(JSON.stringify(await reconciliarFotos(directorio,rows)));
}catch(error){
  console.error(error instanceof Error?error.message:"Falló la reconciliación de fotografías");
  process.exitCode=1;
}finally{await pool?.end();}
