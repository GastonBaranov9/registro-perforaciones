import { Component, inject, input, OnInit, resource, signal } from '@angular/core';
import { EstiloPaginas } from '../../../../components/estilo-paginas/estilo-paginas';
import { IonContent, IonApp } from '@ionic/angular/standalone';

@Component({
  templateUrl: './pozo.page.html',
  styleUrls: ['./pozo.page.css'],
  imports: [EstiloPaginas, IonContent],
})
export class PozoPage {}
