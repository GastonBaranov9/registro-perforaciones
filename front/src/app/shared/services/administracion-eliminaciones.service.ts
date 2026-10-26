import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
export interface VistaEliminacion {
  origen?:'normal'|'historico'|'desconocido'; numero:number|null; id_original:number|null; asignado_en:string|null; existe:boolean;
  reservada:boolean; proximo:number; bloqueos:string[]; elegible:boolean; token:string|null;
}
export interface ConfirmacionEliminacion {
  token:string; confirmacion:string; motivo:string; prueba_confirmada?:boolean; sin_referencias_externas?:boolean;
}
@Injectable({providedIn:'root'})
export class AdministracionEliminacionesService {
  private http=inject(HttpClient);
  consultar(numero:number) {return firstValueFrom(this.http.get<VistaEliminacion>(environment.apiURL+'pozos/numeracion/eliminadas/'+numero));}
  liberar(numero:number,body:ConfirmacionEliminacion) {return firstValueFrom(this.http.post<{proximo:number}>(environment.apiURL+'pozos/numeracion/eliminadas/'+numero+'/liberar',body));}
}
