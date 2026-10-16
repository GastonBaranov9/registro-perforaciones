import { inject, Injectable, NgZone } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { AuthService } from './auth-service/auth.service';

export const MENSAJE_SOLO_LECTURA = 'Solo lectura. El perforador solo puede editar perforaciones propias durante las primeras 24 horas desde su creación.';
export type CreacionPozo = { creado_por?: number; fecha_creado?: string; origen?:'normal'|'historico' };

export function dentroDeVentana(pozo: CreacionPozo | null | undefined, usuario: number | null, ahora: number): boolean {
  const creado = Date.parse(pozo?.fecha_creado ?? '');
  return !!usuario && pozo?.creado_por === usuario && Number.isFinite(creado)
    && ahora >= creado && ahora < creado + 86_400_000;
}

@Injectable({ providedIn: 'root' })
export class EdicionPozoService {
  private auth = inject(AuthService);
  // Actualiza los controles aun cuando la pantalla permanece abierta al vencer el plazo.
  private pulso = inject(NgZone).runOutsideAngular(() => toSignal(interval(1000), { initialValue: 0 }));
  readonly mensaje = MENSAJE_SOLO_LECTURA;
  puedeEditar(pozo: CreacionPozo | null | undefined): boolean {
    this.pulso();
    return this.auth.puedeOperarTodosLosPozos() || (pozo?.origen==='historico' && this.auth.puedeGestionarHistoricos()) || (pozo?.origen!=='historico' && (this.auth.tieneRol('perforador') || this.auth.tieneRol('operador_administrativo'))
      && dentroDeVentana(pozo, this.auth.userId(), Date.now()));
  }
}
