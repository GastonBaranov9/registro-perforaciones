import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CatalogosPersonasPozo } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class CandidatosPozoService {
  private http = inject(HttpClient);
  obtener(): Promise<CatalogosPersonasPozo> {
    return firstValueFrom(this.http.get<CatalogosPersonasPozo>(`${environment.apiURL}pozos/candidatos-personas`));
  }
}
