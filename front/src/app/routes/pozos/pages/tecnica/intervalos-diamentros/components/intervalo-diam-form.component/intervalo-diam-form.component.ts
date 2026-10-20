import { opcionTuberia, seleccionarTuberia } from '../../../../../../../shared/utils/intervalo-diametro';
import { Component, input, output } from '@angular/core';
import { IntervaloDiametroPerforacionBody } from '../../../../../../../shared/types/schemas';
import { IonList, IonItem, IonLabel, IonInput, IonButton, IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-intervalo-diam-form',
  imports: [IonList, IonItem, IonLabel, IonInput, IonButton, IonSelect, IonSelectOption, FormsModule],
  templateUrl: './intervalo-diam-form.component.html',
})
export class IntervaloDiamFormComponent {
  readonly opcionTuberia = opcionTuberia;
  readonly seleccionarTuberia = seleccionarTuberia;

  public intervaloDiametro = input.required<IntervaloDiametroPerforacionBody>();
  public saved = output<IntervaloDiametroPerforacionBody>();

  handleIntervaloDiam() {
    this.saved.emit(this.intervaloDiametro());
  }
}
