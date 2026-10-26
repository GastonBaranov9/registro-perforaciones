import type {Pool,PoolClient} from 'pg';
import {myPool} from '../db/pool.ts';
import {exigirAdministracionNumeracion,validarNumeroPerforacion,autorizacionNumeracion} from './numeracion-perforacion-service.ts';
import {iniciarEscrituraSesion} from './escritura-sesion.ts';
import {emitirConfirmacion,verificarConfirmacion,exigirMotivo} from './confirmacion-numeracion.ts';
import {T05ConflictoNumeracion,T05DatosIncorrectos,T05SinPermiso} from '../models/errors.ts';
type Db=Pick<PoolClient,'query'>;
export interface CambioPolitica {operacion:'proteger_rango'|'habilitar_numero'|'proteger_numero';desde:number;hasta:number;motivo:string}
interface Politica {revision:string;rangos:{desde:number;hasta:number}[];excepciones:number[]}
export async function leerPolitica(db:Db=myPool):Promise<Politica>{return (await db.query('SELECT revision::text,rangos,excepciones FROM politica_numeracion WHERE singleton')).rows[0];}
export async function consultarPolitica(actor:number,db:Db=myPool){
 await exigirAdministracionNumeracion(actor,db);
 return {...await leerPolitica(db),puede_administrar:!!await autorizacionNumeracion(actor,db),historial:(await db.query('SELECT id::text,actor::text,motivo,fecha,operacion,anterior,posterior FROM politica_numeracion_historial ORDER BY id DESC LIMIT 30')).rows};
}
async function revisar(actor:number,c:CambioPolitica,db:Db,lock=false){
 await exigirAdministracionNumeracion(actor,db);exigirMotivo(c.motivo);validarNumeroPerforacion(c.desde);validarNumeroPerforacion(c.hasta);
 if(!['proteger_rango','habilitar_numero','proteger_numero'].includes(c.operacion)||c.hasta<c.desde||(c.operacion!=='proteger_rango'&&c.hasta!==c.desde))throw new T05DatosIncorrectos('Revisá la operación y los números indicados.');
 const autorizacion=await autorizacionNumeracion(actor,db,lock);if(!autorizacion)throw new T05SinPermiso('Se requiere autorización especial de numeración.');
 const anterior=await leerPolitica(db);
 const actual=(await db.query('SELECT proximo,mayor_asignado FROM numeracion_perforacion WHERE singleton')).rows[0];
 const {ocupado,protegido}=(await db.query('SELECT EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=$1) ocupado,numero_protegido($1) protegido',[c.desde])).rows[0];
 let rangos=anterior.rangos.map(x=>({...x})),excepciones=[...anterior.excepciones];
 if(c.operacion==='habilitar_numero'){
  if(ocupado)throw new T05ConflictoNumeracion('El número tiene una perforación, reserva o referencia anterior. Revisá el procedimiento correspondiente; no se puede habilitar.');
  if(!protegido)throw new T05ConflictoNumeracion('Este número no necesita una excepción de protección histórica.');
  excepciones.push(c.desde);
 }else if(c.operacion==='proteger_numero'){
  if(!excepciones.includes(c.desde))throw new T05ConflictoNumeracion('No existe una excepción para retirar.');
  excepciones=excepciones.filter(n=>n!==c.desde);
 }else{
  rangos.push({desde:c.desde,hasta:c.hasta});rangos.sort((a,b)=>a.desde-b.desde);
  const unidos:typeof rangos=[];for(const r of rangos){const last=unidos.at(-1);if(last&&r.desde<=last.hasta+1)last.hasta=Math.max(last.hasta,r.hasta);else unidos.push(r);}rangos=unidos;
  excepciones=excepciones.filter(n=>n<c.desde||n>c.hasta);
 }
 excepciones.sort((a,b)=>a-b);
 if(rangos.length>100||excepciones.length>10000)throw new T05DatosIncorrectos('La política requiere una revisión de alcance antes de ampliarla.');
 if(JSON.stringify(rangos)===JSON.stringify(anterior.rangos)&&JSON.stringify(excepciones)===JSON.stringify(anterior.excepciones))throw new T05DatosIncorrectos('No hay cambios para guardar.');
 if(actual.proximo!=null&&rangos.some(r=>Number(actual.proximo)>=r.desde&&Number(actual.proximo)<=r.hasta)&&!excepciones.includes(Number(actual.proximo)))throw new T05ConflictoNumeracion('La protección incluye el próximo número configurado. Elegí primero otro número disponible.');
 return {anterior,posterior:{rangos,excepciones},autorizacion,contador:actual,cambio:{...c,motivo:c.motivo.trim()},ocupado,protegido};
}
export async function revisarPolitica(actor:number,c:CambioPolitica,db:Db=myPool){const s=await revisar(actor,c,db);return {...s,frase:`POLITICA ${c.desde}`,token:emitirConfirmacion(actor,'politica',c.desde,s)};}
export async function guardarPolitica(actor:number,c:CambioPolitica&{token:string;confirmacion:string;evidencia_fisica:boolean},pool:Pick<Pool,'connect'>=myPool){
 if(c.evidencia_fisica!==true||c.confirmacion!==`POLITICA ${c.desde}`)throw new T05DatosIncorrectos('Confirmá la revisión de carpetas, documentación y sincronizaciones pendientes.');
 const db=await pool.connect();try{
  await iniciarEscrituraSesion(db,true);await db.query('SELECT singleton FROM numeracion_perforacion WHERE singleton FOR UPDATE');await db.query('SELECT singleton FROM politica_numeracion WHERE singleton FOR UPDATE');
  const cambio:CambioPolitica={operacion:c.operacion,desde:c.desde,hasta:c.hasta,motivo:c.motivo};const s=await revisar(actor,cambio,db,true),v=verificarConfirmacion(c.token,actor,'politica',c.desde,s);
  if((await db.query('SELECT 1 FROM politica_numeracion_historial WHERE nonce=$1',[v.nonce])).rowCount)throw new T05ConflictoNumeracion('La confirmación ya fue utilizada.');
  const next=(await db.query('UPDATE politica_numeracion SET rangos=$1,excepciones=$2 WHERE singleton RETURNING revision::text,rangos,excepciones',[JSON.stringify(s.posterior.rangos),s.posterior.excepciones])).rows[0];
  await db.query('INSERT INTO politica_numeracion_historial(actor,autorizacion_id,motivo,nonce,operacion,confirmacion,evidencia_fisica,anterior,posterior) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8)',[actor,s.autorizacion.id,c.motivo.trim(),v.nonce,c.operacion,c.confirmacion,JSON.stringify(s.anterior),JSON.stringify(next)]);
  await db.query('COMMIT');return next;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
