import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { T05ConflictoNumeracion, T05DatosIncorrectos } from '../models/errors.ts';

// Misma semántica que las confirmaciones de eliminación: sólo memoria, cinco minutos.
// El nonce se consume en la auditoría transaccional, nunca al consultar o cancelar.
const secreto = randomBytes(32);
export const huellaConfirmacion = (estado: unknown) => createHash('sha256').update(JSON.stringify(estado)).digest('hex');
export function emitirConfirmacion(actor: number, operacion: string, numero: number, estado: unknown) {
  const payload = Buffer.from(JSON.stringify({actor,operacion,numero,huella:huellaConfirmacion(estado),nonce:randomUUID(),exp:Date.now()+300000})).toString('base64url');
  return payload+'.'+createHmac('sha256',secreto).update(payload).digest('base64url');
}
export function verificarConfirmacion(token: unknown, actor: number, operacion: string, numero: number, estado: unknown) {
  const fallo = () => new T05ConflictoNumeracion('La autorización venció o la situación cambió. Revisá y confirmá nuevamente; los datos pendientes se conservan.');
  if(typeof token!=='string'||token.length>4096)throw fallo();
  const [payload,firma,...extra]=token.split('.');
  const esperada=createHmac('sha256',secreto).update(payload??'').digest();
  const recibida=Buffer.from(firma??'','base64url');
  if(extra.length||recibida.length!==esperada.length||!timingSafeEqual(esperada,recibida))throw fallo();
  let c;try{c=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw fallo();}
  if(c.actor!==actor||c.operacion!==operacion||c.numero!==numero||c.exp<=Date.now()||c.huella!==huellaConfirmacion(estado))throw fallo();
  return c as {nonce:string;exp:number};
}
export function exigirMotivo(motivo: unknown): asserts motivo is string {
  if(typeof motivo!=='string'||motivo.trim().length<10||motivo.trim().length>1000)
    throw new T05DatosIncorrectos('Se requiere un motivo administrativo de 10 a 1000 caracteres.');
}
