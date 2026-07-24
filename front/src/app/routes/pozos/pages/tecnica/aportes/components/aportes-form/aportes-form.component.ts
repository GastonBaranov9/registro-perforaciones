import { Component, input, OnInit, output } from '@angular/core';
import { NivelAporteBody } from '../../../../../../../shared/types/schemas';
import { IonList, IonItem, IonLabel, IonInput, IonButton } from "@ionic/angular/standalone";
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-aportes-form',
  templateUrl: './aportes-form.component.html',
  styleUrls: ['./aportes-form.component.scss'],
  imports: [FormsModule, IonList, IonItem, IonLabel, IonInput, IonButton],
})
export class AportesFormComponent  {
  public nivelAporte= input.required<NivelAporteBody>();
  public saved = output<NivelAporteBody>();

  handleNivelAporte() {
    this.saved.emit(this.nivelAporte());
  }
}
