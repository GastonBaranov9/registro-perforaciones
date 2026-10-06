import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { CandidatoPozo } from '../../../../shared/types/schemas';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

@Component({
  selector: 'app-historicos', imports: [FormsModule, IonContent, IonButton],
  template: `<ion-content class="ion-padding">
    <h1>Carga histórica</h1>
    <p>Exclusivo de Administración. Registre una perforación anterior hasta P-3281. Esta carga no consume el próximo número automático.</p>
    <p>Deje vacíos los datos desconocidos. No se completarán con valores supuestos.</p>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (resultado(); as r) { <p role="status">P-{{ r.numero_perforacion }} guardada.</p><ion-button (click)="ver(r.id_pozo)">Ver perforación</ion-button> }
    <form (ngSubmit)="guardar()">
      <fieldset [disabled]="ocupado() || !!envio || !!resultado()">
        <label>Número histórico P-<input name="numero" type="number" min="1" max="3281" step="1" required [(ngModel)]="numero"></label>
        <label>Propietario<select name="propietario" [(ngModel)]="propietario"><option [ngValue]="null">Desconocido</option>@for (p of propietarios(); track p.id_usuario) { <option [ngValue]="p.id_usuario">{{ p.nombre }}</option> }</select></label>
        <label>Perforador<select name="perforador" [(ngModel)]="perforador"><option [ngValue]="null">Desconocido</option>@for (p of perforadores(); track p.id_usuario) { <option [ngValue]="p.id_usuario">{{ p.nombre }}</option> }</select></label>
        <label>Departamento del sitio<input name="departamento" [(ngModel)]="departamento" maxlength="160"></label>
        <label>Localidad<input name="localidad" [(ngModel)]="localidad" maxlength="160"></label>
        <label>Padrón<input name="padron" [(ngModel)]="padron" maxlength="80"></label>
        <label>Latitud conocida<input name="latitud" [(ngModel)]="latitud"></label>
        <label>Longitud conocida<input name="longitud" [(ngModel)]="longitud"></label>
        <label>Fecha de inicio<input name="inicio" type="date" [(ngModel)]="inicio"></label>
        <label>Fecha de finalización<input name="fin" type="date" [(ngModel)]="fin"></label>
        <label>Profundidad final (m)<input name="profundidad" type="number" min="0.01" step="any" [(ngModel)]="profundidad"></label>
        <label>Caudal estimado (l/h)<input name="caudal" type="number" min="0" step="1" [(ngModel)]="caudal"></label>
        <label>Cementación documentada<textarea name="cementacion" [(ngModel)]="cementacion"></textarea></label>
        <label>Desarrollo documentado<textarea name="desarrollo" [(ngModel)]="desarrollo"></textarea></label>
      </fieldset>
      @if (!resultado() && !retirada()) { <ion-button type="submit" [disabled]="ocupado()">{{ envio ? 'Reintentar la misma carga' : 'Guardar histórico' }}</ion-button> }
    </form>
    @if (envio && !resultado()) { <p>Solicitud P-{{ envio.body['numero_perforacion'] }} conservada sin cambios para reintentar con la misma clave. No vuelva a crearla en otra pestaña.</p> }
    @if (resultado()) { <ion-button (click)="otra()">Cargar otra perforación</ion-button> }
    @if (envio?.rechazada && !resultado()) { <p>Rechazo definitivo. Puede descartar este intento y abrir un formulario vacío.</p><ion-button (click)="otra()">Descartar intento rechazado</ion-button> }
  </ion-content>`,
  styles: ['fieldset { border: 0; padding: 0; max-width: 42rem; } label { display: grid; gap: .3rem; margin-block: 1rem; } input,select,textarea { padding: .65rem; font: inherit; }'],
})
export class HistoricosPage {
  private http = inject(HttpClient); private router = inject(Router); private candidatos = inject(CandidatosPozoService);
  private auth = inject(AuthService);
  private storageKey() { const actor = this.auth.userId(); if (!actor) throw new Error('Inicie sesión como administrador.'); return `historico-pendiente:${environment.apiURL}:${actor}`; }
  propietarios = signal<CandidatoPozo[]>([]); perforadores = signal<CandidatoPozo[]>([]);
  error = signal(''); ocupado = signal(false); retirada = signal(false);
  resultado = signal<{ id_pozo: number; numero_perforacion: number } | null>(null);
  numero: number | null = null; propietario: number | null = null; perforador: number | null = null;
  departamento = ''; localidad = ''; padron = ''; latitud = ''; longitud = ''; inicio = ''; fin = '';
  profundidad: number | null = null; caudal: number | null = null; cementacion = ''; desarrollo = '';
  envio?: { actor: number; clave: string; epoca: string; body: Record<string, unknown>; rechazada?: boolean };
  async ionViewWillEnter() {
    try {
      const saved = sessionStorage.getItem(this.storageKey());
      if (!this.envio && saved) this.envio = JSON.parse(saved);
      if (this.envio?.rechazada) this.retirada.set(true);
      if (this.envio && this.envio.actor !== this.auth.userId()) { this.envio = undefined; this.resultado.set(null); }
      const c = await this.candidatos.obtener({ limite: 50 }); this.propietarios.set(c.propietarios); this.perforadores.set(c.perforadores);
    }
    catch { this.error.set('No se pudieron cargar las personas. Reabra la pantalla para reintentar.'); }
  }
  async guardar() {
    if (this.ocupado() || this.resultado() || this.retirada()) return;
    this.ocupado.set(true); this.error.set('');
    try {
      if (!this.envio) {
        const actor = this.auth.userId();
        if (!actor) throw new Error('Inicie sesión como administrador.');
        if (!Number.isInteger(this.numero) || this.numero! < 1 || this.numero! > 3281) throw new Error('Ingrese un número entero entre 1 y 3281.');
        if (!this.departamento.trim() && [this.localidad,this.padron,this.latitud,this.longitud].some(s => s.trim())) throw new Error('Indique el departamento del sitio o deje todos sus datos vacíos.');
        const body: Record<string, unknown> = { numero_perforacion: this.numero };
        if (this.propietario) body['id_propietario'] = this.propietario;
        if (this.perforador) body['id_perforador'] = this.perforador;
        for (const [k,v] of Object.entries({ fecha_inicio:this.inicio,fecha_fin:this.fin,cementacion:this.cementacion,desarrollo:this.desarrollo })) if (v.trim()) body[k] = v.trim();
        if (this.profundidad != null) body['profundidad_final_m'] = this.profundidad;
        if (this.caudal != null) body['caudal_estimado_lh'] = this.caudal;
        if (this.departamento.trim()) body['sitio'] = Object.fromEntries(Object.entries({ departamento:this.departamento,localidad:this.localidad,padron:this.padron,latitud:this.latitud,longitud:this.longitud }).filter(([,v]) => v.trim()).map(([k,v]) => [k,v.trim()]));
        const { epoca } = await firstValueFrom(this.http.get<{ epoca: string }>(`${environment.apiURL}pozos/epoca-datos`).pipe(timeout(15000)));
        if (this.auth.userId() !== actor) throw new Error('La sesión cambió. Reabra Carga histórica.');
        this.envio = { actor, clave: crypto.randomUUID(), epoca, body };
      }
      const e = this.envio;
      if (e.actor !== this.auth.userId()) throw new Error('La sesión cambió. Reabra Carga histórica con la cuenta original.');
      // Persistir antes del primer envío. Un reload conserva la época original.
      sessionStorage.setItem(this.storageKey(), JSON.stringify(e));
      const result = await firstValueFrom(this.http.post<{ id_pozo: number; numero_perforacion: number }>(`${environment.apiURL}pozos/historicos`, e.body,
        { headers: { 'Idempotency-Key': e.clave, 'X-Epoca-Datos': e.epoca } }).pipe(timeout(90000)));
      this.resultado.set(result);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 410) this.retirada.set(true);
      if (this.envio && error instanceof HttpErrorResponse && (error.status === 400 || error.status === 410 || error.error?.code === 'HISTORICO_NUMERO_OCUPADO')) {
        this.envio.rechazada = true; this.retirada.set(true);
        try { sessionStorage.setItem(this.storageKey(), JSON.stringify(this.envio)); } catch { /* el intento sigue en memoria */ }
      }
      this.error.set(error instanceof HttpErrorResponse ? error.error?.message || 'No se confirmó la recepción. Reintente la misma carga.' : String(error));
    } finally { this.ocupado.set(false); }
  }
  ver(id: number) { void this.router.navigate(['/pozos-detail', id]); }
  otra() { if (this.ocupado() || (!this.resultado() && !this.envio?.rechazada)) return; sessionStorage.removeItem(this.storageKey()); this.envio = undefined; this.resultado.set(null); this.retirada.set(false); this.error.set(''); this.numero = null; this.propietario = null; this.perforador = null; this.departamento = this.localidad = this.padron = this.latitud = this.longitud = this.inicio = this.fin = this.cementacion = this.desarrollo = ''; this.profundidad = this.caudal = null; }
}
