import { Component, input, output } from '@angular/core';
import { IntervaloLitologicoBody } from '../../../../../../../shared/types/schemas';
import { IonList, IonItem, IonLabel, IonButton, IonInput } from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { SelectorLitologiaComponent } from '../../../../../../../shared/components/selector-litologia/selector-litologia.component';

@Component({
  selector: 'app-intervalo-lit-form',
  templateUrl: './intervalo-lit-form.component.html',
  styleUrls: ['./intervalo-lit-form.component.scss'],
  imports: [FormsModule, IonList, IonItem, IonLabel, IonButton, IonInput, SelectorLitologiaComponent],
})
export class IntervaloLitFormComponent {
  public intervaloLitologico = input.required<IntervaloLitologicoBody>();
  public saved = output<IntervaloLitologicoBody>();

  handleIntervaloLit() {
    this.saved.emit(this.intervaloLitologico());
  }

  seleccionar(id: number | null, nombre: string) {
    this.intervaloLitologico().id_litologia = id ?? undefined;
    if (id != null) this.intervaloLitologico().material = nombre;
  }
}
