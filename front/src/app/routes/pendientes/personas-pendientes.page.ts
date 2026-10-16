import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { PendientesComponent } from './pendientes.component';

@Component({ selector:'app-personas-pendientes',imports:[IonContent,PendientesComponent],
  template:'<ion-content class="ion-padding"><app-pendientes /></ion-content>' })
export class PersonasPendientesPage {}
