import { Injectable, signal } from '@angular/core';
import { UsuarioPublico } from '../../types/schemas';

@Injectable({
  providedIn: 'root',
})
export class MainStore {
  public token = signal<string | null>(null);
  public user = signal<UsuarioPublico | null>(null);
  public initialized = signal<boolean>(false);

  constructor() {
    this.init();
  }

  public init() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');

    this.token.set(token);

    if (user) {
      this.user.set(JSON.parse(user));
    }

    this.initialized.set(true);
  }
  public setUser(user: UsuarioPublico) {
    this.user.set(user);
    localStorage.setItem('user', JSON.stringify(user));
  }

  public isAdmin(): boolean {
    return this.user()?.roles?.some((rol) => rol.nombre === 'administracion') ?? false;
  }

  public clearSession() {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  public isLogged() {
    return this.initialized() && !!this.token() && !!this.user();
  }
}
