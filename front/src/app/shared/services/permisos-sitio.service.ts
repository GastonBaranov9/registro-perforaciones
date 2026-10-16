import { inject, Injectable, resource } from '@angular/core';
import { AuthService } from './auth-service/auth.service';
import { EdicionPozoService } from './edicion-pozo.service';
import { PozosListService } from './pozos-list.service';

@Injectable()
export class PermisosSitioService {
  private auth = inject(AuthService);
  private permisos = inject(EdicionPozoService);
  private pozos = inject(PozosListService);
  private registros = resource({ loader: () => this.auth.tieneRol('administracion') ? Promise.resolve([]) : this.pozos.getListaPozos() });
  readonly mensaje = this.permisos.mensaje;
  puedeEditar(idSitio: number) {
    if (this.auth.tieneRol('administracion')) return true;
    const vinculados = this.registros.hasValue() ? this.registros.value().filter(p => p.id_sitio === idSitio) : [];
    return vinculados.length > 0 && vinculados.every(p => p.origen !== 'historico' && this.permisos.puedeEditar(p));
  }
  recargar() { this.registros.reload(); }
}
