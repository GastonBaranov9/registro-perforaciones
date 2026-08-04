import { Component, inject, input, OnInit, resource, signal } from '@angular/core';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonImg,
  IonToolbar,
  IonButtons,
  ViewWillEnter,
} from '@ionic/angular/standalone';
import { Pozo } from '../../../../shared/types/schemas';
import { PdfGenerate } from '../../../../shared/services/pdf-generate/pdf-generate';
import { environment } from '../../../../../environments/environment';
import { PerfilLitologicoComponent } from '../../../../shared/components/perfil-litologico/perfil-litologico.component';

@Component({
  selector: 'app-pozos-detail',
  imports: [
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonImg,
    IonToolbar,
    IonButtons,
    PerfilLitologicoComponent,
  ],
  templateUrl: './pozos-detail.page.html',
  styleUrl: './pozos-detail.page.css',
})
export class PozosDetailPage implements OnInit, ViewWillEnter {
  public informeService: PdfGenerate = inject(PdfGenerate);
  public pozoEditService = inject(PozosEditService);
  public ruta = inject(ActivatedRoute);
  public router = inject(Router);
  public id_pozo = Number(this.ruta.snapshot.paramMap.get('id_pozo'));
  public pozo = signal<Pozo | undefined>(undefined);
  public errorMessage = signal<string>('');

  async ngOnInit() {
    const data = await this.pozoEditService.getPozoById(this.id_pozo);
    this.pozo.set(data);
    this.getFoto();
    
  }

  async ionViewWillEnter(){
    
   const data = await this.pozoEditService.getPozoById(this.id_pozo);
    this.pozo.set(data);
    this.getFoto();
  }
  public irAEditarPozo() {
    this.router.navigate([`pozo-edit/${this.id_pozo}`]);
  }
getFoto() {
  const foto = this.pozo()?.foto_url;
  if (!foto) return null;

  if (foto.startsWith('http')) {
    return foto;
  }
  
  let path = foto;
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return environment.serverURL + path;
}
  generarPdf() {
    const pozo = this.pozo();
    if (!pozo) {
      this.errorMessage.set('No se pudo obtener la información del pozo.');
      return;
    }
    const id_usuario = pozo.id_propietario;
    this.informeService.descargarInformePozo(id_usuario, this.id_pozo).subscribe((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informe_pozo_${this.id_pozo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    });
  }
}
