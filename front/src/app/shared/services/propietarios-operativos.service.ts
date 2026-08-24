import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CandidatoPozo, PropietarioOperativo, PropietarioOperativoActualizarBody, PropietarioOperativoCrearBody } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class PropietariosOperativosService {
  private http = inject(HttpClient);
  crear(body: PropietarioOperativoCrearBody): Promise<CandidatoPozo> {
    return firstValueFrom(this.http.post<CandidatoPozo>(`${environment.apiURL}pozos/propietarios`, body));
  }
  obtener(id: number): Promise<PropietarioOperativo> {
    return firstValueFrom(this.http.get<PropietarioOperativo>(`${environment.apiURL}pozos/propietarios/${id}`));
  }
  actualizar(id: number, body: PropietarioOperativoActualizarBody): Promise<PropietarioOperativo> {
    return firstValueFrom(this.http.put<PropietarioOperativo>(`${environment.apiURL}pozos/propietarios/${id}`, body));
  }
}
