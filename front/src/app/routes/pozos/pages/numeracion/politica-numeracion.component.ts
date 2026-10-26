import {Component,inject,signal,input,output} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {DatePipe} from '@angular/common';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom,timeout} from 'rxjs';
import {environment} from '../../../../../environments/environment';
import {numeroPerforacionValido} from '../../../../shared/services/numeracion-perforacion.service';
interface Politica {revision:string;rangos:{desde:number;hasta:number}[];excepciones:number[];puede_administrar:boolean;historial:{id:string;actor:string;motivo:string;fecha:string;operacion:string}[]}
interface Revision {token:string;frase:string;anterior:Politica;posterior:Pick<Politica,'rangos'|'excepciones'>}
@Component({selector:'app-politica-numeracion',imports:[FormsModule,DatePipe],templateUrl:'./politica-numeracion.component.html',styles:[`
 :host{display:block;margin-top:1.5rem;border-top:1px solid #cbd5e1;padding-top:1rem} label{display:block;margin:1rem 0} input:not([type=checkbox]),textarea,select{display:block;width:100%;box-sizing:border-box;max-width:36rem;padding:.65rem;border:1px solid #64748b;border-radius:.4rem;background:var(--ion-background-color,#fff);color:var(--ion-text-color,#172b3a)} button{padding:.7rem;margin:.3rem .5rem .3rem 0;border-radius:.4rem;border:1px solid #64748b;cursor:pointer} button:disabled{opacity:.6;cursor:default} .error{color:var(--ion-color-danger-shade,#a31728)} .revision{padding:1rem;border:2px solid #36788c;border-radius:.5rem} ul{padding-left:1.25rem} p,li{overflow-wrap:anywhere}
`]})
export class PoliticaNumeracionComponent {
 ngOnDestroy(){this.cancelar();}
 private http=inject(HttpClient);private url=environment.apiURL+'pozos/numeracion/politica';private turno=0;
 disabled=input(false); modificada=output<void>();ocupado=signal(false);abierta=signal(false);politica=signal<Politica|null>(null);revision=signal<Revision|null>(null);error=signal('');mensaje=signal('');
 operacion:'proteger_rango'|'habilitar_numero'|'proteger_numero'='habilitar_numero';desde:number|null=null;hasta:number|null=null;motivo='';confirmacion='';declaracion=false;
 cambiar(){this.turno++;this.revision.set(null);this.confirmacion='';this.declaracion=false;this.error.set('');this.mensaje.set('');}
 cancelar(){this.cambiar();}
 cerrar(){if(this.ocupado())return;this.cancelar();this.abierta.set(false);}
 impedimento(){if(!this.politica()?.puede_administrar)return 'Necesitás autorización especial para cambiar las protecciones.';if(!numeroPerforacionValido(this.desde))return 'Ingresá un número entero positivo.';if(this.operacion==='proteger_rango'&&(!numeroPerforacionValido(this.hasta)||this.hasta<this.desde!))return 'Indicá un final de rango válido.';if(this.motivo.trim().length<10||this.motivo.trim().length>1000)return 'Ingresá un motivo de entre 10 y 1000 caracteres.';return '';}
 private cuerpo(){return {operacion:this.operacion,desde:this.desde!,hasta:this.operacion==='proteger_rango'?this.hasta!:this.desde!,motivo:this.motivo.trim()};}
 private fallo(e:unknown){this.error.set(e instanceof HttpErrorResponse?e.error?.message??'No se confirmó la operación. Actualizá antes de reintentar.':(e as Error).message);}
 async cargar(){if(this.ocupado()||this.disabled())return;this.cambiar();this.abierta.set(true);this.ocupado.set(true);const t=++this.turno;try{const p=await firstValueFrom(this.http.get<Politica>(this.url).pipe(timeout(15000)));if(t===this.turno)this.politica.set(p);}catch(e){this.fallo(e);}finally{this.ocupado.set(false);}}
 async revisar(){if(this.ocupado()||this.disabled()||this.impedimento())return;this.cambiar();this.ocupado.set(true);const t=++this.turno;try{const r=await firstValueFrom(this.http.post<Revision>(this.url+'/revision',this.cuerpo()).pipe(timeout(15000)));if(t===this.turno)this.revision.set(r);}catch(e){this.fallo(e);}finally{this.ocupado.set(false);}}
 puedeGuardar(){return !this.ocupado()&&!this.disabled()&&!!this.revision()?.token&&this.declaracion&&this.confirmacion===this.revision()!.frase;}
 async guardar(){if(!this.puedeGuardar())return;this.ocupado.set(true);this.error.set('');this.mensaje.set('');try{const p=await firstValueFrom(this.http.put<Politica>(this.url,{...this.cuerpo(),token:this.revision()!.token,confirmacion:this.confirmacion,evidencia_fisica:true}).pipe(timeout(15000)));this.politica.update(old=>old?{...old,...p}:null);this.mensaje.set('Protección guardada. No se cambiaron el contador ni las reservas. Actualizá para consultar la auditoría.');this.modificada.emit();}catch(e){this.fallo(e);}finally{this.revision.set(null);this.confirmacion='';this.declaracion=false;this.ocupado.set(false);}}
}
