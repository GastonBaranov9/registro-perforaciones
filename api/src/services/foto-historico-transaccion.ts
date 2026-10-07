import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { aislarFotosExistentes, decodificarFotoBase64, purgarFotosConfirmadas, restaurarFotosAisladas, rutaContenida, type FotoAislada } from './foto-archivo-service.ts';
import type { HistoricoBody } from '../models/historicos.ts';

/** Usa el mismo almacenamiento/validación/compensación que el editor normal. */
export class FotoHistoricoTransaccion {
  private aisladas: FotoAislada[]=[];
  private nuevo?:string;
  private temporal?:string;
  commitIntentado=false;
  private root:string;
  constructor(root:string) { this.root=root; }
  async cambiar(id:number, foto?:HistoricoBody['foto']) {
    const decoded=foto ? decodificarFotoBase64(foto.base64,foto.mime_type) : undefined;
    await fs.mkdir(this.root,{recursive:true});
    this.aisladas=await aislarFotosExistentes(id,this.root);
    if(decoded){
      this.nuevo=rutaContenida(this.root,`pozo-${id}.${decoded.extension}`);
      this.temporal=rutaContenida(this.root,path.join('.trash',`.staging-${id}-${randomUUID()}`));
      await fs.mkdir(path.dirname(this.temporal),{recursive:true});
      await fs.writeFile(this.temporal,decoded.buffer,{flag:'wx'});
      await fs.rename(this.temporal,this.nuevo); this.temporal=undefined;
    }
  }
  async restaurar() {
    // COMMIT ambiguo: nunca retirar la foto posiblemente confirmada.
    if(this.commitIntentado)return;
    for(const file of [this.temporal,this.nuevo])if(file)await fs.rm(file,{force:true});
    await restaurarFotosAisladas(this.aisladas);
  }
  async confirmar(id:number){await purgarFotosConfirmadas(this.aisladas,id,'historico');}
}
