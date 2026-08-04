import { Injectable, signal } from '@angular/core';
import { UsuarioPublico } from '../../types/schemas';

@Injectable({
  providedIn: 'root',
})
export class MainStore {
  public user = signal<UsuarioPublico | null>(null);
  public initialized = signal<boolean>(false);

  constructor() {
    this.init();
  }

  public init() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.initialized.set(true);
  }
  public setUser(user: UsuarioPublico) {
    this.user.set(user);
  }

  public isAdmin(): boolean {
    return this.user()?.roles?.some((rol) => rol.nombre === 'administracion') ?? false;
  }

  public clearSession() {
    this.user.set(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  public isLogged() {
    return this.initialized() && !!this.user();
  }
}
