import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton } from '@ionic/angular/standalone';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { NumeracionPerforacionService, numeroPerforacionValido, VistaRectificacion } from '../../../../shared/services/numeracion-perforacion.service';

@Component({
  selector: 'app-rectificacion-numeracion',
  imports: [FormsModule, IonButton],
  template: `@if (auth.tieneRol('administracion')) {
    <section aria-labelledby="rectificacion-titulo">
      <h2 id="rectificacion-titulo">Rectificación excepcional de pruebas eliminadas</h2>
      <p>Esta herramienta permite recuperar números utilizados en pruebas eliminadas. No modifica perforaciones existentes.</p>
      <p>Revisa sólo las últimas reservas consecutivas del rango automático. Para corregir un error de tipeo sin asignaciones, usá Próximo automático.</p>
      <label>Volver a ofrecer desde el número
        <input type="number" name="desdeRectificacion" min="3282" max="2147483647" step="1"
          [ngModel]="desde" (ngModelChange)="cambiarDesde($event)" [disabled]="ocupado()" />
      </label>
      <ion-button (click)="previsualizar()" [disabled]="ocupado() || !desdeValido()">Revisar reservas</ion-button>
      @if(!desdeValido()){<p class="ayuda">Ingresá un número entero desde 3282 para revisar.</p>}
      @if (vista(); as v) {
        <p>Próximo número: {{ v.proximo }} → {{ desde }}. Mayor asignado actual: {{ v.mayor_asignado }}.</p>
        <ul>@for (r of v.reservas; track r.numero_perforacion) {
          <li>N.º {{ r.numero_perforacion }} · ID original: {{ r.id_pozo_original }} · Asignado: {{ r.asignado_en }}
            @if (r.bloqueada) { <strong>Bloqueado: existen datos o referencias internas.</strong> }
          </li>
        }</ul>
        @if (!candidata()) { <p role="alert">No se puede rectificar este rango. Debe contener exclusivamente reservas finales de pruebas eliminadas, sin referencias.</p> }
        <label>Motivo de rectificación (10–1000 caracteres)
          <textarea name="motivoRectificacion" [(ngModel)]="motivo" minlength="10" maxlength="1000" [disabled]="ocupado()"></textarea>
        </label>
        <label><input type="checkbox" name="sinReferencias" [(ngModel)]="sinReferencias" [disabled]="ocupado()" />
          Confirmo que todas estas asignaciones fueron pruebas y que no se compartieron PDFs u otras referencias ni hay sincronizaciones pendientes.
        </label>
        <label>Escribí RECTIFICAR para confirmar
          <input name="confirmarRectificacion" [(ngModel)]="confirmacion" autocomplete="off" [disabled]="ocupado()" />
        </label>
        <ion-button (click)="cancelar()" [disabled]="ocupado()">Cancelar</ion-button>
        <ion-button color="danger" (click)="rectificar()" [disabled]="!puedeConfirmar()">Rectificar reservas de prueba</ion-button>
        @if(candidata()&&!puedeConfirmar()&&!ocupado()){<p class="ayuda">Ingresá un motivo de 10 a 1000 caracteres, confirmá que fueron pruebas sin referencias y escribí RECTIFICAR.</p>}
      }
      @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
    </section>
  }`,
  styles: ['h2{margin-top:0;font-size:1.4rem} p{line-height:1.6} label{display:grid;gap:.5rem;margin:1.2rem 0;max-width:38rem} input:not([type=checkbox]),textarea{width:100%;box-sizing:border-box;min-height:48px;padding:12px;border:1px solid #8295a8;border-radius:8px;background:white;color:#20344b;font:inherit} input[type=checkbox]{width:22px;height:22px} .ayuda{color:#485d70;font-size:.9rem} li{padding:12px;border-bottom:1px solid #dce4eb} input:focus-visible,textarea:focus-visible{outline:3px solid #2875ad;outline-offset:2px}'],
})
export class RectificacionNumeracionComponent {
  readonly auth = inject(AuthService);
  private readonly servicio = inject(NumeracionPerforacionService);
  readonly rectificada = output<void>();
  readonly ocupado = signal(false);
  readonly vista = signal<VistaRectificacion | null>(null);
  readonly mensaje = signal('');
  desde: number | null = null;
  motivo = '';
  sinReferencias = false;
  confirmacion = '';
  desdeValido() { return numeroPerforacionValido(this.desde) && this.desde >= 3282; }
  cambiarDesde(valor: number | null) { this.desde = valor; this.cancelar(); }
  cancelar() { if (this.ocupado()) return; this.vista.set(null); this.motivo = ''; this.sinReferencias = false; this.confirmacion = ''; this.mensaje.set(''); }
  candidata() {
    const v = this.vista();
    return !!v?.token && v.reservas.length > 0 && v.reservas.length <= 100 && !v.reservas.some(r => r.bloqueada)
      && v.reservas[0].numero_perforacion === this.desde && v.proximo === v.mayor_asignado + 1;
  }
  puedeConfirmar() {
    return this.auth.tieneRol('administracion') && !this.ocupado() && this.candidata()
      && this.motivo.trim().length >= 10 && this.motivo.trim().length <= 1000 && this.sinReferencias && this.confirmacion === 'RECTIFICAR';
  }
  async previsualizar() {
    if (!this.auth.tieneRol('administracion') || this.ocupado() || !this.desdeValido()) return;
    this.cancelar(); this.ocupado.set(true);
    try { this.vista.set(await this.servicio.previsualizar(this.desde!)); }
    catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.ocupado.set(false); }
  }
  async rectificar() {
    if (!this.puedeConfirmar()) return;
    this.ocupado.set(true); this.mensaje.set('');
    try {
      const resultado = await this.servicio.rectificar(this.desde!, this.vista()!, this.motivo.trim(), this.sinReferencias);
      this.mensaje.set(`Rectificación registrada: ${resultado.rectificacion_id}. Próximo número: ${resultado.proximo}.`);
      this.rectificada.emit();
    } catch (error) { this.mensaje.set((error as Error).message); }
    finally { this.vista.set(null); this.confirmacion = ''; this.sinReferencias = false; this.ocupado.set(false); }
  }
}
