import { Component } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonContent],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {}
