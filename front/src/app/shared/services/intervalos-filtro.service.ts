import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth-service/auth.service';
import { IntervaloFiltro } from '../types/schemas';

@Injectable({ providedIn: 'root' })
export class IntervalosFiltroService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  listar(idPozo: number): Promise<IntervaloFiltro[]> {
    const idUsuario = this.auth.userId();
    if (!idUsuario) throw new Error('No se encontró id_usuario autenticado');
    return firstValueFrom(this.http.get<IntervaloFiltro[]>(`${environment.apiURL}usuarios/${idUsuario}/pozos/${idPozo}/intervalos_filtro`));
  }
}
