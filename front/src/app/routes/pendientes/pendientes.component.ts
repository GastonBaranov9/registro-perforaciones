import { Component, inject, input, signal, OnInit } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CandidatosPozoService } from '../../shared/services/candidatos-pozo.service';
import { LitologiasService } from '../../shared/services/litologias.service';

type Tipo = 'propietario'|'perforador'|'litologia';
export type Ocurrencia = { id:number; id_pozo:number; numero_perforacion:number|null; texto:string; version:string; version_pozo:string; desde_m?:number; hasta_m?:number };
export type GrupoPendiente = { tipo:Tipo; texto:string; ocurrencias:Ocurrencia[] };

@Component({
  selector:'app-pendientes', imports:[FormsModule,RouterLink],
  templateUrl:'./pendientes.component.html',
  styles:[`section { margin:1rem 0; padding:1rem; border:1px solid var(--ion-color-medium); border-radius:8px; }
    label { display:block; margin:.6rem 0; } input[type=search],select { width:100%; min-height:44px; }
    button { min-height:44px; margin:.3rem; } .error { color:var(--ion-color-danger); }`],
})
export class PendientesComponent implements OnInit {
  readonly litologias=input(false);
  readonly grupos=signal<GrupoPendiente[]>([]);
  readonly activo=signal<GrupoPendiente|null>(null);
  readonly seleccion=signal<Set<number>>(new Set());
  readonly destinos=signal<{id:number;nombre:string}[]>([]);
  readonly ocupado=signal(false); readonly error=signal(''); readonly mensaje=signal('');
  readonly confirmar=signal(false);
  destino:number|null=null; busqueda=''; filtro='';
  private http=inject(HttpClient); private personas=inject(CandidatosPozoService); private catalogo=inject(LitologiasService);
  private consulta=0;
  ngOnInit(){ void this.cargar(); }
  async cargar(){
    this.ocupado.set(true); this.error.set(''); this.activo.set(null); this.confirmar.set(false); ++this.consulta;
    try { this.grupos.set(await firstValueFrom(this.http.get<GrupoPendiente[]>(environment.apiURL+'administracion/'+(this.litologias()?'litologias':'personas')+'-pendientes'))); }
    catch(e){ this.error.set(this.mensajeError(e)); }
    finally{ this.ocupado.set(false); }
  }
  filtrados(){const texto=this.filtro.trim().toLocaleLowerCase(); return this.grupos().filter(g=>g.texto.toLocaleLowerCase().includes(texto));}
  abrir(g:GrupoPendiente){
    ++this.consulta; this.activo.set(g); this.seleccion.set(new Set()); this.destinos.set([]);
    this.destino=null; this.busqueda=''; this.confirmar.set(false); this.error.set(''); this.mensaje.set('');
    if(g.tipo==='litologia')void this.buscar();
  }
  marcar(id:number,checked:boolean){const s=new Set(this.seleccion());checked?s.add(id):s.delete(id);this.seleccion.set(s);this.confirmar.set(false);}
  todas(){this.seleccion.set(new Set(this.activo()?.ocurrencias.map(x=>x.id)));this.confirmar.set(false);}
  async buscar(){
    const g=this.activo(),consulta=++this.consulta;if(!g)return;
    this.error.set(''); this.destino=null; this.confirmar.set(false);
    try {
      const opciones=g.tipo==='litologia'
        ?(await this.catalogo.listar()).filter(x=>x.nombre.toLocaleLowerCase().includes(this.busqueda.trim().toLocaleLowerCase())).map(x=>({id:x.id_litologia,nombre:x.nombre}))
        :(await this.personas.buscar(g.tipo,this.busqueda)).map(x=>({id:x.id_usuario,nombre:`${x.nombre}${x.documento_rut?' · '+x.documento_rut:''} · ID ${x.id_usuario}`}));
      if(consulta===this.consulta)this.destinos.set(opciones);
    }catch(e){if(consulta===this.consulta)this.error.set(this.mensajeError(e));}
  }
  nombreDestino(){return this.destinos().find(x=>x.id===Number(this.destino))?.nombre;}
  async vincular(){
    const g=this.activo();if(!g||!this.destino||!this.seleccion().size||!this.confirmar()||this.ocupado())return;
    this.ocupado.set(true);this.error.set('');
    const ocurrencias=g.ocurrencias.filter(x=>this.seleccion().has(x.id)).map(({id,id_pozo,texto,version,version_pozo})=>({id,id_pozo,texto,version,version_pozo}));
    try {
      await firstValueFrom(this.http.post(environment.apiURL+'administracion/pendientes/vincular',{tipo:g.tipo,destino:Number(this.destino),ocurrencias}));
      this.mensaje.set(`Se vincularon ${ocurrencias.length} ocurrencias.`); await this.cargar();
    }catch(e){this.error.set(this.mensajeError(e));this.confirmar.set(false);}
    finally{this.ocupado.set(false);}
  }
  private mensajeError(e:unknown){return e instanceof HttpErrorResponse?e.error?.message||'No se pudo completar la operación.':String(e);}
}
