import { Component, OnInit } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { EstiloPaginas } from '../../../../components/estilo-paginas/estilo-paginas';

@Component({
  selector: 'app-usuario',
  templateUrl: './usuario.page.html',
  imports: [EstiloPaginas, IonContent],
  styleUrl: './usuario.page.css',
})
export class UsuarioPage {}
