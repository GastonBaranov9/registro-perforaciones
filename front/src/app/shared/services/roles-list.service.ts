import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Rol } from '../types/schemas';

@Injectable({
  providedIn: 'root',
})
export class RolesListService {
  private readonly baseURL = environment.apiURL + 'roles';
  private readonly httpClient = inject(HttpClient);

  public getRoles(): Promise<Rol[]> {
    return firstValueFrom(this.httpClient.get<Rol[]>(this.baseURL));
  }
}
