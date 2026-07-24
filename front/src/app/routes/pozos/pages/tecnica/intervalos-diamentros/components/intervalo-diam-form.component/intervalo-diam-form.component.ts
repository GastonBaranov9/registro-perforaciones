import { Component, input, output } from '@angular/core';
import { IntervaloDiametroPerforacionBody } from '../../../../../../../shared/types/schemas';
import { IonList, IonItem, IonLabel, IonInput, IonButton } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-intervalo-diam-form',
  imports: [IonList, IonItem, IonLabel, IonInput, IonButton, FormsModule],
  templateUrl: './intervalo-diam-form.component.html',
})
export class IntervaloDiamFormComponent {

  public intervaloDiametro = input.required<IntervaloDiametroPerforacionBody>();
  public saved = output<IntervaloDiametroPerforacionBody>();

  handleIntervaloDiam() {
    this.saved.emit(this.intervaloDiametro());
  }
}
