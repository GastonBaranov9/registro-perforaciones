import { EdicionPozoService } from '../../../../shared/services/edicion-pozo.service';
import { computed, effect, inject, OnInit, signal } from '@angular/core';
import { Component } from '@angular/core';
import { IonButton, ViewWillEnter, IonCard, IonCardHeader, IonCardTitle, IonContent, IonCardSubtitle, IonCardContent, IonList, IonItem, IonLabel, IonPopover, IonToolbar, IonButtons, IonInput, IonIcon, IonModal, IonHeader, IonTitle, IonFooter } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Pozo } from '../../../../shared/types/schemas';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
import { ExportarKmlService } from '../../../../shared/services/exportar-kml.service';
import { formatearInstanteComoFecha } from '../../../../shared/utils/fechas';
import { AlertController, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { WebsocketService } from '../../../../shared/services/websocket.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { addIcons } from 'ionicons';
import { logoIonic } from 'ionicons/icons'


@Component({
  selector: 'app-pozos-list',
  imports: [
    FormsModule,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonPopover,
    IonToolbar,
    IonButtons,
    IonIcon,
    IonModal,
    IonHeader,
    IonTitle,
    IonFooter,
    IonInput,
],
  templateUrl: './pozos-list.page.html',
  styleUrl: './pozos-list.page.css',
})
export class PozosListPage implements OnInit, ViewWillEnter {
  readonly permisos = inject(EdicionPozoService);
  readonly formatearInstanteComoFecha = formatearInstanteComoFecha;

    constructor() {
    addIcons({ logoIonic });
  }
  public pozosListService = inject(PozosListService);
  public toastController = inject(ToastController);
  readonly alertController = inject(AlertController);
  readonly eliminando = signal(false);
  private confirmacionEliminar?: HTMLIonAlertElement;
  private intentoEliminar = 0;
  public webSocketService = inject(WebsocketService);
  public authService = inject(AuthService);
  private readonly exportarKmlService = inject(ExportarKmlService);
  readonly exportandoKml = signal(false);

  async exportarKml(): Promise<void> {
    if (!this.authService.puedeOperarTodosLosPozos() || this.exportandoKml()) return;
    this.exportandoKml.set(true);
    try {
      const { exportadas, omitidas } = await this.exportarKmlService.descargar();
      const detalle = [
        exportadas !== null ? `${exportadas} exportadas` : '',
        omitidas !== null ? `${omitidas} omitidas por coordenadas o número comercial faltantes o inválidos` : '',
      ].filter(Boolean).join('; ');
      const toast = await this.toastController.create({
        message: detalle ? `Descarga KML iniciada: ${detalle}.` : 'Descarga KML iniciada.',
        duration: 6000, position: 'bottom', color: 'success',
      });
      await toast.present();
    } catch {
      const toast = await this.toastController.create({
        message: 'No se pudo exportar el KML. Verificá la conexión y volvé a intentar.',
        duration: 5000, position: 'bottom', color: 'danger',
      });
      await toast.present();
    } finally {
      this.exportandoKml.set(false);
    }
  }

  private router = inject(Router);
  public pozos = signal<Pozo[]>([]);
  public propietarioBusqueda = signal('');
  public pozosVisibles = computed(() => {
    const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
    const consulta = normalizar(this.propietarioBusqueda());
    return consulta
      ? this.pozos().filter(pozo => (normalizar(pozo.propietario_nombre ?? '').includes(consulta) || (pozo.numero_perforacion != null && String(pozo.numero_perforacion).includes(consulta))))
      : this.pozos();
  });

  public caudal_min: number | undefined = undefined;
  public caudal_max: number | undefined = undefined;

  public profundidad_max: number | undefined = undefined;
  public profundidad_min: number | undefined = undefined;
  private filtrosAplicados: Parameters<PozosListService['getListaPozos']> = [];


  async ngOnInit(): Promise<void> {
    await this.cargarPozos();
  }

  async ionViewWillEnter() {
    await this.cargarPozos();
  }

  public actualizarLista = effect(async()=>{
    if(this.webSocketService.msgRecargarCrearPozo()){
      await this.cargarPozos()
      this.webSocketService.msgRecargarCrearPozo.set(false);
    }
  })

    public actualizarListaEdit = effect(async()=>{
    if(this.webSocketService.msgRecargarEditPozo()){
      await this.cargarPozos()
      this.webSocketService.msgRecargarEditPozo.set(false);
    }
  })
      public actualizarListaDelete = effect(async()=>{
    if(this.webSocketService.msgRecargarDeletePozo()){
      await this.cargarPozos()
      this.webSocketService.msgRecargarDeletePozo.set(false);
    }
  })

  
  
  public async filtrar() {
    this.filtrosAplicados = [
      this.caudal_min ?? undefined,
      this.caudal_max ?? undefined,
      this.profundidad_max ?? undefined,
      this.profundidad_min ?? undefined,
    ];
    await this.cargarPozos();
  }

  public async cargarPozos() {
    this.pozos.set([]);
    try {
      const pozos = await this.pozosListService.getListaPozos(...this.filtrosAplicados);
      this.pozos.set(pozos);
    } catch (error) {
      this.pozos.set([]);
      throw error;
    }
  }

  irAEditar(pozo: Pozo) {
    if (!this.permisos.puedeEditar(pozo)) return;
    this.router.navigate(pozo.origen === 'historico'
      ? ['/pozos-historicos', pozo.id_pozo, 'editar']
      : ['/pozo-edit', pozo.id_pozo]);
  }

  irAIntervaloLit(pozo: Pozo) {
    this.router.navigate([`/pozos/${pozo.id_pozo}/intervalos-litologicos-list`]);
  }

  irAIntervaloPer(pozo: Pozo) {
    this.router.navigate([`/pozos/${pozo.id_pozo}/intervalos-diametros-list`]);
  }

  irANivelesA(pozo: Pozo) {
    this.router.navigate([`/pozos/${pozo.id_pozo}/aportes-list`]);
  }

  irADetalle(pozo: Pozo) {
    this.router.navigate([`pozos-detail/${pozo.id_pozo}`]);
  }

  public async borrarPozo(pozo: Pozo) {
    if (!this.authService.tieneRol('administracion') || this.eliminando()) return;
    this.eliminando.set(true);
    const intento = ++this.intentoEliminar;
    const id = pozo.id_pozo;
    let textoConfirmado = false;
    try {
      const alert = await this.alertController.create({
        header: 'Eliminar perforación definitivamente',
        subHeader: `Perforación ${pozo.numero_perforacion == null ? 'sin número asignado' : 'N.º ' + pozo.numero_perforacion} · ID interno: ${id}`,
        message: 'Se eliminarán los datos y fotografías asociados a esta perforación. Esta acción no se puede deshacer. Borrar no libera automáticamente el número. Para confirmar, escribí ELIMINAR.',
        inputs: [{ name: 'confirmacion', type: 'text', placeholder: 'ELIMINAR', attributes: { 'aria-label': 'Escribí ELIMINAR para confirmar', autocomplete: 'off', autocapitalize: 'characters' } }],
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Eliminar definitivamente', role: 'confirm', handler: (datos) => {
            textoConfirmado = datos?.confirmacion === 'ELIMINAR';
            if (!textoConfirmado) alert.message = 'Confirmación incorrecta. Escribí exactamente ELIMINAR. Se eliminarán los datos y fotografías; el número seguirá reservado.';
            return textoConfirmado;
          } },
        ],
      });
      if (intento !== this.intentoEliminar) { alert.remove(); return; }
      this.confirmacionEliminar = alert;
      const cierre = alert.onDidDismiss();
      await alert.present();
      const { role } = await cierre;
      if (role !== 'confirm' || !textoConfirmado || intento !== this.intentoEliminar || !this.authService.tieneRol('administracion')) return;
      await this.pozosListService.deletePozo(id);
      // La eliminación ya terminó: un error de recarga no debe invitar a repetirla.
      this.pozos.update(actuales => actuales.filter(actual => actual.id_pozo !== id));
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: err?.error?.message || 'No se pudo confirmar la eliminación. Actualizá el listado antes de volver a intentar.',
        duration: 6000,
        position: 'bottom',
        color: 'danger',
        animated: true,
      });

      await toast.present();
    } finally {
      this.confirmacionEliminar = undefined;
      this.eliminando.set(false);
    }
  }

  ionViewWillLeave() {
    ++this.intentoEliminar;
    // Retroceder o navegar nunca equivale a confirmar la eliminación.
    void this.confirmacionEliminar?.dismiss(undefined, 'cancel');
  }

}
