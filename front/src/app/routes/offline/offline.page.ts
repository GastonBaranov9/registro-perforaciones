import { afterNextRender, Component, ElementRef, inject, Injector, signal, ViewChild } from '@angular/core';
import { AlertController, IonContent, IonButton } from '@ionic/angular/standalone';
import { OfflineService } from '../../core/native/offline.service';
import { BorradorLocal, eliminacionLocal } from '../../core/native/offline-repository';
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
      <h2 #inicioFormulario tabindex="-1">Editar borrador sin número comercial</h2>
      <p>Guarde antes de salir. Puede guardar datos incompletos y completarlos antes de sincronizar.</p>
      <app-pozos-form [pozo]="draft.pozo" [sitioNuevo]="draft.sitio" [perforadores]="perforadores()"
        [borradorLocal]="true" [fotoLocalUri]="fotoLocalUri()" [catalogosDisponibles]="true" [perforadorBloqueado]="true" [guardando]="busy()" textoGuardar="Guardar borrador"
        (saved)="guardar()">
        <app-datos-tecnicos-borrador [inicial]="inicial" [profundidad]="draft.pozo.profundidad_final_m" [guardando]="busy()" (cambiado)="draft.tecnicos = $event" />
      </app-pozos-form>
      <p id="ayuda-borrador-incompleto">Si faltan campos obligatorios, puede guardar el borrador incompleto en este dispositivo y completarlo antes de sincronizar.</p>
      <ion-button fill="outline" aria-describedby="ayuda-borrador-incompleto" (click)="guardar()" [disabled]="busy()">Guardar borrador incompleto</ion-button>
    }
    @for (draft of offline.borradores(); track draft.id) {
      <section class="registro">
        <h2>{{ draft.pozo.propietario_provisional || 'Sin nombre provisional' }}</h2>
        <p>{{ draft.estado }} · {{ draft.sitio.localidad || draft.sitio.departamento }}</p>
        @if (draft.error) { <p role="alert">{{ draft.error }}</p> }
        @if (draft.resultado; as result) { <p>Confirmado por el servidor: perforación {{ result.pozo.numero_perforacion }}</p>
          <ion-button fill="outline" (click)="router.navigate(['/pozos-detail', result.pozo.id_pozo])">Ver en servidor</ion-button>
        } @else if (tipoEliminacion(draft) === 'borrador') {
          <ion-button (click)="editar(draft)" [disabled]="busy() || offline.ocupado() || !!editando()">Editar borrador</ion-button>
        } @else { <p>Enviado: reintente con los mismos datos para confirmar la recepción. El borrador y su fotografía siguen conservados.</p> }
        @if (tipoEliminacion(draft); as tipo) {
          <ion-button color="danger" fill="outline" (click)="eliminar(draft)" [disabled]="busy() || offline.ocupado() || !!editando()">{{ tipo === 'copia' ? 'Eliminar copia local' : 'Eliminar borrador' }}</ion-button>
        }
      </section>
    }
  </ion-content>`,
  styles: ['.registro { border-top: 1px solid #bbb; margin-top: 1rem; padding-block: 1rem; }'],
})
export class OfflinePage {
  readonly offline = inject(OfflineService);
  readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly injector = inject(Injector);
  @ViewChild(IonContent) content?: IonContent;
  @ViewChild('inicioFormulario') inicioFormulario?: ElementRef<HTMLElement>;
  readonly tipoEliminacion = eliminacionLocal;
  readonly fotoLocalUri = signal<string | null>(null);
  @ViewChild(PozosFormComponent) form?: PozosFormComponent;
  editando = signal<BorradorLocal | null>(null);
  perforadores = signal<CandidatoPozo[]>([]);
  error = signal(''); busy = signal(false);
  inicial: DatosTecnicosBorrador | null = null;
  pendientes() { return this.offline.borradores().filter(d => d.estado !== 'sincronizado').length; }
  async ionViewWillEnter() {
    this.editando.set(null); this.fotoLocalUri.set(null); this.offline.editando.set(false); this.error.set('');
    try {
      await this.offline.cargar();
      if (this.offline.auth.state() === 'authenticated' && navigator.onLine) void this.offline.sincronizar();
    } catch (error) { this.error.set(String(error)); }
  }
  async ionViewWillLeave() {
    if (this.editando() && !this.busy()) await this.guardar();
    // Never keep another account's editor or preview in Ionic's cached page.
    this.editando.set(null); this.fotoLocalUri.set(null); this.offline.editando.set(false);
  }
  async nuevo() {
    if (this.busy() || this.offline.ocupado()) return;
    if (this.editando()) { this.error.set('Guarde el borrador abierto antes de iniciar otro.'); return; }
    this.busy.set(true); this.offline.editando.set(true); this.fotoLocalUri.set(null);
    try {
      const user = await this.offline.owner();
      this.perforadores.set([{ ...user, roles: ['perforador'] }]);
      this.inicial = { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
      this.editando.set({ id: crypto.randomUUID(), usuario: user.id_usuario, estado: 'pendiente',
        pozo: { id_sitio: 0, id_propietario: null, propietario_provisional: '', id_perforador: user.id_usuario, ...DATOS_TECNICOS_ESTANDAR },
        sitio: { departamento: '', localidad: '', latitud: '', longitud: '' }, tecnicos: structuredClone(this.inicial) });
      this.error.set('');
      this.offline.editando.set(true);
      this.mostrarFormulario();
    } catch (error) { this.error.set(String(error)); this.offline.editando.set(false); }
    finally { this.busy.set(false); }
  }
  async editar(draft: BorradorLocal) {
    if (this.busy() || this.offline.ocupado() || this.editando() || eliminacionLocal(draft) !== 'borrador') return;
    this.busy.set(true); this.error.set(''); this.fotoLocalUri.set(null);
    // Freeze auto-sync before awaiting storage and rendering the editor.
    this.offline.editando.set(true);
    try {
      const owner = await this.offline.owner();
      if (owner.id_usuario !== draft.usuario) throw new Error('Debe iniciar sesión con la cuenta propietaria del borrador.');
      this.perforadores.set([{ ...owner, roles: ['perforador'] }]);
      try { this.fotoLocalUri.set(await this.offline.fotoUri(draft)); }
      catch { this.error.set('No se pudo abrir la fotografía guardada. Los datos y la referencia se conservan; vuelva a abrir o reemplace la foto.'); }
      this.inicial = structuredClone(draft.tecnicos);
      this.editando.set(structuredClone(draft));
      this.offline.editando.set(true);
      this.mostrarFormulario();
    } catch (error) { this.error.set(String(error)); this.offline.editando.set(false); }
    finally { this.busy.set(false); }
  }
  private mostrarFormulario() {
    afterNextRender(() => { void this.enfocarFormulario(); }, { injector: this.injector });
  }
  private async enfocarFormulario() {
    const heading = this.inicioFormulario?.nativeElement;
    const content = this.content;
    if (!heading || !content || !this.editando()) return;
    const scroll = await content.getScrollElement();
    if (!heading.isConnected || !this.editando()) return;
    const top = heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    await content.scrollToPoint(0, Math.max(0, top - 12), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250);
    if (heading.isConnected && this.editando()) heading.focus({ preventScroll: true });
  }
  async eliminar(draft: BorradorLocal) {
    const tipo = eliminacionLocal(draft);
    if (!tipo || this.busy() || this.offline.ocupado() || this.editando()) return;
    this.busy.set(true); this.error.set('');
    try {
      const alert = await this.alerts.create({
        header: tipo === 'copia' ? 'Eliminar copia local' : 'Eliminar borrador',
        message: tipo === 'copia'
          ? 'Se eliminarán los datos y la fotografía de este dispositivo. La perforación confirmada seguirá en el servidor.'
          : 'Se eliminarán este borrador y su fotografía de este dispositivo. Esta acción no se puede deshacer.',
        buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Eliminar', role: 'confirm' }],
      });
      await alert.present();
      if ((await alert.onDidDismiss()).role === 'confirm') await this.offline.eliminar(draft.id);
    } catch (error) { this.error.set(String(error)); }
    finally { this.busy.set(false); }
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
