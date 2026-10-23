import { inject, Injectable } from '@angular/core';
import { CanDeactivateFn, PRIMARY_OUTLET, Router } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';

/** Los diálogos propios deben consumir Atrás antes que la navegación de Ionic. */
@Injectable({ providedIn: 'root' })
export class DialogosFormularioService {
  private readonly cierres = new Set<() => void>();

  registrar(cerrar: () => void): () => void {
    this.cierres.add(cerrar);
    return () => this.cierres.delete(cerrar);
  }

  cerrarActivo(): boolean {
    const cerrar = [...this.cierres].at(-1);
    if (!cerrar) return false;
    cerrar();
    return true;
  }

  cerrarTodos(): void {
    const cierres = [...this.cierres];
    this.cierres.clear();
    for (const cerrar of cierres.reverse()) cerrar();
  }
}

@Injectable({ providedIn: 'root' })
export class ConfirmarSalidaPerforacionService {
  private readonly alerts = inject(AlertController);
  private pendiente?: Promise<boolean>;
  private cancelarPendiente?: () => void;

  confirmar(): Promise<boolean> {
    // Varias pulsaciones mientras se presenta la alerta comparten una decisión.
    return this.pendiente ??= this.preguntar().finally(() => {
      this.pendiente = undefined;
      this.cancelarPendiente = undefined;
    });
  }

  cancelar(): void { this.cancelarPendiente?.(); }

  private preguntar(): Promise<boolean> {
    let alert: HTMLIonAlertElement | undefined;
    let cancelada = false;
    const cancelacion = new Promise<boolean>(resolve => {
      this.cancelarPendiente = () => {
        cancelada = true;
        resolve(false);
        void alert?.dismiss(undefined, 'cancel');
      };
    });
    const respuesta = (async () => {
      alert = await this.alerts.create({
      header: '¿Descartar cambios?',
      message: 'Hay cambios sin guardar. Si salís, se perderán los cambios de esta perforación.',
      backdropDismiss: true,
      buttons: [
        { text: 'Seguir editando', role: 'cancel' },
        { text: 'Descartar y salir', role: 'destructive' },
      ],
      });
      if (cancelada) { alert.remove(); return false; }
      const cierre = alert.onDidDismiss();
      await alert.present();
      if (cancelada) await alert.dismiss(undefined, 'cancel');
      return (await cierre).role === 'destructive';
    })();
    return Promise.race([respuesta, cancelacion]);
  }
}

export interface FormularioPerforacionConCambios {
  tieneCambiosSinGuardar(): boolean;
}

export const cambiosPerforacionGuard: CanDeactivateFn<FormularioPerforacionConCambios> = (component, _route, _state, nextState) => {
  const dialogos = inject(DialogosFormularioService);
  const confirmacion = inject(ConfirmarSalidaPerforacionService);
  const destino = inject(Router).parseUrl(nextState.url).root.children[PRIMARY_OUTLET]?.segments;
  // Destinos reales de AuthService y de los guards de sesión; query/fragment no
  // cambian su carácter obligatorio. No se exceptúan otras rutas por prefijo.
  if (destino?.length === 1 && ['login', 'upgrade-required', 'session-unavailable'].includes(destino[0].path)) {
    dialogos.cerrarTodos();
    confirmacion.cancelar();
    return true;
  }
  if (dialogos.cerrarActivo()) return false;
  if (!component.tieneCambiosSinGuardar()) { confirmacion.cancelar(); return true; }
  return confirmacion.confirmar();
};
