import { Component, inject, signal, ViewChild } from '@angular/core';
import { IonContent, IonButton } from '@ionic/angular/standalone';
import { OfflineService } from '../../core/native/offline.service';
import { BorradorLocal } from '../../core/native/offline-repository';
import { PozosFormComponent } from '../pozos/components/pozos-form/pozos-form.component';
import { DatosTecnicosBorradorComponent } from '../pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { DATOS_TECNICOS_ESTANDAR } from '../../shared/constants/datos-tecnicos-estandar';
import { DatosTecnicosBorrador, CandidatoPozo } from '../../shared/types/schemas';
import { Router } from '@angular/router';

@Component({
  selector: 'app-offline',
  imports: [IonContent, IonButton, PozosFormComponent, DatosTecnicosBorradorComponent],
  template: `<ion-content class="ion-padding">
    <h1>Trabajo de campo</h1>
    <p role="status">{{ offline.sinRed() || offline.auth.state() === 'offline-unverified' ? 'Sin conexión · guardado local' : 'Con conexión' }} · {{ pendientes() }} pendientes</p>
    <p>Los registros locales todavía no tienen número comercial. El servidor lo asigna al confirmar la creación.</p>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (offline.mensaje()) { <p role="status">{{ offline.mensaje() }}</p> }
    @if (offline.auth.state() !== 'authenticated') { <p>La sesión debe validarse con el servidor antes de sincronizar.</p> }
    <ion-button (click)="nuevo()" [disabled]="busy() || offline.ocupado()">Nuevo registro local</ion-button>
    <ion-button (click)="sincronizar()" [disabled]="busy() || offline.ocupado() || !!editando()">{{ offline.ocupado() ? 'Sincronizando…' : 'Sincronizar / reintentar' }}</ion-button>
    <ion-button fill="clear" (click)="router.navigateByUrl('/login')">Iniciar sesión</ion-button>
    @if (editando(); as draft) {
      <h2>Borrador sin número comercial</h2>
      <p>Guarde antes de salir. Puede guardar datos incompletos y completarlos antes de sincronizar.</p>
      <app-pozos-form [pozo]="draft.pozo" [sitioNuevo]="draft.sitio" [perforadores]="perforadores()"
        [catalogosDisponibles]="true" [perforadorBloqueado]="true" [guardando]="busy()" textoGuardar="Guardar en este dispositivo"
        (saved)="guardar()">
        <app-datos-tecnicos-borrador [inicial]="inicial" [profundidad]="draft.pozo.profundidad_final_m" [guardando]="busy()" (cambiado)="draft.tecnicos = $event" />
      </app-pozos-form>
      <ion-button (click)="guardar()" [disabled]="busy()">Guardar borrador aunque esté incompleto</ion-button>
    }
    @for (draft of offline.borradores(); track draft.id) {
      <section class="registro">
        <h2>{{ draft.pozo.propietario_provisional || 'Sin nombre provisional' }}</h2>
        <p>{{ draft.estado }} · {{ draft.sitio.localidad || draft.sitio.departamento }}</p>
        @if (draft.error) { <p role="alert">{{ draft.error }}</p> }
        @if (draft.resultado; as result) { <p>Confirmado por el servidor: perforación {{ result.pozo.numero_perforacion }}</p>
          <ion-button fill="outline" (click)="router.navigate(['/pozos-detail', result.pozo.id_pozo])">Ver en servidor</ion-button>
        } @else if (!draft.enviado) {
          <ion-button (click)="editar(draft)" [disabled]="busy() || offline.ocupado() || !!editando()">Editar borrador</ion-button>
        } @else { <p>Enviado: reintente con los mismos datos para confirmar la recepción. El borrador y su fotografía siguen conservados.</p> }
      </section>
    }
  </ion-content>`,
  styles: ['.registro { border-top: 1px solid #bbb; margin-top: 1rem; padding-block: 1rem; }'],
})
export class OfflinePage {
  readonly offline = inject(OfflineService);
  readonly router = inject(Router);
  @ViewChild(PozosFormComponent) form?: PozosFormComponent;
  editando = signal<BorradorLocal | null>(null);
  perforadores = signal<CandidatoPozo[]>([]);
  error = signal(''); busy = signal(false);
  inicial: DatosTecnicosBorrador | null = null;
  pendientes() { return this.offline.borradores().filter(d => d.estado !== 'sincronizado').length; }
  async ionViewWillEnter() {
    this.editando.set(null); this.offline.editando.set(false); this.error.set('');
    try {
      await this.offline.cargar();
      if (this.offline.auth.state() === 'authenticated' && navigator.onLine) void this.offline.sincronizar();
    } catch (error) { this.error.set(String(error)); }
  }
  async ionViewWillLeave() {
    if (this.editando() && !this.busy()) await this.guardar();
    this.editando.set(null); this.offline.editando.set(false);
  }
  async nuevo() {
    if (this.editando()) { this.error.set('Guarde el borrador abierto antes de iniciar otro.'); return; }
    try {
      const user = await this.offline.owner();
      this.perforadores.set([{ ...user, roles: ['perforador'] }]);
      this.inicial = { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
      this.editando.set({ id: crypto.randomUUID(), usuario: user.id_usuario, estado: 'pendiente',
        pozo: { id_sitio: 0, id_propietario: null, propietario_provisional: '', id_perforador: user.id_usuario, ...DATOS_TECNICOS_ESTANDAR },
        sitio: { departamento: '', localidad: '', latitud: '', longitud: '' }, tecnicos: structuredClone(this.inicial) });
      this.error.set('');
      this.offline.editando.set(true);
    } catch (error) { this.error.set(String(error)); }
  }
  async editar(draft: BorradorLocal) {
    try {
      const owner = await this.offline.owner();
      if (owner.id_usuario !== draft.usuario) throw new Error('Debe iniciar sesión con la cuenta propietaria del borrador.');
      this.perforadores.set([{ ...owner, roles: ['perforador'] }]);
      const foto = await this.offline.foto(draft);
      this.inicial = structuredClone(draft.tecnicos);
      this.editando.set(structuredClone(draft));
      this.offline.editando.set(true);
      // ViewChild is created by the next render; the durable photo is retained even without preview.
      if (foto) this.offline.mensaje.set('Este borrador conserva una fotografía local. Puede reemplazarla al guardar.');
    } catch (error) { this.error.set(String(error)); }
  }
  async guardar() {
    const draft = this.editando(); if (!draft || this.busy()) return;
    this.busy.set(true); this.error.set('');
    try {
      await this.offline.guardar(draft, this.form?.fotoFile);
      this.editando.set(null);
      this.offline.editando.set(false);
    } catch (error) { this.error.set(String(error)); }
    finally { this.busy.set(false); }
  }
  async sincronizar() { this.error.set(''); await this.offline.sincronizar(); }
}
