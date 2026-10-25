import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
export interface VistaReingreso {
  numero:number;id_original:number|null;asignado_en:string|null;existe:boolean;bloqueos:string[];
  referencias_historicas:number;elegible:boolean;token:string|null;
}
export interface ConfirmacionReingreso {
  token:string;motivo:string;confirmacion:string;sin_referencias_externas:true;nueva_carga_administrativa:true;
}
@Injectable({providedIn:'root'})
export class ReingresoHistoricoService {
  private http=inject(HttpClient);
  consultar(numero:number){return firstValueFrom(this.http.get<VistaReingreso>(environment.apiURL+'pozos/historicos/reingreso/'+numero));}
}
