import { inject, Injectable, resource } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { EdicionPozoService } from './edicion-pozo.service';
import { PozosEditService } from './pozos-edit.service';

// Instancia por página: no reutilizar permisos del pozo anterior.
@Injectable()
export class PermisosTecnicosService {
  private ruta = inject(ActivatedRoute);
  private parametros = toSignal(this.ruta.paramMap, { initialValue: this.ruta.snapshot.paramMap });
  private pozos = inject(PozosEditService);
  private permisos = inject(EdicionPozoService);
  readonly mensaje = this.permisos.mensaje;
  private pozo = resource({
    params: () => Number(this.parametros().get('id_pozo')),
    loader: ({ params }) => this.pozos.getPozoById(params),
  });
  puedeEditar() { return this.permisos.puedeEditar(this.pozo.hasValue() ? this.pozo.value() : undefined); }
}
