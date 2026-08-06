import { effect, inject, input, OnInit, signal } from '@angular/core';
import { Component } from '@angular/core';
import { IonButton, IonCol, IonRow, IonGrid, ViewWillEnter, IonCard, IonCardHeader, IonCardTitle, IonContent, IonCardSubtitle, IonCardContent, IonList, IonItem, IonLabel, IonNote, IonPopover, IonToolbar, IonButtons, IonInput, IonToggle, IonItemDivider, IonIcon, IonSelect, IonSelectOption, IonModal, IonHeader, IonTitle, IonText, IonFooter, IonBackButton } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Pozo } from '../../../../shared/types/schemas';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
import { formatearInstanteComoFecha } from '../../../../shared/utils/fechas';
import { ToastController } from '@ionic/angular';
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
    IonToggle,
],
  templateUrl: './pozos-list.page.html',
  styleUrl: './pozos-list.page.css',
})
export class PozosListPage implements OnInit, ViewWillEnter {
  readonly formatearInstanteComoFecha = formatearInstanteComoFecha;

    constructor() {
    addIcons({ logoIonic });
  }
  public pozosListService = inject(PozosListService);
  public toastController = inject(ToastController);
  public webSocketService = inject(WebsocketService);
  public authService = inject(AuthService);

  private router = inject(Router);
  public pozos = signal<Pozo[]>([]);

  public caudal_min: number | undefined = undefined;
  public caudal_max: number | undefined = undefined;

  public profundidad_max: number | undefined = undefined;
  public profundidad_min: number | undefined = undefined;

  public sello_sanitario: boolean | undefined = true;


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
    const caudalMin = this.caudal_min ?? undefined;
    const caudalMax = this.caudal_max ?? undefined;
    const profMax = this.profundidad_max ?? undefined;
    const profMin = this.profundidad_min ?? undefined;
    const sello = this.sello_sanitario ?? undefined;

    this.pozos.set([]);
    try {
      const pozos = await this.pozosListService.getListaPozos(
        caudalMin,
        caudalMax,
        profMax,
        profMin,
        sello
      );
      this.pozos.set(pozos);
    } catch (error) {
      this.pozos.set([]);
      throw error;
    }
  }

  public async cargarPozos() {
    this.pozos.set([]);
    try {
      const pozos = await this.pozosListService.getListaPozos();
      this.pozos.set(pozos);
    } catch (error) {
      this.pozos.set([]);
      throw error;
    }
  }

  irAEditar(pozo: Pozo) {
    this.router.navigate(['/pozo-edit', pozo.id_pozo]);
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
    try {
      await this.pozosListService.deletePozo(pozo.id_pozo);
      await this.ionViewWillEnter();
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: err.error.message,
        duration: 1000,
        position: 'bottom',
        color: 'danger',
        animated: true,
      });

      await toast.present();
    }
  }

}
