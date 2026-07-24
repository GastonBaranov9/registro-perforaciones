import { Component, input, output } from '@angular/core';
import { IntervaloLitologicoBody } from '../../../../../../../shared/types/schemas';
import { IonList, IonItem, IonLabel, IonButton, IonInput } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-intervalo-lit-form',
  templateUrl: './intervalo-lit-form.component.html',
  styleUrls: ['./intervalo-lit-form.component.scss'],
  imports: [FormsModule, IonList, IonItem, IonLabel, IonButton, IonInput],
})
export class IntervaloLitFormComponent {
  public intervaloLitologico = input.required<IntervaloLitologicoBody>();
  public saved = output<IntervaloLitologicoBody>();

  handleIntervaloLit() {
    this.saved.emit(this.intervaloLitologico());
  }
}
