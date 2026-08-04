import { HttpClient } from '@angular/common/http';
import { inject, Injectable, OnInit } from '@angular/core';
import { MainStore } from '../mainstore-service/main.store';
import { firstValueFrom } from 'rxjs';
import { UsuarioPublico } from '../../types/schemas';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private httpClient = inject(HttpClient);
  private mainStore = inject(MainStore);
  public baseURL = environment.apiURL + 'login';

  public async logged(email: string, password: string) {
    try {
      await firstValueFrom(
        this.httpClient.post<{ authenticated: true }>(this.baseURL, { email, password })
      );

      const user = await firstValueFrom(this.httpClient.get<UsuarioPublico>(this.baseURL));

      this.mainStore.setUser(user);
    } catch (err: any) {
      if (err.status === 400) throw new Error('Email o contraseña incorrectas');
      if (err.status === 503) throw new Error('Error al iniciar sesión');
      if (err.status === 500) throw new Error('Error al iniciar sesión');
      console.log('Mensaje de error', err.error.message);
      this.mainStore.clearSession();
      if (err.status === 0) throw new Error(err.message);
      throw err;
    }
  }

  public async logout() {
    try {
      await firstValueFrom(this.httpClient.post<void>(environment.apiURL + 'logout', null));
    } finally {
      this.mainStore.clearSession();
    }
  }

  public async getUser() {
    try {
      const user = await firstValueFrom(this.httpClient.get<UsuarioPublico>(this.baseURL));
      this.mainStore.user.set(user);
    } catch (err: any) {
      console.log('Mensaje de error', err.error.message);
      this.mainStore.clearSession();
      if (err.status === 0) throw new Error(err.message);
      throw err;
    }
  }

  public userId(): number | null {
    const user = this.mainStore.user();
    return user?.id_usuario ?? null;
  }
}
