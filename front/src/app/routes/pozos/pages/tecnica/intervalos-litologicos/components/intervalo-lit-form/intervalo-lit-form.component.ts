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
  public requerirSeleccion = input(false);
  public saved = output<IntervaloLitologicoBody>();

  handleIntervaloLit() {
    if (!this.seleccionValida()) return;
    this.saved.emit(this.intervaloLitologico());
  }

  seleccionValida() {
    const dato = this.intervaloLitologico();
    if (dato.litologia_provisional != null) {
      const texto = dato.litologia_provisional.trim();
      return dato.id_litologia == null && texto.length > 0 && texto.length <= 160;
    }
    return !this.requerirSeleccion() || dato.id_litologia != null;
  }

  provisional(texto: string | null) {
    this.intervaloLitologico().litologia_provisional = texto;
    if (texto != null) { this.intervaloLitologico().id_litologia = undefined; this.intervaloLitologico().material = texto.trim(); }
  }
  seleccionar(id: number | null, nombre: string) {
    this.intervaloLitologico().id_litologia = id ?? undefined;
    if (id != null) this.intervaloLitologico().material = nombre;
  }

  seleccionarDesdeControl(valor: string | number | null) {
    const id = valor === '' || valor == null ? null : Number(valor);
    this.seleccionar(Number.isFinite(id) ? id : null, this.intervaloLitologico().material);
  }
}
