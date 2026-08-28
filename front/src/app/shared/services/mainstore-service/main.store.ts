import { Injectable, signal } from '@angular/core';
import { UsuarioSesion } from '../../types/schemas';

@Injectable({
  providedIn: 'root',
})
export class MainStore {
  public user = signal<UsuarioSesion | null>(null);
  public initialized = signal<boolean>(false);

  constructor() {
    this.init();
  }

  public init() {
    // Remove credentials left by releases predating secure native sessions. These
    // values are never read or migrated; modern authentication uses cookies (web)
    // or secure storage (native).
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.initialized.set(true);
  }
  public setUser(user: UsuarioSesion) {
    this.user.set(user);
  }

  public isAdmin(): boolean {
    return this.user()?.roles?.some((rol) => rol.nombre === 'administracion') ?? false;
  }

  public clearSession() {
    this.user.set(null);
  }

  public isLogged() {
    return this.initialized() && !!this.user();
  }
}
