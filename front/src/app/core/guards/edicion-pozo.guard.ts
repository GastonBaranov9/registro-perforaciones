import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { EdicionPozoService } from '../../shared/services/edicion-pozo.service';
import { PozosEditService } from '../../shared/services/pozos-edit.service';

export const edicionPozoGuard: CanActivateFn = async (route) => {
  const permisos = inject(EdicionPozoService);
  const pozos = inject(PozosEditService);
  const router = inject(Router);
  const id = Number(route.paramMap.get('id_pozo'));
  try {
    const pozo = await pozos.getPozoById(id);
    return permisos.puedeEditar(pozo) || router.createUrlTree(['/pozos-detail', id]);
  } catch { return router.createUrlTree(['/pozos-list']); }
};
